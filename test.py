#!/usr/bin/env python3
"""Proves the mail platform end to end, the way the apps use it.

  ./test.py --api KEY --from hello@tailzu.space --to you@gmail.com
            [--smtp KEY] [--forms SITEKEY [--origin https://site]]
            [--supabase https://xxx.supabase.co --anon KEY]

Every step sends one real mail to --to, then watches Postal until the receiver
(Gmail, Outlook, ...) has answered, and prints that answer:

  api       what the forms service and apps that send from code use
  smtp      exactly what Supabase does: STARTTLS on 587, AUTH PLAIN, the
            credential's key as the password, the username ignored
  forms     a contact-form submission posted to the forms service
  supabase  asks Supabase for a sign-in code for --to, exactly as a first
            sign-in from the app does (an address with no account gets one)

--api is needed for all of them: it is how the script reads the message's
status back. Needs python3 and the platform's .env beside this file (for the
hostnames) and nothing else. Exit code 0 when every step passed.
"""
import argparse
import getpass
import json
import os
import smtplib
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from email import policy
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

HERE = os.path.dirname(os.path.abspath(__file__))


def read_env():
    e = {}
    try:
        with open(os.path.join(HERE, ".env")) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    e[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return e


E = read_env()
MAIL_DOMAIN = E.get("MAIL_DOMAIN") or sys.exit("MAIL_DOMAIN is not set: copy .env.example to .env first")
POSTAL = os.environ.get("POSTAL_URL") or f"https://postal.{MAIL_DOMAIN}"
SMTP_HOST = os.environ.get("SMTP_HOST") or f"smtp.{MAIL_DOMAIN}"
SMTP_PORT = int(os.environ.get("SMTP_PORT") or 587)
# forms.<company domain>: with MAIL_DOMAIN=mail.xooteq.online that is forms.xooteq.online.
FORMS = os.environ.get("FORMS_URL") or "https://" + (E.get("FORMS_HOST") or "forms." + (MAIL_DOMAIN.split(".", 1)[1] if MAIL_DOMAIN.count(".") >= 2 else MAIL_DOMAIN))

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                             epilog="Run it with no flags and it asks for each value; Enter skips an optional one.")
ap.add_argument("--api", metavar="KEY", help="an API credential of the app's mail server (dashboard → Credentials)")
ap.add_argument("--from", dest="sender", metavar="ADDRESS", help="a sender on a domain verified in that mail server")
ap.add_argument("--to", metavar="ADDRESS", help="the inbox the test mails go to")
ap.add_argument("--smtp", metavar="KEY", help="an SMTP credential's key: also send the way Supabase does")
ap.add_argument("--forms", metavar="SITEKEY", help="a site's key from sites.json: also post a form submission")
ap.add_argument("--origin", metavar="URL", help="with --forms: one of the site's allowed origins, e.g. https://tailzu.space")
ap.add_argument("--supabase", metavar="URL", help="a Supabase project URL: also request a sign-in code for --to")
ap.add_argument("--anon", metavar="KEY", help="with --supabase: the project's anon (public) key")
A = ap.parse_args()


def ask(label, secret=False):
    """Asks on the terminal for a value not given as a flag; '' when skipped or not a terminal."""
    if not sys.stdin.isatty():
        return ""
    try:
        v = (getpass.getpass if secret else input)(f"  {label}: ")
    except (EOFError, KeyboardInterrupt):
        print(); sys.exit(1)
    return v.strip().strip('"').strip("'")


if not (A.api and A.sender and A.to):
    print("Paste each value (a pasted key is not shown). Enter skips an optional one.")
A.api = A.api or ask("Postal API key, the API row under the mail server's Credentials", secret=True)
A.sender = A.sender or ask("From address on a domain of that mail server, e.g. hello@tailzu.space")
A.to = A.to or ask("Send the tests to (your inbox)")
if not (A.api and A.sender and A.to):
    ap.error("--api, --from and --to are needed")
