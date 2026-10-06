// Xooteq Forms: a contact form posts here, the message lands in an inbox.
//
// A site's form:   <form action="https://forms.xooteq.online/s/<key>" method="post">
// A site's script: fetch(".../s/<key>", {method:"POST", body: JSON.stringify(fields)})
//
// Each site is an entry in sites.json: its key, where submissions go, the Postal
// credential that sends them, the origins allowed to post, where to send the
// visitor afterwards. Submissions are checked (honeypot, size, rate, origin),
// sent through Postal's API as a tidy email with Reply-To set to the visitor,
// optionally answered with an auto-reply, and kept as one JSON line per
// submission under /data/<site>/<month>.jsonl.
//
// No dependencies: Node 22's http, fetch and fs are enough.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseBody, renderEmail, fill, isEmail, checkOrigin, RateLimit, HONEYPOTS, RESERVED } from "./lib.mjs";

const SITES_FILE = process.env.SITES_FILE || "/config/sites.json";
const DATA_DIR = process.env.DATA_DIR || "/data";
const POSTAL_API = (process.env.POSTAL_API || "http://web:5000").replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 5100);
const MAX_BODY = 64 * 1024;

// ---- sites: read at start, re-read when the file changes ----
let byKey = new Map();
function loadSites() {
  const raw = JSON.parse(fs.readFileSync(SITES_FILE, "utf8"));
  const next = new Map();
  for (const [name, s] of Object.entries(raw.sites || {})) {
    for (const need of ["key", "to", "from", "postal_key"]) if (!s[need]) throw new Error(`sites.json: ${name} has no ${need}`);
    next.set(s.key, { name, ...s, to: [].concat(s.to), origins: s.origins || [], limits: { perMinute: 5, perDay: 200, ...(s.limits || {}) } });
  }
  byKey = next;
  console.log(`sites: ${[...next.values()].map((s) => s.name).join(", ") || "none"}`);
}
loadSites();
let reloadTimer;
try { fs.watch(path.dirname(SITES_FILE), () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { try { loadSites(); } catch (e) { console.error("sites.json not reloaded:", e.message); } }, 300); }); } catch { /* no watch: restart to reload */ }

const limits = new RateLimit();

// ---- the one thing it does ----
async function submit(req, res, site, body, meta) {
  const fields = {};
  for (const [k, v] of Object.entries(body)) if (!RESERVED.has(k) && !HONEYPOTS.has(k) && String(v).trim() !== "") fields[k] = String(v).slice(0, 10000);
  const id = crypto.randomUUID();
  const record = { id, site: site.name, at: new Date().toISOString(), ip: meta.ip, page: meta.page, agent: meta.agent, fields };

  // A bot filled the field a person never sees: thank it and send nothing.
  if ([...HONEYPOTS].some((h) => body[h] && String(body[h]).trim() !== "")) { keep(site, { ...record, status: "bot" }); return respond(req, res, site, body, { ok: true, id }); }
  if (Object.keys(fields).length === 0) return respond(req, res, site, body, { ok: false, error: "The form was empty." }, 400);
  const rl = limits.check(site, meta.ip);
  if (rl) { keep(site, { ...record, status: "rate", reason: rl }); return respond(req, res, site, body, { ok: false, error: "Too many messages. Try again later." }, 429); }

  const replyTo = [body._replyto, body.email, body.Email, body["e-mail"]].map((x) => String(x || "").trim()).find(isEmail);
  const subject = fill(body._subject || site.subject || "New message from {name}", { ...fields, site: site.name }).slice(0, 200) || `New message, ${site.name}`;
  const { text, html } = renderEmail(site, record, replyTo);
  const message = { to: site.to, from: site.from, subject, plain_body: text, html_body: html, tag: "form", ...(replyTo ? { reply_to: replyTo } : {}) };
  if (body._cc && isEmail(String(body._cc))) message.cc = [String(body._cc)];

  const sent = await postal(site, message);
  if (!sent.ok) {
    keep(site, { ...record, status: "failed", reason: sent.error });
    console.error(`${site.name}: not sent: ${sent.error}`);
    return respond(req, res, site, body, { ok: false, error: "Couldn't send your message right now. Please try again in a minute." }, 502);
  }
  keep(site, { ...record, status: "sent", message_id: sent.id });
  if (site.autoreply && replyTo) {
    const a = site.autoreply;
    postal(site, { to: [replyTo], from: a.from || site.from, subject: fill(a.subject || "We got your message", fields).slice(0, 200), plain_body: fill(a.text || "Thanks, we'll get back to you soon.", fields), tag: "form-autoreply" })
      .then((r) => { if (!r.ok) console.error(`${site.name}: auto-reply not sent: ${r.error}`); });
  }
  return respond(req, res, site, body, { ok: true, id });
}

