// Contact forms, plugged straight into a company's addresses. A site's form
// posts to the forms service (forms/server.mjs) at forms.<company domain>/s/<key>
// and the message lands in the address this form names, with Reply-To set to the
// visitor. The dashboard owns every form here: which address it delivers to,
// which sites may post, the auto-reply, the limits. From these rows it writes
// the service's sites.json, which the service re-reads by itself; entries put
// there by hand are left alone.
//
// Postal does the sending. Connecting a form makes sure the company's domain is
// a sending domain on one of Postal's apps and that the app has an API key, and
// keeps that key with the form, sealed like the AI keys (crypto.ts).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.ts";
import { db, json, now, tx } from "./db.ts";
import { keyHint, open, seal } from "./crypto.ts";
import { cleanDisplayName, getCompany, InputError, type Company, type CompanyAddress } from "./companies.ts";
import { bridge, PostalError } from "./postal.ts";

/** The key Postal's app gets for the forms service, if it has none yet. */
const KEY_NAME = "forms";
const MANAGED = "xooteq-mail";

export type AutoAnswer = { subject: string; text: string };

export type Form = {
  id: number;
  name: string;
  /** The address it delivers to. */
  addressId: number;
  email: string;
  label: string;
  /** The public id in the form's URL, and the whole URL a site posts to. */
  key: string;
  endpoint: string;
  /** Postal's app that sends it, and which key of that app (never the key itself). */
  appId: string;
  appName: string;
  keyHint: string;
  origins: string[];
  redirect: string;
  subject: string;
  autoreply: AutoAnswer | null;
  limits: { perMinute: number; perDay: number };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: number; company_id: string; address_id: number; name: string; key: string; app_id: string; app_name: string;
  key_enc: string; key_hint: string; subject: string; origins: string; redirect: string; autoreply: string | null;
  per_minute: number; per_day: number; admin_token: string; enabled: number; created_at: number; updated_at: number;
};

export type FormInput = {
  name?: unknown; addressId?: unknown; appId?: unknown; origins?: unknown; redirect?: unknown;
  subject?: unknown; autoreply?: unknown; limits?: unknown; enabled?: unknown;
};

// ---- what a form may say ---------------------------------------------------------------

/** A site allowed to post: a whole origin (https://site.com) or *.site.com for its subdomains. */
export function cleanOrigin(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase().replace(/\/+$/, "");
  if (!s) return "";
  if (s.startsWith("*.")) {
    const host = s.slice(2);
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(host)) throw new InputError(`"${s}" is not a site (like *.tailzu.space)`);
    return `*.${host}`;
  }
  const withScheme = /^https?:\/\//.test(s) ? s : `https://${s}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InputError(`"${v}" is not a site address (like https://tailzu.space)`);
  }
  // A site served from localhost while it is being built may post too.
  if (!url.hostname.includes(".") && url.hostname !== "localhost") throw new InputError(`"${v}" is not a site address (like https://tailzu.space)`);
  return url.origin;
}

export function cleanOrigins(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? "").split(/[\s,]+/);
  const out: string[] = [];
  for (const o of list.slice(0, 20)) {
    const clean = cleanOrigin(o);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/** Where a plain form post lands afterwards. The service only follows https. */
function cleanRedirect(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (!/^https:\/\/\S+$/.test(s)) throw new InputError("The page to go to afterwards must be an https:// address.");
  return s.slice(0, 500);
}

function cleanAutoreply(v: unknown): AutoAnswer | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { subject?: unknown; text?: unknown; enabled?: unknown };
  if (r.enabled === false) return null;
  const text = String(r.text ?? "").slice(0, 4000).trim();
  if (!text) throw new InputError("Write the message the visitor gets back, or turn the auto-reply off.");
  return { subject: String(r.subject ?? "").slice(0, 200).trim() || "We got your message", text };
}

