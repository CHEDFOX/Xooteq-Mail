"""End to end: the dashboard's API against a real Stalwart, in development.

Needs a local Stalwart taking mail on SMTP_PORT (25) and the dashboard on XM_URL,
configured with engine.py (so Stalwart posts new mail to the dashboard), and an
owner login. Runs its own stand-in AI provider on 127.0.0.1, so the dashboard must
run on this machine too (not in Docker).

  XM_EMAIL=you@example.com XM_PASSWORD=... python3 test/e2e.py
  XM_SLOW=1 ...   also waits for a delayed AI reply to go out by itself (~90 s)
"""
import json, os, smtplib, threading, time, urllib.request, http.cookiejar, uuid
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, HTTPServer

BASE = os.environ.get("XM_URL", "http://127.0.0.1:5200").rstrip("/")
EMAIL, PASSWORD = os.environ.get("XM_EMAIL", ""), os.environ.get("XM_PASSWORD", "")
SMTP_HOST, SMTP_PORT = os.environ.get("SMTP_HOST", "127.0.0.1"), int(os.environ.get("SMTP_PORT", "25"))
DOM = f"e2e{int(time.time())}.test"
if not EMAIL or not PASSWORD:
    raise SystemExit("set XM_EMAIL and XM_PASSWORD (the dashboard owner)")

# ---- a stand-in OpenAI-compatible provider ----
class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if not self.path.endswith("/models"): return self.send(404, {})
        if self.headers.get("authorization") != "Bearer sk-test": return self.send(401, {"error": {"message": "bad key"}})
        self.send(200, {"data": [{"id": "stub-small"}, {"id": "stub-large"}]})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)))
        if self.headers.get("authorization") != "Bearer sk-test": return self.send(401, {"error": {"message": "Incorrect API key provided"}})
        user = body["messages"][-1]["content"]
        if '"ok": true' in user: content = {"ok": True, "says": "hello from stub"}
        elif "refund" in user.lower(): content = {"decision": "escalate", "reply": "Hi,\n\nSomeone from billing will look at this.", "reason": "refund request"}
        else: content = {"decision": "reply", "reply": "Hi,\n\nUpdate to the latest version and restart; that fixes it in almost every case.", "reason": "known fix"}
        self.send(200, {"model": body.get("model"), "choices": [{"message": {"content": json.dumps(content)}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}})

stub = HTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=stub.serve_forever, daemon=True).start()
STUB = f"http://127.0.0.1:{stub.server_address[1]}/v1"

# ---- helpers ----
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.ProxyHandler({}))
results = []

def api(method, path, body=None, headers=None, raw=False):
    h = {"x-xooteq": "1", **(headers or {})}
    data = None
    if isinstance(body, (bytes, bytearray)): data = bytes(body)
    elif body is not None: data = json.dumps(body).encode(); h["content-type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with opener.open(req, timeout=60) as r:
            b = r.read()
            return r.status, (b if raw else (json.loads(b) if b else None)), dict(r.headers)
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b), dict(e.headers)
        except Exception: return e.code, b.decode()[:200], dict(e.headers)

def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f"  ({str(detail)[:300]})" if detail and not ok else ""))

def smtp(frm, to, subject, body):
    m = EmailMessage(); m["From"] = frm; m["To"] = to; m["Subject"] = subject; m["Message-ID"] = f"<{uuid.uuid4()}@e2e.test>"; m.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s: s.ehlo("client.test"); s.send_message(m)

def jmap(cid, calls):
    s, b, _ = api("POST", f"/api/c/{cid}/jmap", {"methodCalls": calls})
    assert s == 200, (s, b)
    return b["methodResponses"]

def run_for(cid, subject, wait=25):
    """The AI's run for the message with this subject, once it has decided."""
    end, found = time.time() + wait, {}
    while time.time() < end:
        s, runs, _ = api("GET", f"/api/ai/runs?company={cid}&limit=30")
        found = next((r for r in runs if r.get("subject") == subject), {}) if s == 200 else {}
        if found and found["status"] != "working": return found
        time.sleep(1)
    return found

def ask(subject, body):
    """A customer writes to support@ (subject made unique to this run); the AI's run for it."""
    subject = f"{subject} [{DOM[3:]}]"
    smtp(customer(), f"support@{DOM}", subject, body)
    return run_for(cid, subject)

