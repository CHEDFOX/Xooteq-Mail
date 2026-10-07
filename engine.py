#!/usr/bin/env python3
"""The mailbox engine (Stalwart) beside Postal: first-run setup and the settings
the platform depends on. Python's standard library only; run on the VPS from
/opt/postal (workspace-setup.sh calls it).

  engine.py bootstrap   first start only: names the server, picks its storage,
                        and writes the admin login it is given into .env
  engine.py configure   idempotent: hostname and MX, the TLS certificate, the
                        relay of Postal's bounce domains to Postal, the webhook
                        that tells the dashboard about new mail; then reloads
  engine.py reload-tls  re-reads the certificate files (certbot-hook.sh)
  engine.py status      domains, accounts and the certificate, at a glance

Stalwart 0.16 keeps every setting in its database and manages it over JMAP
("x:<Object>/<method>" calls at /jmap/); there is no config file to edit.
"""
import base64
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.environ.get("ENV_FILE") or os.path.join(HERE, ".env")


def read_env():
    e = {}
    try:
        for line in open(ENV_FILE):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                e[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        sys.exit(f"{ENV_FILE} is missing")
    return e


def set_env(updates):
    """Writes keys into .env, replacing a line that has one and appending the rest."""
    lines = open(ENV_FILE).read().splitlines()
    done = set()
    for i, line in enumerate(lines):
        k = line.split("=", 1)[0].strip()
        if k in updates and not line.lstrip().startswith("#"):
            lines[i] = f"{k}={updates[k]}"
            done.add(k)
    for k, v in updates.items():
        if k not in done:
            lines.append(f"{k}={v}")
    open(ENV_FILE, "w").write("\n".join(lines) + "\n")
    os.chmod(ENV_FILE, 0o600)


E = read_env()
MAIL_DOMAIN = E.get("MAIL_DOMAIN") or sys.exit("MAIL_DOMAIN is not set in .env")
URL = os.environ.get("STALWART_LOCAL_URL") or E.get("STALWART_LOCAL_URL") or f"http://127.0.0.1:{E.get('STALWART_LOCAL_PORT') or 8081}"
USING = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"]


def http(path, body=None, auth=None, timeout=30):
    h = {}
    if auth:
        h["authorization"] = "Basic " + base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    req = urllib.request.Request(URL + path, data=data, headers=h, method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


class Engine:
    def __init__(self, auth):
        self.auth = auth
        s = http("/.well-known/jmap", auth=auth)
        self.account = s["primaryAccounts"].get("urn:stalwart:jmap") or next(iter(s["accounts"]))

    def call(self, method, args):
        args = {"accountId": self.account, **args}
        r = http("/jmap/", {"using": USING, "methodCalls": [[method, args, "0"]]}, auth=self.auth)
        name, res, _ = r["methodResponses"][0]
        if name == "error":
            raise SystemExit(f"{method}: {res}")
        for k in ("notCreated", "notUpdated", "notDestroyed"):
            if res.get(k):
                raise SystemExit(f"{method}: {json.dumps(res[k])}")
        return res

    def get(self, obj, ids=None):
        return self.call(f"x:{obj}/get", {"ids": ids} if ids else {})["list"]

    def create(self, obj, value):
        return self.call(f"x:{obj}/set", {"create": {"n": value}})["created"]["n"]["id"]

    def update(self, obj, oid, patch):
        self.call(f"x:{obj}/set", {"update": {oid: patch}})

    def action(self, kind):
        self.create("Action", {"@type": kind})


def wait_up(seconds=90):
    for _ in range(seconds):
        try:
            urllib.request.urlopen(URL + "/healthz/live", timeout=2)
            return
        except Exception:
            time.sleep(1)
    sys.exit(f"Stalwart is not answering at {URL} (docker compose logs stalwart)")


def bootstrap():
    """First start: Stalwart is in bootstrap mode with only port 8080 open."""
    if E.get("STALWART_ADMIN_SECRET"):
        print("already bootstrapped (STALWART_ADMIN_SECRET is in .env)")
        return
    rec = E.get("STALWART_RECOVERY_ADMIN", "")
    if ":" not in rec:
        sys.exit("STALWART_RECOVERY_ADMIN (user:password) is needed for the first start")
    wait_up()
    eng = Engine(tuple(rec.split(":", 1)))
    res = eng.call("x:Bootstrap/set", {"update": {"singleton": {
        # The name the server greets with, and the PTR of the VPS's IP.
        "serverHostname": f"smtp.{MAIL_DOMAIN}",
        # The platform domain: holds the admin login and nothing else. Company
        # domains are added from the dashboard, each when its mail moves here.
        "defaultDomain": MAIL_DOMAIN,
        # nginx owns 80 and 443; the certificate comes from certbot (configure).
        "requestTlsCertificate": False,
        "generateDkimKeys": True,
    }}})
    got = res["updated"]["singleton"]
    set_env({"STALWART_ADMIN_USER": got["username"], "STALWART_ADMIN_SECRET": got["secret"],
             "STALWART_RECOVERY_ADMIN": ""})
    print(f"bootstrapped: admin {got['username']} (written to .env); restart the container to leave setup mode")


POSTAL_DOMAINS = f"ends_with(rcpt_domain, '.{MAIL_DOMAIN}') || starts_with(rcpt_domain, 'psrp.')"


def configure():
    wait_up()
    if not E.get("STALWART_ADMIN_SECRET"):
        sys.exit("run `engine.py bootstrap` first")
    eng = Engine((E["STALWART_ADMIN_USER"], E["STALWART_ADMIN_SECRET"]))

    # 1. Names: HELO and the MX the zone files suggest, and the hosts mail apps
    #    are told to use. All three are on the certbot certificate.
    eng.update("SystemSettings", "singleton", {
        "defaultHostname": f"smtp.{MAIL_DOMAIN}",
        "mailExchangers": {"0": {"hostname": f"mx.{MAIL_DOMAIN}", "priority": 10}},
        "services/imap": {"hostname": f"mx.{MAIL_DOMAIN}", "cleartext": False},
        "services/smtp": {"hostname": f"smtp.{MAIL_DOMAIN}", "cleartext": False},
    })
    print("ok  hostname smtp, MX mx, IMAP mx, submission smtp")

    # 2. The TLS certificate: certbot's, copied into the container's tls dir by
    #    certbot-hook.sh and read from there on every reload.
    certs = eng.get("Certificate")
    file_cert = {"certificate": {"@type": "File", "filePath": "/etc/stalwart/tls/fullchain.pem"},
                 "privateKey": {"@type": "File", "filePath": "/etc/stalwart/tls/privkey.pem"}}
    if certs:
        cid = certs[0]["id"]
        eng.update("Certificate", cid, file_cert)
    else:
        cid = eng.create("Certificate", file_cert)
    eng.update("SystemSettings", "singleton", {"defaultCertificateId": cid})
    print("ok  certificate from /etc/stalwart/tls")

    # 3. Postal's bounce domains: Stalwart now owns port 25, so mail for
    #    <anything>.<MAIL_DOMAIN> and psrp.<app domain> (Postal's return paths)
    #    is accepted and handed to Postal's SMTP server on the compose network.
    routes = {r.get("name"): r for r in eng.get("MtaRoute")}
    relay = {"address": "smtp", "port": 25, "protocol": "smtp", "allowInvalidCerts": True,
             "description": "Postal: bounces and replies to its return-path domains"}
    if "postal" in routes:
        eng.update("MtaRoute", routes["postal"]["id"], relay)
    else:
        eng.create("MtaRoute", {"@type": "Relay", "name": "postal", **relay})
    eng.update("MtaOutboundStrategy", "singleton", {"route": {
        "match": {"0": {"if": POSTAL_DOMAINS, "then": "'postal'"},
                  "1": {"if": "is_local_domain(rcpt_domain)", "then": "'local'"}},
        "else": "'mx'"}})
    eng.update("MtaStageRcpt", "singleton", {"allowRelaying": {
        "match": {"0": {"if": POSTAL_DOMAINS, "then": "true"}},
        "else": "!is_empty(authenticated_as)"}})
    print(f"ok  *.{MAIL_DOMAIN} and psrp.* relayed to Postal (nothing else: no open relay)")

    # 4. New mail tells the dashboard (AI replies), signed with WEBHOOK_SECRET.
    secret = E.get("WEBHOOK_SECRET") or secrets.token_urlsafe(32)
    if not E.get("WEBHOOK_SECRET"):
        set_env({"WEBHOOK_SECRET": secret})
    url = E.get("DASHBOARD_HOOK_URL") or "http://dashboard:5200/hooks/stalwart"
    hook = {"url": url, "events": {"message-ingest.ham": True}, "eventsPolicy": "include",
            "signatureKey": {"@type": "Value", "secret": secret}, "throttle": 500, "timeout": 15000,
            "enable": True}
    # Replaced, not edited: Stalwart keeps posting to an edited webhook's old
    # address until it restarts, while a new one takes effect on reload.
    for h in eng.get("WebHook"):
        if h.get("url") == url:
            eng.call("x:WebHook/set", {"destroy": [h["id"]]})
    eng.create("WebHook", hook)
    print(f"ok  new mail posted to {url}")

    eng.action("ReloadSettings")
    eng.action("ReloadTlsCertificates")
    print("ok  reloaded")


def reload_tls():
    wait_up(10)
    Engine((E["STALWART_ADMIN_USER"], E["STALWART_ADMIN_SECRET"])).action("ReloadTlsCertificates")
    print("ok  certificates reloaded")


def status():
    wait_up(10)
    eng = Engine((E["STALWART_ADMIN_USER"], E["STALWART_ADMIN_SECRET"]))
    for d in eng.get("Domain"):
        print(f"domain   {d['name']}")
    for a in eng.call("x:Account/get", {"properties": ["name", "emailAddress", "aliases"]})["list"]:
        al = ", ".join(sorted(x.get("name", "") for x in (a.get("aliases") or {}).values()))
        print(f"account  {a.get('emailAddress') or a.get('name')}" + (f"  (aliases: {al})" if al else ""))
    for c in eng.get("Certificate"):
        print(f"cert     {', '.join(sorted(c.get('subjectAlternativeNames') or {}))}  until {c.get('notValidAfter')}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"bootstrap": bootstrap, "configure": configure, "reload-tls": reload_tls,
     "status": status}.get(cmd, lambda: sys.exit(__doc__))()