async function postal(site, message) {
  try {
    const r = await fetch(`${POSTAL_API}/api/v1/send/message`, {
      method: "POST", headers: { "content-type": "application/json", "x-server-api-key": site.postal_key }, body: JSON.stringify(message),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (j.status === "success") return { ok: true, id: j.data?.message_id };
    return { ok: false, error: j.data?.message || j.data?.code || `postal ${r.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

function keep(site, record) {
  try {
    const dir = path.join(DATA_DIR, site.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${record.at.slice(0, 7)}.jsonl`), JSON.stringify(record) + "\n");
  } catch (e) { console.error("not kept:", e.message); }
}

function recent(site, n = 100) {
  const dir = path.join(DATA_DIR, site.name);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const out = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").filter(Boolean).reverse();
    for (const l of lines) { try { out.push(JSON.parse(l)); } catch { /* a torn line */ } if (out.length >= n) return out; }
  }
  return out;
}

// ---- answering: JSON to a script, a redirect to a form ----
function wantsJson(req, body) {
  const ct = req.headers["content-type"] || "", acc = req.headers.accept || "";
  return ct.includes("json") || (acc.includes("application/json") && !acc.includes("text/html")) || body._format === "json";
}
function respond(req, res, site, body, out, status = 200) {
  if (wantsJson(req, body)) return json(res, status, out);
  if (out.ok) {
    const to = String(body._redirect || site.redirect || "");
    if (/^https:\/\//.test(to)) { res.writeHead(303, { location: to }); return res.end(); }
    return page(res, 200, "Message sent", "Thanks. Your message is on its way.", req.headers.referer);
  }
  return page(res, status, "Not sent", out.error, req.headers.referer);
}
function json(res, status, obj, extra = {}) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extra }); res.end(JSON.stringify(obj)); }
function page(res, status, title, text, back) {
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
    `<body style="margin:0;min-height:100vh;display:grid;place-items:center;font:17px/1.5 system-ui,sans-serif;background:#F6F5F1;color:#181613">` +
    `<div style="max-width:420px;padding:32px;text-align:center"><h1 style="font-weight:600;font-size:22px;margin:0 0 10px">${esc(title)}</h1><p style="margin:0;color:#68625A">${esc(text)}</p>` +
    (back && /^https?:\/\//.test(back) ? `<p style="margin-top:22px"><a href="${esc(back)}" style="color:#A85A22">Back</a></p>` : "") + `</div>`);
}
function cors(res, origin) { return origin ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, accept", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" } : {}; }

// ---- the server ----
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/healthz") return json(res, 200, { ok: true, sites: byKey.size });
    const m = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{8,64})(?:\/(recent))?$/);
    if (!m) return json(res, 404, { ok: false, error: "No such form." });
    const site = byKey.get(m[1]);
    if (!site) return json(res, 404, { ok: false, error: "No such form." });
    const origin = req.headers.origin;
    const originOk = checkOrigin(site, origin, req.headers.referer);

    if (m[2] === "recent") {
      if (!site.admin_token || url.searchParams.get("token") !== site.admin_token) return json(res, 401, { ok: false, error: "Wrong token." });
      return json(res, 200, { ok: true, site: site.name, submissions: recent(site, Number(url.searchParams.get("n")) || 100) });
    }
    if (req.method === "OPTIONS") { res.writeHead(originOk ? 204 : 403, cors(res, originOk ? origin : null)); return res.end(); }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST a form here." });
    if (!originOk) return json(res, 403, { ok: false, error: "This form does not accept messages from that site." }, cors(res, null));

    let raw = Buffer.alloc(0);
    for await (const chunk of req) { raw = Buffer.concat([raw, chunk]); if (raw.length > MAX_BODY) return json(res, 413, { ok: false, error: "The message is too long." }, cors(res, origin)); }
    const body = parseBody(req.headers["content-type"] || "", raw);
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const meta = { ip, page: String(req.headers.referer || "").slice(0, 500), agent: String(req.headers["user-agent"] || "").slice(0, 300) };
    // CORS headers ride on every answer to a script.
    const write = res.writeHead.bind(res);
    res.writeHead = (status, headers = {}) => write(status, { ...headers, ...cors(res, originOk && origin ? origin : null) });
    await submit(req, res, site, body, meta);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { ok: false, error: "Something went wrong." });
  }
});
server.listen(PORT, "0.0.0.0", () => console.log(`forms on :${PORT}, postal at ${POSTAL_API}`));