def run_by_id(cid, rid):
    s, runs, _ = api("GET", f"/api/ai/runs?company={cid}&limit=50")
    return next((r for r in runs if r["id"] == rid), {})

def keywords(cid, ids):
    r = jmap(cid, [["Email/get", {"ids": ids, "properties": ["keywords"]}, "g"]])
    return {e["id"]: e["keywords"] for e in r[0][1]["list"]}

def customer():
    n = uuid.uuid4().hex[:6]
    return f"Customer {n} <c{n}@customer.test>"

print("auth")
s, b, _ = api("GET", "/api/me"); check("signed out: /api/me is 401", s == 401)
s, b, _ = api("POST", "/api/auth/login", {"email": EMAIL, "password": "wrong-password"}); check("wrong password refused", s == 401)
s, b, _ = api("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD}, headers={"x-xooteq": "0"}); check("no CSRF header: 403", s == 403)
s, b, _ = api("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD}); check("sign in", s == 200, b)
s, me, _ = api("GET", "/api/me"); check("/api/me", s == 200 and me["owner"]["email"] == EMAIL.lower(), me)

print("company")
s, c, _ = api("POST", "/api/companies", {"name": f"Delta Labs {DOM[3:]}", "domain": DOM, "local": "hello", "aliases": ["support", "contact", {"local": "billing", "label": "Billing"}]})
check("create company with aliases", s == 200 and len(c["addresses"]) == 4, c)
cid = c["id"]
s, b, _ = api("POST", "/api/companies", {"name": "Delta again", "domain": DOM}); check("same domain twice refused", s == 400, b)
s, b, _ = api("POST", "/api/companies", {"name": "Bad", "domain": "not a domain"}); check("bad domain refused", s == 400, b)
r = jmap(cid, [["Mailbox/get", {"properties": ["name", "role"]}, "0"]])
names = sorted(m["name"] for m in r[0][1]["list"])
check("folders made for each address", all(n in names for n in ("Support", "Contact", "Billing")), names)
s, b, _ = api("POST", f"/api/c/{cid}/jmap", {"methodCalls": [["x:Domain/get", {}, "0"]]}); check("admin methods blocked through the inbox proxy", s == 403, b)
s, b, _ = api("POST", f"/api/companies/{cid}/addresses", {"local": "press"}); check("add an address", s == 200 and any(a["local"] == "press" for a in b["addresses"]), b)
press = next(a for a in b["addresses"] if a["local"] == "press")
s, b, _ = api("PATCH", f"/api/companies/{cid}/addresses/{press['id']}", {"label": "Media"}); check("rename its folder", s == 200 and any(a["label"] == "Media" for a in b["addresses"]), b)
r = jmap(cid, [["Mailbox/get", {"properties": ["name"]}, "0"]]); check("folder renamed on the server", any(m["name"] == "Media" for m in r[0][1]["list"]))
s, b, _ = api("DELETE", f"/api/companies/{cid}/addresses/{press['id']}"); check("remove the address", s == 200 and not any(a["local"] == "press" for a in b["addresses"]), b)

print("dns")
s, d, _ = api("GET", f"/api/companies/{cid}/dns")
kinds = [r["kind"] for r in d.get("records", [])] if s == 200 else []
check("records listed (MX, SPF, DKIM, DMARC)", s == 200 and "DKIM" in kinds and "MX" in kinds and "SPF" in kinds and "DMARC" in kinds, kinds)

print("mail in")
smtp("Asha <asha@customer.test>", f"support@{DOM}", "Keyboard not opening", "Since the update the keyboard does not open.")
time.sleep(3)
r = jmap(cid, [["Mailbox/get", {"properties": ["name", "role"]}, "m"], ["Email/query", {"sort": [{"property": "receivedAt", "isAscending": False}], "limit": 5}, "q"],
               ["Email/get", {"#ids": {"resultOf": "q", "name": "Email/query", "path": "/ids"}, "properties": ["subject", "mailboxIds"]}, "g"]])
mb = {m["id"]: m["name"] for m in r[0][1]["list"]}
first = r[2][1]["list"][0] if r[2][1]["list"] else {}
check("support@ mail filed in Support and Inbox", sorted(mb[i] for i in first.get("mailboxIds", {})) == ["Inbox", "Support"], first)

print("rules and auto-reply")
s, b, _ = api("PUT", f"/api/companies/{cid}/rules", {"rules": [{"name": "Receipts", "conditions": [{"field": "subject", "op": "contains", "value": "receipt"}], "actions": [{"type": "move", "value": "Receipts"}, {"type": "read"}]}]})
check("save a rule", s == 200 and len(b) == 1, b)
s, b, _ = api("PUT", f"/api/companies/{cid}/rules", {"rules": [{"name": "x", "conditions": [{"field": "from", "op": "is", "value": "a@b.c"}], "actions": [{"type": "forward", "value": "not-an-address"}]}]})
check("bad forward address refused", s == 400, b)
contact = next(a for a in c["addresses"] if a["local"] == "contact")
s, b, _ = api("PATCH", f"/api/companies/{cid}/addresses/{contact['id']}", {"autoReply": {"enabled": True, "subject": "Thanks for writing to Delta", "body": "We got it and reply within a day.", "days": 1}})
check("turn on contact@'s auto-reply", s == 200, b)
smtp("Billing Bot <bot@shop.test>", f"hello@{DOM}", "Your receipt", "Paid.")
time.sleep(4)
r = jmap(cid, [["Mailbox/get", {"properties": ["name"]}, "m"], ["Email/query", {"filter": {"text": "receipt"}, "limit": 1}, "q"],
               ["Email/get", {"#ids": {"resultOf": "q", "name": "Email/query", "path": "/ids"}, "properties": ["subject", "mailboxIds", "keywords"]}, "g"]])
mb = {m["id"]: m["name"] for m in r[0][1]["list"]}
rc = r[2][1]["list"][0] if r[2][1]["list"] else {}
check("the rule moved the receipt and marked it read", [mb[i] for i in rc.get("mailboxIds", {})] == ["Receipts"] and rc.get("keywords", {}).get("$seen"), rc)

print("attachments")
s, up, _ = api("POST", f"/api/c/{cid}/upload", b"%PDF-1.4 tiny", headers={"content-type": "application/pdf"})
check("upload", s == 200 and up.get("blobId"), up)
s, raw, hdr = api("GET", f"/api/c/{cid}/blob/{up['blobId']}/doc.pdf?type=application/pdf", raw=True)
check("download inline pdf", s == 200 and raw.startswith(b"%PDF") and hdr.get("content-disposition", "").startswith("inline"), hdr)
s, raw, hdr = api("GET", f"/api/c/{cid}/blob/{up['blobId']}/page.html?type=text/html", raw=True)
check("html never served inline", s == 200 and hdr.get("content-type") == "application/octet-stream" and hdr.get("content-disposition", "").startswith("attachment"), hdr)
s, u, _ = api("GET", "/api/unread"); check("unread counts", s == 200 and cid in u, u)

print("ai providers")
s, p, _ = api("POST", "/api/ai/models", {"kind": "openai", "baseUrl": STUB, "key": "sk-test"}); check("list models with an unsaved key", s == 200 and p["models"] == ["stub-large", "stub-small"], p)
s, p, _ = api("POST", "/api/ai/models", {"kind": "openai", "baseUrl": STUB, "key": "wrong"}); check("wrong key reported", s == 400, p)
s, prov, _ = api("POST", "/api/ai/providers", {"name": "Stub", "kind": "openai", "baseUrl": STUB, "model": "stub-small", "key": "sk-test"})
check("save a provider (key not echoed)", s == 200 and "key" not in prov, prov)
s, t, _ = api("POST", f"/api/ai/providers/{prov['id']}/test"); check("test the provider", s == 200 and "hello from stub" in t.get("says", ""), t)

print("ai: drafts")
s, b, _ = api("PUT", f"/api/companies/{cid}/ai", {"providerId": prov["id"], "profile": {"about": "Delta makes a voice keyboard.", "signature": "— Delta Support", "sendDelayMinutes": 0}})
check("save the company's AI profile", s == 200 and b["profile"]["signature"] == "— Delta Support", b)
support = next(a for a in c["addresses"] if a["local"] == "support")
api("PATCH", f"/api/companies/{cid}/addresses/{support['id']}", {"aiMode": "draft"})
run = ask("Still not opening", "The keyboard still does not open after the update.")
check("AI drafted a reply", run.get("status") == "drafted" and run.get("draft_id"), run)
r = jmap(cid, [["Email/get", {"ids": [run.get("draft_id")], "properties": ["subject", "keywords", "inReplyTo", "bodyValues", "textBody"], "fetchTextBodyValues": True}, "g"]])
draft = r[0][1]["list"][0] if r[0][1]["list"] else {}
body = "".join(v["value"] for v in draft.get("bodyValues", {}).values())
check("the draft replies in the thread, signed", draft.get("keywords", {}).get("$ai") and draft.get("inReplyTo") and "— Delta Support" in body and draft.get("subject", "").startswith("Re:"), draft)

print("ai: sending")
api("PATCH", f"/api/companies/{cid}/addresses/{support['id']}", {"aiMode": "send"})
run = ask("Refund please", "I was charged twice, refund me.")
check("a refund request is left for a person even in send mode", run.get("status") == "needs_person", run)
run = ask("Keyboard question", "The keyboard does not open, any tips?")
check("no delay: sent at once", run.get("status") == "sent", run)

api("PUT", f"/api/companies/{cid}/ai", {"providerId": prov["id"], "profile": {"sendDelayMinutes": 1}})
run = ask("Keyboard gone", "The keyboard disappeared.")
check("with a delay: waits", run.get("status") == "scheduled" and run.get("send_at", 0) > time.time() * 1000 + 40_000, run)
s, waiting, _ = api("GET", f"/api/c/{cid}/ai/scheduled")
check("listed as waiting", s == 200 and any(w["id"] == run.get("id") for w in waiting), waiting)
kw = keywords(cid, [run["draft_id"], run["email_id"]])
check("draft and message marked while it waits", kw[run["draft_id"]].get("$ai_scheduled") and kw[run["email_id"]].get("$ai_scheduled"), kw)
s, b, _ = api("POST", f"/api/c/{cid}/ai/scheduled/{run['id']}/cancel")
after = run_by_id(cid, run["id"])
kw = keywords(cid, [run["draft_id"], run["email_id"]])
check("stop it: it stays a draft to review", s == 200 and after.get("status") == "drafted" and not kw[run["draft_id"]].get("$ai_scheduled") and kw[run["email_id"]].get("$ai_draft"), (b, after, kw))
s, b, _ = api("POST", f"/api/c/{cid}/ai/scheduled/{run['id']}/cancel"); check("stopping twice says so", s == 400, b)

run = ask("Keyboard frozen", "The keyboard is frozen.")
s, b, _ = api("POST", f"/api/c/{cid}/ai/scheduled/{run['id']}/send")
after = run_by_id(cid, run["id"])
r = jmap(cid, [["Email/get", {"ids": [run["draft_id"], run["email_id"]], "properties": ["keywords", "mailboxIds"]}, "g"], ["Mailbox/get", {"properties": ["role"]}, "m"]])
sent_box = next(m["id"] for m in r[1][1]["list"] if m["role"] == "sent")
by = {e["id"]: e for e in r[0][1]["list"]}
check("send now: sent, filed in Sent, the message marked answered",
      s == 200 and after.get("status") == "sent" and by[run["draft_id"]]["mailboxIds"].get(sent_box) and by[run["email_id"]]["keywords"].get("$ai_replied")
      and not by[run["email_id"]]["keywords"].get("$ai_scheduled"), (b, after, by))

run = ask("Keyboard slow", "The keyboard is slow.")
jmap(cid, [["Email/set", {"destroy": [run["draft_id"]]}, "d"]])
if os.environ.get("XM_SLOW"):
    run2 = ask("Keyboard tiny", "The keyboard is tiny.")
    print("  … waiting for the delayed replies (about 90 s)")
    time.sleep(95)
    gone, went = run_by_id(cid, run["id"]), run_by_id(cid, run2["id"])
    check("a discarded waiting reply is not sent", gone.get("status") == "cancelled", gone)
    check("a waiting reply goes out by itself", went.get("status") == "sent", went)

s, b, _ = api("POST", f"/api/c/{cid}/ai/suggest", {"emailId": first.get("id")}); check("Write with AI in the composer", s == 200 and "Update to the latest" in b.get("text", ""), b)
s, b, _ = api("POST", "/hooks/stalwart", {"events": []}, headers={"x-signature": "bogus"}); check("unsigned webhook refused", s == 401, b)

api("DELETE", f"/api/companies/{cid}")
api("DELETE", f"/api/ai/providers/{prov['id']}")
print(f"\n{sum(results)} of {len(results)} ok")
raise SystemExit(0 if all(results) else 1)