function cleanLimits(v: unknown): { perMinute: number; perDay: number } {
  const l = (v ?? {}) as { perMinute?: unknown; perDay?: unknown };
  // Nothing, or nothing sensible, leaves the limit as it was; a big number is capped.
  const n = (x: unknown, fallback: number, max: number) => {
    const given = Math.round(Number(x));
    return Number.isFinite(given) && given >= 1 ? Math.min(max, given) : fallback;
  };
  return { perMinute: n(l.perMinute, 5, 60), perDay: n(l.perDay, 200, 20_000) };
}

/** The public id in the URL: the company, then randomness. Matches the service's /s/<key>. */
function newKey(companyId: string): string {
  const prefix = companyId.replace(/[^a-z0-9]/g, "").slice(0, 6) || "form";
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

/** The name the service files this form's submissions under; stable for the form's life. */
const siteName = (row: { company_id: string; id: number }) => `${row.company_id}-${row.id}`;

// ---- the forms a company has -----------------------------------------------------------

const endpointOf = (key: string) => `${config.formsPublicUrl}/s/${key}`;

function toForm(r: Row, c: Company): Form {
  const a = c.addresses.find((x) => x.id === r.address_id);
  return {
    id: r.id, name: r.name, addressId: r.address_id, email: a?.email ?? "", label: a?.label ?? "",
    key: r.key, endpoint: endpointOf(r.key), appId: r.app_id, appName: r.app_name || r.app_id, keyHint: r.key_hint,
    origins: json<string[]>(r.origins, []), redirect: r.redirect, subject: r.subject,
    autoreply: json<AutoAnswer | null>(r.autoreply, null), limits: { perMinute: r.per_minute, perDay: r.per_day },
    enabled: !!r.enabled, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listForms(companyId: string): Form[] {
  const c = getCompany(companyId);
  return (db.prepare("SELECT * FROM forms WHERE company_id = ? ORDER BY created_at").all(companyId) as Row[]).map((r) => toForm(r, c));
}

function rowOf(companyId: string, id: number): Row {
  const r = db.prepare("SELECT * FROM forms WHERE company_id = ? AND id = ?").get(companyId, id) as Row | undefined;
  if (!r) throw new InputError("No such form.");
  return r;
}

export function getForm(companyId: string, id: number): Form {
  return toForm(rowOf(companyId, id), getCompany(companyId));
}

function addressOf(c: Company, id: unknown): CompanyAddress {
  const a = c.addresses.find((x) => x.id === Number(id));
  if (!a) throw new InputError("Choose one of the company's addresses for the form to deliver to.");
  return a;
}

/** Whether the dashboard can hand the forms service its sites at all. */
export const formsReady = () => !!config.formsSitesFile;

function requireReady(): string {
  if (!config.formsSitesFile) {
    throw new InputError("Forms are not connected to this dashboard yet. Run workspace-setup.sh on the server, so it can write the forms service's sites.json.");
  }
  return config.formsSitesFile;
}

export async function createForm(companyId: string, input: FormInput): Promise<Form> {
  requireReady();
  const c = getCompany(companyId);
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) throw new InputError("Say what the form is, e.g. “Contact page”.");
  const address = addressOf(c, input.addressId);
  const origins = cleanOrigins(input.origins);
  const redirect = cleanRedirect(input.redirect);
  const subject = String(input.subject ?? "").trim().slice(0, 200) || `New message from {name}`;
  const autoreply = cleanAutoreply(input.autoreply);
  const limits = cleanLimits(input.limits);
  const sending = await ensureSending(c, String(input.appId ?? ""));

  const id = tx(() => {
    const r = db.prepare(
      `INSERT INTO forms (company_id, address_id, name, key, app_id, app_name, key_enc, key_hint, subject, origins,
         redirect, autoreply, per_minute, per_day, admin_token, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(companyId, address.id, name, newKey(companyId), sending.appId, sending.appName, seal(sending.key), keyHint(sending.key),
      subject, JSON.stringify(origins), redirect, autoreply ? JSON.stringify(autoreply) : null,
      limits.perMinute, limits.perDay, crypto.randomBytes(24).toString("base64url"), now(), now());
    return Number(r.lastInsertRowid);
  });
  try {
    writeSites();
  } catch (e) {
    db.prepare("DELETE FROM forms WHERE id = ?").run(id);
    throw e;
  }
  return getForm(companyId, id);
}

export async function updateForm(companyId: string, id: number, patch: FormInput): Promise<Form> {
  const before = rowOf(companyId, id);
  const c = getCompany(companyId);
  const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 60) || before.name : before.name;
  const addressId = patch.addressId !== undefined ? addressOf(c, patch.addressId).id : before.address_id;
  const origins = patch.origins !== undefined ? cleanOrigins(patch.origins) : json<string[]>(before.origins, []);
  const redirect = patch.redirect !== undefined ? cleanRedirect(patch.redirect) : before.redirect;
  const subject = patch.subject !== undefined ? String(patch.subject).trim().slice(0, 200) || before.subject : before.subject;
  const autoreply = patch.autoreply !== undefined ? cleanAutoreply(patch.autoreply) : json<AutoAnswer | null>(before.autoreply, null);
  const limits = patch.limits !== undefined ? cleanLimits(patch.limits) : { perMinute: before.per_minute, perDay: before.per_day };
  const enabled = patch.enabled !== undefined ? !!patch.enabled : !!before.enabled;
  // A form moved to another app sends with that app's key from now on; an empty
  // choice means a new app named after the company.
  const wantedApp = patch.appId !== undefined ? String(patch.appId) : before.app_id;
  const sending = patch.appId !== undefined && wantedApp !== before.app_id ? await ensureSending(c, wantedApp) : null;

  db.prepare(
    `UPDATE forms SET name = ?, address_id = ?, subject = ?, origins = ?, redirect = ?, autoreply = ?,
       per_minute = ?, per_day = ?, enabled = ?, updated_at = ?
         ${sending ? ", app_id = ?, app_name = ?, key_enc = ?, key_hint = ?" : ""} WHERE id = ?`,
  ).run(name, addressId, subject, JSON.stringify(origins), redirect, autoreply ? JSON.stringify(autoreply) : null,
    limits.perMinute, limits.perDay, enabled ? 1 : 0, now(),
    ...(sending ? [sending.appId, sending.appName, seal(sending.key), keyHint(sending.key)] : []), id);
  try {
    writeSites();
  } catch (e) {
    db.prepare(
      `UPDATE forms SET name = ?, address_id = ?, subject = ?, origins = ?, redirect = ?, autoreply = ?,
         per_minute = ?, per_day = ?, enabled = ?, updated_at = ?, app_id = ?, app_name = ?, key_enc = ?, key_hint = ? WHERE id = ?`,
    ).run(before.name, before.address_id, before.subject, before.origins, before.redirect, before.autoreply,
      before.per_minute, before.per_day, before.enabled, before.updated_at, before.app_id, before.app_name, before.key_enc, before.key_hint, id);
    throw e;
  }
  return getForm(companyId, id);
}

/** Stops the form: the endpoint answers "no such form" from the next submission on.
 *  Submissions already kept on the server stay. */
export function deleteForm(companyId: string, id: number): void {
  rowOf(companyId, id);
  db.prepare("DELETE FROM forms WHERE id = ?").run(id);
  writeSites();
}

// ---- Postal: the domain and the key that send a form ------------------------------------

type PostalDomain = { id: string; name: string; verified: boolean; status: Record<string, { status: string | null; error: string | null }>; records: unknown[] };
type PostalKey = { id: number; name: string; type: string; key: string };
type PostalApp = { id: string; name: string; mode: string; domainList?: PostalDomain[]; credentialList?: PostalKey[] };

const app = (id: string) => `/servers/${encodeURIComponent(id)}`;

/** The apps a form can send through, and what each one's DNS for this domain looks like. */
export async function sendingChoices(companyId: string): Promise<{
  apps: { id: string; name: string; mode: string; domain: PostalDomain | null }[];
  suggested: string;
  domain: string;
  companyName: string;
}> {
  const c = getCompany(companyId);
  const o = (await bridge("GET", "/overview")) as { servers: { id: string; name: string; mode: string }[] };
  const apps: { id: string; name: string; mode: string; domain: PostalDomain | null }[] = [];
  for (const s of o.servers ?? []) {
    const full = (await bridge("GET", app(s.id))) as PostalApp;
    apps.push({ id: s.id, name: s.name, mode: s.mode, domain: (full.domainList ?? []).find((d) => d.name === c.domain) ?? null });
  }
  const named = apps.find((a) => a.name.toLowerCase() === c.name.toLowerCase());
  return {
    apps, domain: c.domain, companyName: c.name,
    suggested: apps.find((a) => a.domain)?.id ?? named?.id ?? apps[0]?.id ?? "",
  };
}

/** Makes sure one of Postal's apps can send as this domain, and has a key to send with.
 *  An empty appId makes an app named after the company. */
async function ensureSending(c: Company, appId: string): Promise<{ appId: string; appName: string; key: string }> {
  let full: PostalApp;
  if (appId) {
    full = (await bridge("GET", app(appId))) as PostalApp;
  } else {
    const o = (await bridge("GET", "/overview")) as { servers: { id: string; name: string }[] };
    const existing = (o.servers ?? []).find((s) => s.name.toLowerCase() === c.name.toLowerCase());
    full = existing
      ? ((await bridge("GET", app(existing.id))) as PostalApp)
      : ((await bridge("POST", "/servers", { name: c.name, mode: "Live" })) as PostalApp);
  }

  if (!(full.domainList ?? []).some((d) => d.name === c.domain)) {
    try {
      await bridge("POST", `${app(full.id)}/domains`, { name: c.domain });
    } catch (e) {
      // Another app may already hold the domain; Postal says so rather than adding it twice.
      if (!(e instanceof PostalError && /already|taken|exists/i.test(e.message))) throw e;
      throw new InputError(`${c.domain} is already a sending domain on another app. Pick that app for this form, or remove the domain there first.`);
    }
  }

  const keys = (full.credentialList ?? []).filter((k) => k.type === "API");
  const key = keys.find((k) => k.name === KEY_NAME)?.key ?? keys[0]?.key
    ?? ((await bridge("POST", `${app(full.id)}/credentials`, { name: KEY_NAME, type: "API" })) as PostalKey).key;
  return { appId: full.id, appName: full.name, key };
}

// ---- the file the forms service reads ---------------------------------------------------

type SiteEntry = Record<string, unknown>;

/** One form as the service's sites.json wants it. */
function siteOf(row: Row, c: Company): { name: string; entry: SiteEntry } | null {
  const a = c.addresses.find((x) => x.id === row.address_id);
  if (!a || !row.enabled) return null;
  const sender = cleanDisplayName(a.displayName || c.name) || c.name;
  const entry: SiteEntry = {
    key: row.key,
    to: [a.email],
    from: `${sender} <${a.email}>`,
    postal_key: open(row.key_enc),
    origins: json<string[]>(row.origins, []),
    subject: row.subject,
    admin_token: row.admin_token,
    limits: { perMinute: row.per_minute, perDay: row.per_day },
    managed_by: MANAGED,
  };
  if (row.redirect) entry.redirect = row.redirect;
  const auto = json<AutoAnswer | null>(row.autoreply, null);
  if (auto) entry.autoreply = { subject: auto.subject, text: auto.text, from: entry.from };
  return { name: siteName(row), entry };
}

/** The whole file: the dashboard's forms, plus any site put there by hand. */
export function renderSites(current: unknown, ours: { name: string; entry: SiteEntry }[]): { sites: Record<string, SiteEntry> } {
  const had = (current && typeof current === "object" ? (current as { sites?: unknown }).sites : null) ?? {};
  const sites: Record<string, SiteEntry> = {};
  for (const [name, site] of Object.entries(had as Record<string, SiteEntry>)) {
    if (site && typeof site === "object" && site.managed_by === MANAGED) continue;
    sites[name] = site;
  }
  for (const { name, entry } of ours) sites[name] = entry;
  return { sites };
}

/** Writes sites.json for the forms service, which notices the change by itself. */
export function writeSites(): void {
  const file = requireReady();
  const rows = db.prepare("SELECT * FROM forms ORDER BY company_id, id").all() as Row[];
  const companies = new Map<string, Company>();
  const ours: { name: string; entry: SiteEntry }[] = [];
  for (const row of rows) {
    let c = companies.get(row.company_id);
    if (!c) {
      try {
        c = getCompany(row.company_id);
      } catch {
        continue; // the company is gone from the dashboard; its forms go with it
      }
      companies.set(row.company_id, c);
    }
    try {
      const site = siteOf(row, c);
      if (site) ours.push(site);
    } catch (e) {
      // Its sealed Postal key cannot be read (DASHBOARD_SECRET changed): leave
      // the form out rather than the whole file, and say which one.
      console.warn(`[forms] "${row.name}" (${row.company_id}) is not in sites.json: ${(e as Error).message}`);
    }
  }
  let current: unknown = null;
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as { code?: string }).code !== "ENOENT") console.warn(`[forms] ${file} was not readable JSON; its hand-written sites are not kept`);
  }
  const next = JSON.stringify(renderSites(current, ours), null, 2) + "\n";
  // The service re-reads the file whenever it changes, so leave it alone when
  // nothing in it has.
  try {
    if (fs.readFileSync(file, "utf8") === next) return;
  } catch { /* no file yet, or unreadable: write it */ }
  const tmp = path.join(path.dirname(file), `.sites.${process.pid}.json`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, next, { mode: 0o644 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw new InputError(`The forms service's sites file could not be written (${(e as Error).message}). Run workspace-setup.sh on the server.`);
  }
}

/** At start-up, so the service's file matches the database even after a restore. */
export function syncSites(): void {
  if (!formsReady()) return;
  try {
    writeSites();
  } catch (e) {
    console.warn(`[forms] sites.json not written: ${(e as Error).message}`);
  }
}

// ---- what the forms service knows about a form -----------------------------------------

export type Submission = {
  id: string; at: string; status: string; ip?: string; page?: string; agent?: string;
  fields: Record<string, string>; reason?: string; message_id?: string;
};

async function askService(method: string, url: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method, signal: AbortSignal.timeout(20_000), ...init });
  } catch (e) {
    throw new InputError(`The forms service is not answering (${(e as Error).message}).`);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new InputError(String(data?.error ?? `The forms service said ${res.status}.`));
  return data;
}

/** The last submissions, read from the service that kept them. */
export async function recentSubmissions(companyId: string, id: number, n = 50): Promise<Submission[]> {
  const row = rowOf(companyId, id);
  const url = `${config.formsUrl}/s/${row.key}/recent?token=${encodeURIComponent(row.admin_token)}&n=${Math.max(1, Math.min(200, n))}`;
  const out = (await askService("GET", url)) as { submissions?: Submission[] };
  return out.submissions ?? [];
}

/** A site posting to one of the form's own origins, so the whole path is tried. */
function sampleOrigin(origins: string[]): string | undefined {
  const first = origins[0];
  if (!first) return undefined;
  return first.startsWith("*.") ? `https://www${first.slice(1)}` : first;
}

/** Posts a message through the form itself, as a site would. */
export async function testForm(companyId: string, id: number, from: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const row = rowOf(companyId, id);
  if (!row.enabled) throw new InputError("Turn the form on first.");
  const origin = sampleOrigin(json<string[]>(row.origins, []));
  const out = (await askService("POST", `${config.formsUrl}/s/${row.key}`, {
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify({
      name: "Xooteq Mail",
      email: from,
      message: `A test submission sent from Xooteq Mail to check this form (${row.name}).`,
      _subject: `Test: ${row.name}`,
    }),
  })) as { ok?: boolean; id?: string; error?: string };
  return { ok: !!out.ok, id: out.id, error: out.error };
}
