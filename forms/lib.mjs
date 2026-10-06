// The parts of the forms service worth testing on their own.

/** Fields a form may carry that steer the service rather than say anything. */
export const RESERVED = new Set(["_subject", "_redirect", "_replyto", "_cc", "_format", "_next"]);
/** A field a person never sees; a bot fills it. Web3Forms' name is kept so a
 *  form moved over keeps working. */
export const HONEYPOTS = new Set(["_honey", "_gotcha", "botcheck"]);

export const isEmail = (s) => typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

/** The body as a flat object of strings, whatever the form sent it as. */
export function parseBody(contentType, raw) {
  const ct = contentType.toLowerCase();
  const text = raw.toString("utf8");
  if (ct.includes("application/json")) {
    try { const j = JSON.parse(text); return j && typeof j === "object" && !Array.isArray(j) ? flat(j) : {}; } catch { return {}; }
  }
  if (ct.includes("multipart/form-data")) return multipart(raw, ct);
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

function flat(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return out;
}

/** Text fields of a multipart body; files are left out. */
function multipart(raw, ct) {
  const m = ct.match(/boundary="?([^";]+)"?/);
  if (!m) return {};
  const out = {};
  const parts = raw.toString("latin1").split("--" + m[1]);
  for (const part of parts.slice(1)) {
    if (part.startsWith("--")) break;
    const idx = part.indexOf("\r\n\r\n");
    if (idx < 0) continue;
    const head = part.slice(0, idx), body = part.slice(idx + 4).replace(/\r\n$/, "");
    const name = head.match(/name="([^"]*)"/)?.[1];
    if (!name || /filename=/.test(head)) continue;
    out[name] = Buffer.from(body, "latin1").toString("utf8");
  }
  return out;
}

/** "{name}" in a template becomes the field; a missing field becomes nothing. */
export const fill = (tpl, fields) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (fields[k] == null ? "" : String(fields[k]).replace(/[\r\n]+/g, " ").slice(0, 120)));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const label = (k) => k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** The email: the fields as a list, then where it came from. */
export function renderEmail(site, record, replyTo) {
  const rows = Object.entries(record.fields);
  const text = rows.map(([k, v]) => (v.includes("\n") ? `${label(k)}:\n  ${v.replace(/\n/g, "\n  ")}` : `${label(k)}: ${v}`)).join("\n") +
    `\n\n—\nSent from ${record.page || site.name} at ${record.at.replace("T", " ").slice(0, 16)} UTC` + (record.ip ? ` from ${record.ip}` : "") +
    (replyTo ? `\nReply to this email to answer ${replyTo}.` : "");
  const html = `<div style="font:15px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181613;max-width:640px">` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">` +
    rows.map(([k, v]) => `<tr><td style="padding:8px 14px 8px 0;vertical-align:top;color:#68625A;white-space:nowrap">${esc(label(k))}</td>` +
      `<td style="padding:8px 0;vertical-align:top;white-space:pre-wrap">${esc(v)}</td></tr>`).join("") +
    `</table><p style="margin:22px 0 0;color:#8a8a8e;font-size:13px">Sent from ${esc(record.page || site.name)} · ${esc(record.at.replace("T", " ").slice(0, 16))} UTC` +
    (record.ip ? ` · ${esc(record.ip)}` : "") + (replyTo ? `<br>Reply to this email to answer ${esc(replyTo)}.` : "") + `</p></div>`;
  return { text, html };
}

/** Whether a post from this origin (or page) may use the site's form. An empty
 *  list allows any; a browser always sends one or the other. */
export function checkOrigin(site, origin, referer) {
  if (!site.origins.length) return true;
  const from = origin || (referer ? safeOrigin(referer) : "");
  if (!from) return !!site.allow_no_origin;
  return site.origins.some((o) => o === from || (o.startsWith("*.") && from.endsWith(o.slice(1)) ));
}
function safeOrigin(u) { try { return new URL(u).origin; } catch { return ""; } }

/** Per IP per minute, per site per day. In memory: a restart forgives everyone. */
export class RateLimit {
  constructor(now = () => Date.now()) { this.now = now; this.ips = new Map(); this.days = new Map(); }
  check(site, ip) {
    const t = this.now();
    const key = `${site.name}|${ip}`;
    const recent = (this.ips.get(key) || []).filter((x) => t - x < 60_000);
    if (recent.length >= site.limits.perMinute) return "per-minute";
    recent.push(t); this.ips.set(key, recent);
    if (this.ips.size > 50_000) this.ips.clear();
    const day = `${site.name}|${new Date(t).toISOString().slice(0, 10)}`;
    const n = (this.days.get(day) || 0) + 1;
    if (n > site.limits.perDay) return "per-day";
    this.days.set(day, n);
    if (this.days.size > 1000) for (const k of this.days.keys()) if (!k.endsWith(new Date(t).toISOString().slice(0, 10))) this.days.delete(k);
    return null;
  }
}