if A.smtp is None and sys.stdin.isatty():
    A.smtp = ask("optional: SMTP credential key, to test the login Supabase uses", secret=True) or None
if A.supabase is None and sys.stdin.isatty():
    A.supabase = ask("optional: Supabase project URL, to request a real sign-in code") or None
if A.supabase and not A.anon:
    A.anon = ask("Supabase anon (public) key, Project Settings → API Keys", secret=True) or ap.error("--supabase needs --anon")
for flag, val in (("--api", A.api), ("--smtp", A.smtp), ("--anon", A.anon), ("--forms", A.forms)):
    if val and (not val.isascii() or "•" in val or val.startswith("THE_") or val.startswith("<")):
        ap.error(f"{flag} is not a real key (a placeholder, or a masked copy with ••••): paste the value itself")
if A.anon and not A.anon.startswith("eyJ"):
    ap.error("--anon should be the project's anon (public) key, a long string starting with eyJ: Supabase → Project Settings → API Keys")

TOKEN = uuid.uuid4().hex[:8]
SUBJECT = f"Xooteq Mail test {TOKEN}"
results = []


def say(step, ok, text):
    print(f"  {'ok  ' if ok else 'FAIL'} {step:<10} {text}")
    results.append(ok)
    return ok


# ---- Postal's API ----
def postal(path, body):
    req = urllib.request.Request(f"{POSTAL}/api/v1/{path}", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", "x-server-api-key": A.api}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"status": "error", "data": {"message": f"HTTP {e.code} from {POSTAL} (nginx → Postal web)"}}
    except (urllib.error.URLError, OSError) as e:
        return {"status": "error", "data": {"message": f"{POSTAL}: {e}"}}


def message(mid):
    """The message with this id in the API key's mail server, or None."""
    j = postal("messages/message", {"id": mid, "_expansions": ["status", "details"]})
    return j["data"] if j.get("status") == "success" else None


def watch(mid, started):
    """Waits for the delivery of message mid; (ok, what the receiver said)."""
    deadline = time.time() + 90
    st = "?"
    while True:
        m = message(mid)
        st = (m or {}).get("status", {}).get("status", "?")
        if st not in ("Pending", "?") or time.time() > deadline:
            break
        time.sleep(2)
    took = time.time() - started
    dl = postal("messages/deliveries", {"id": mid}).get("data") or []
    last = dl[-1] if isinstance(dl, list) and dl else {}
    out = " ".join(str(last.get("output") or last.get("details") or "").split())
    if st == "Sent":
        return True, f"message {mid} delivered in {took:.0f}s: {out or 'accepted'}"
    if st in ("Pending", "?"):
        return False, f"message {mid} still pending after {took:.0f}s: {out or 'no delivery attempt yet (docker compose ps: is the worker up?)'}"
    return False, f"message {mid} {st}: {out or 'see the dashboard → Messages'}"


def find(after_id, accept, timeout=90):
    """The first message after after_id that `accept` likes; polls while Postal is still receiving it."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        mid, misses = after_id + 1, 0
        while misses < 3:
            m = message(mid)
            if m is None:
                misses += 1
            else:
                misses = 0
                if accept(m):
                    return mid
            mid += 1
        time.sleep(2)
    return None


def subject_has(tag):
    return lambda m: tag in (m.get("details") or {}).get("subject", "")


print(f"Xooteq Mail test: {POSTAL}, {SMTP_HOST}:{SMTP_PORT}, {FORMS}")
print(f"  from {A.sender} to {A.to}, subject \"{SUBJECT} ...\"\n")
last_id = 0

# 1. API
t = time.time()
j = postal("send/message", {"to": [A.to], "from": A.sender, "subject": f"{SUBJECT} via the API", "tag": "test",
                            "plain_body": f"A test from test.py on the mail platform ({TOKEN}). Sent through Postal's API."})
if j.get("status") == "success":
    mid = int(j["data"]["messages"][A.to]["id"])
    last_id = max(last_id, mid)
    say("api", True, f"Postal accepted it as message {mid}")
    say("api", *watch(mid, t))
else:
    d = j.get("data") or {}
    hint = ""
    if (d.get("code") or "") == "UnauthenticatedFromAddress":
        hint = (f" (the From was '{A.sender}': its domain must be a verified domain of the same mail server as the API key,"
                " spelled exactly; dashboard → the server → Domains)")
    say("api", False, f"{d.get('message') or d.get('code') or j}{hint}")
    if (d.get("code") or "") in ("InvalidServerAPIKey", "AccessDenied"):
        say("api", False, "the rest needs a working --api key; stopping")
        sys.exit(1)

# 2. SMTP, the Supabase way
if A.smtp:
    t = time.time()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = A.sender, A.to, f"{SUBJECT} via SMTP"
    msg["Date"], msg["Message-ID"] = formatdate(localtime=True), make_msgid(domain=A.sender.rsplit("@", 1)[-1])
    msg.set_content(f"A test from test.py on the mail platform ({TOKEN}). Submitted over SMTP with STARTTLS and AUTH PLAIN, as Supabase does.")
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=25) as s:
            s.ehlo()
            s.starttls(context=ssl.create_default_context())   # verifies the certificate for SMTP_HOST, as Supabase does
            s.ehlo()
            s.user, s.password = "test", A.smtp
            s.auth("PLAIN", s.auth_plain)
            s.sendmail(A.sender, [A.to], msg.as_bytes(policy=policy.SMTP))   # CRLF line ends, as SMTP wants
        say("smtp", True, "STARTTLS, AUTH PLAIN and the message were accepted")
        mid = find(last_id, subject_has(f"{TOKEN} via SMTP"))
        if mid:
            last_id = max(last_id, mid)
            say("smtp", *watch(mid, t))
        else:
            say("smtp", False, "accepted, but not found under this mail server's messages: is the SMTP credential on the same server as --api?")
    except ssl.SSLError as e:
        say("smtp", False, f"TLS failed for {SMTP_HOST}: {e} (run certbot-hook.sh after certbot; ./check.sh shows the certificate)")
    except smtplib.SMTPAuthenticationError as e:
        say("smtp", False, f"AUTH refused: {e.smtp_error.decode(errors='replace') if isinstance(e.smtp_error, bytes) else e.smtp_error} (the key of an SMTP credential, not an API one?)")
    except smtplib.SMTPException as e:
        say("smtp", False, f"{e}")
    except OSError as e:
        say("smtp", False, f"cannot connect to {SMTP_HOST}:{SMTP_PORT}: {e}")

# 3. A contact form
if A.forms:
    t = time.time()
    body = {"name": "Xooteq Mail test", "email": A.to, "message": f"A test submission from test.py ({TOKEN}).", "_subject": f"{SUBJECT} via a form"}
    headers = {"content-type": "application/json", "accept": "application/json"}
    if A.origin:
        headers["origin"] = A.origin
    req = urllib.request.Request(f"{FORMS}/s/{A.forms}", data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ans = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            ans = json.load(e)
        except Exception:
            ans = {"ok": False, "error": f"HTTP {e.code}"}
        if e.code == 403 and not A.origin:
            ans["error"] += " (pass --origin with one of the site's origins)"
    except (urllib.error.URLError, OSError) as e:
        ans = {"ok": False, "error": f"{FORMS}: {e}"}
    if ans.get("ok"):
        say("forms", True, f"the forms service took it (submission {ans.get('id')})")
        mid = find(last_id, subject_has(f"{TOKEN} via a form"))
        if mid:
            last_id = max(last_id, mid)
            say("forms", *watch(mid, t))
        else:
            say("forms", False, "taken, but not found under this mail server's messages: does the site's postal_key belong to the same server as --api? (docker compose logs forms)")
    else:
        say("forms", False, f"{ans.get('error') or ans}")

# 4. A Supabase sign-in code
if A.supabase:
    t = time.time()
    req = urllib.request.Request(f"{A.supabase.rstrip('/')}/auth/v1/otp", data=json.dumps({"email": A.to, "create_user": True}).encode(),
                                 headers={"apikey": A.anon, "content-type": "application/json"}, method="POST")
    try:
        # Supabase hands the mail to the SMTP server inside this request, so a
        # slow answer means a slow (or hanging) SMTP connection from its side.
        with urllib.request.urlopen(req, timeout=120) as r:
            r.read()
        ok, why = True, ""
        if time.time() - t > 20:
            print(f"       (Supabase took {time.time() - t:.0f}s to answer: its SMTP connection to the VPS is slow)")
    except urllib.error.HTTPError as e:
        try:
            d = json.load(e)
            why = d.get("msg") or d.get("error_description") or d.get("message") or d.get("error") or f"HTTP {e.code}"
        except Exception:
            why = f"HTTP {e.code}"
        ok = False
        if "signups not allowed" in why.lower():
            why += " (Supabase → Authentication → Sign In / Providers → Email: allow new users to sign up)"
        elif e.code == 429:
            why += " (Supabase's rate limit: wait a minute, or raise it under Authentication → Rate Limits)"
        elif e.code >= 500:
            why += " (Supabase could not hand the mail to the SMTP server: check its SMTP settings against --smtp above, and docker compose logs smtp)"
    except (urllib.error.URLError, OSError, ValueError) as e:
        ok, why = False, f"{A.supabase}: {e}"
        if "timed out" in str(e).lower():
            why = (f"no answer from Supabase in {time.time() - t:.0f}s. It sends the code over SMTP inside that request, so its "
                   f"connection to {SMTP_HOST}:587 is hanging: a firewall between Supabase and the VPS (hPanel → VPS → Firewall: "
                   "allow TCP 587 and 25 from any source), or Supabase's SMTP host/port set wrong")
    if ok:
        say("supabase", True, "Supabase accepted the request and is sending the code")
        mine = lambda m: (m.get("details") or {}).get("rcpt_to", "").lower() == A.to.lower() and float((m.get("details") or {}).get("timestamp") or 0) >= t - 5
        mid = find(last_id, mine)
        if mid:
            last_id = max(last_id, mid)
            subj = (message(mid) or {}).get("details", {}).get("subject", "")
            say("supabase", *watch(mid, t))
            if subj:
                print(f"       the code's subject: \"{subj}\"")
        else:
            say("supabase", False, "accepted by Supabase, but nothing arrived at Postal: its SMTP settings point elsewhere, or the sender address is on a domain this server has not verified")
    else:
        say("supabase", False, why)
        # Even so, the code may have gone through: look for it before giving up.
        mine = lambda m: (m.get("details") or {}).get("rcpt_to", "").lower() == A.to.lower() and float((m.get("details") or {}).get("timestamp") or 0) >= t - 5
        mid = find(last_id, mine, timeout=20)
        if mid:
            last_id = max(last_id, mid)
            print(f"       ...but a mail for {A.to} did reach Postal as message {mid}: {watch(mid, t)[1]}")
        else:
            print(f"       and nothing for {A.to} reached Postal (docker compose logs --since 5m smtp, in /opt/postal, shows whether Supabase connected at all)")

n, k = len(results), sum(results)
print(f"\n{k} of {n} ok")
if k:
    print(f"Now the inbox {A.to}: each mail is titled \"{SUBJECT} ...\". Open one → Show original (Gmail) or View message source:")
    print("SPF, DKIM and DMARC should each say PASS. One in Spam on a new IP is normal: mark it Not spam, it teaches the filter.")
sys.exit(0 if k == n else 1)
