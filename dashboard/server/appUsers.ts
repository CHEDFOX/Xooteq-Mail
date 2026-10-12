// The people who use an app: read from the app's own Postgres database (a
// Supabase project's auth.users, or any table with a column mapping) and shown
// under the app's Users tab. Xooteq only ever reads: every query runs inside a
// READ ONLY transaction with a statement timeout. The connection string is
// sealed at rest like the AI keys (crypto.ts), and never sent back to the page.
import pg from "pg";
import { db, json, now } from "./db.ts";
import { open, seal } from "./crypto.ts";

export class UsersError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Where a plain table keeps each field; only the table and email or phone are required. */
export interface Mapping {
  schema: string;
  table: string;
  name?: string;
  email?: string;
  phone?: string;
  created?: string;
  lastUsed?: string;
}
export type Kind = "supabase" | "table";

export interface AppUser {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** How they sign in, where the database says (Supabase: email, phone, google…). */
  provider: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export interface TableInfo {
  schema: string;
  table: string;
  columns: { name: string; type: string }[];
  guess: Mapping;
}

interface Row { app_id: string; url_enc: string; url_hint: string; kind: Kind; mapping: string; updated_at: number }

// ---- the connection --------------------------------------------------------------------

/**
 * pg's own reading of sslmode treats "require" as verify-full, which refuses
 * Supabase's pooler certificate; libpq means "encrypt, don't verify". So the
 * mode is read here and handed to pg as an explicit ssl option: verify-ca and
 * verify-full verify, disable is plain, anything else encrypts, and a local or
 * private host with no mode says nothing is plain (a database on the same box).
 */
export function connectionOptions(url: string): pg.PoolConfig {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new UsersError("That isn't a connection string. It starts with postgresql://"); }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new UsersError("Only Postgres databases can be connected (postgresql://…).");
  if (!u.hostname) throw new UsersError("The connection string has no host.");
  const mode = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host === "::1" || !host.includes(".") ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const ssl = mode === "disable" ? false
    : mode === "verify-full" || mode === "verify-ca" ? { rejectUnauthorized: true }
    : !mode && local ? false
    : { rejectUnauthorized: false };
  return { connectionString: u.toString(), ssl, connectionTimeoutMillis: 10_000, application_name: "xooteq-mail", max: 3, idleTimeoutMillis: 30_000, allowExitOnIdle: true };
}

/** user@host:port/database — which database, without the password. */
export function hintOf(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${decodeURIComponent(u.username || "?")}@${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname && u.pathname !== "/" ? u.pathname : ""}`;
  } catch { return "?"; }
}

/** The database's refusal, said so someone can act on it. */
function friendly(e: unknown, phase: "connect" | "read"): UsersError {
  const err = e as { code?: string; message?: string };
  const code = err.code ?? "";
  const msg = err.message ?? String(e);
  const status = phase === "connect" ? 400 : 502;
  if (code === "28P01" || code === "28000") return new UsersError("The database refused the username or password.", status);
  if (code === "3D000") return new UsersError("That database doesn't exist on the server.", status);
  if (code === "42501") return new UsersError(`This database user isn't allowed to read that (${msg}).`, status);
  if (code === "42P01" || code === "42703") return new UsersError(`The database no longer has what was mapped (${msg}). Map the table again.`, status);
  if (code === "57014") return new UsersError("The database took too long to answer.", 504);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new UsersError("That host name doesn't resolve. Check the host in the connection string.", status);
  if (code === "ECONNREFUSED") return new UsersError("Nothing is listening at that host and port.", status);
  if (code === "ETIMEDOUT" || /timeout/i.test(msg)) return new UsersError("The database didn't answer in time. Is the host reachable from this server?", status);
  if (/does not support SSL/i.test(msg)) return new UsersError("The server doesn't speak SSL. Add ?sslmode=disable to the connection string.", status);
  if (/certificate/i.test(msg)) return new UsersError(`The server's certificate didn't verify (${msg}). Use sslmode=require to encrypt without verifying.`, status);
  if (e instanceof UsersError) return e;
  return new UsersError(`The database said: ${msg}`, status);
}

const pools = new Map<string, { pool: pg.Pool; version: number }>();

function poolFor(appId: string, url: string, version: number): pg.Pool {
  const had = pools.get(appId);
  if (had && had.version === version) return had.pool;
  if (had) void had.pool.end().catch(() => {});
  const pool = new pg.Pool(connectionOptions(url));
  pool.on("error", () => { /* an idle connection dropped; the next read opens another */ });
  pools.set(appId, { pool, version });
  return pool;
}

function dropPool(appId: string): void {
  const had = pools.get(appId);
  if (had) void had.pool.end().catch(() => {});
  pools.delete(appId);
}

/** fn inside a READ ONLY transaction with a 15-second statement limit. */
async function readOnly<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  let c: pg.PoolClient;
  try { c = await pool.connect(); } catch (e) { throw friendly(e, "connect"); }
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SET LOCAL statement_timeout = 15000");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw friendly(e, "read");
  } finally {
    c.release();
  }
}

/** A throwaway pool for a connection string that isn't saved yet. */
async function withUrl<T>(url: string, fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ ...connectionOptions(url), max: 1 });
  pool.on("error", () => {});
  try { return await fn(pool); } finally { await pool.end().catch(() => {}); }
}

// ---- what is in the database ------------------------------------------------------------

/** Supabase and Postgres schemas that hold the platform's tables, not the app's. */
const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "auth", "storage", "realtime", "_realtime", "supabase_functions",
  "supabase_migrations", "extensions", "graphql", "graphql_public", "vault", "pgsodium", "pgsodium_masks", "net", "cron",
  "pgbouncer", "_analytics", "_supavisor", "pgtle", "topology", "tiger", "tiger_data"];

const pick = (cols: string[], ...patterns: RegExp[]) => {
  for (const re of patterns) { const hit = cols.find((c) => re.test(c)); if (hit) return hit; }
  return undefined;
};

/** A first guess at which column is which, from the names alone. */
export function guessMapping(schema: string, table: string, cols: string[]): Mapping {
  return {
    schema, table,
    name: pick(cols, /^(full_?name|display_?name)$/i, /^name$/i, /^(user_?name|username)$/i, /^first_?name$/i),
    email: pick(cols, /^e?-?mail$/i, /^email_?address$/i, /email/i),
    phone: pick(cols, /^phone(_?number)?$/i, /^mobile(_?number)?$/i, /phone|mobile/i),
    created: pick(cols, /^created_?at$/i, /^(signed_?up|joined|registered|inserted)_?at$/i, /^(created|date_?joined|created_?on)$/i),
    lastUsed: pick(cols, /^last_?(seen|active|used|activity)(_?at)?$/i, /^last_?(sign_?in|login)(_?at)?$/i, /^updated_?at$/i),
  };
}

/** The columns of auth.users / auth.sessions this login can see (column grants count). */
async function supabaseColumns(c: pg.PoolClient): Promise<{ users: Set<string>; sessions: Set<string> }> {
  const r = await c.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'auth' and table_name in ('users', 'sessions')`);
  const users = new Set<string>(), sessions = new Set<string>();
  for (const x of r.rows) (x.table_name === "users" ? users : sessions).add(x.column_name);
  return { users, sessions };
}

const supabaseUsable = (cols: Set<string>) => cols.has("id") && cols.has("created_at") && (cols.has("email") || cols.has("phone"));

/** What a connection can read: Supabase's users, and the app's own tables. */
export async function inspect(url: string): Promise<{ hint: string; supabase: boolean; tables: TableInfo[] }> {
  return withUrl(url, (pool) => readOnly(pool, async (c) => {
    const sb = await supabaseColumns(c);
    const r = await c.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
      `select c.table_schema, c.table_name, c.column_name, c.data_type
         from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema <> all($1) and c.table_schema not like 'pg\\_%'
          and t.table_type in ('BASE TABLE', 'VIEW')
        order by (c.table_schema = 'public') desc, c.table_schema, c.table_name, c.ordinal_position`,
      [SYSTEM_SCHEMAS]);
    const byTable = new Map<string, TableInfo>();
    for (const x of r.rows) {
      const k = `${x.table_schema}.${x.table_name}`;
      let t = byTable.get(k);
      if (!t) {
        if (byTable.size >= 300) continue;
        t = { schema: x.table_schema, table: x.table_name, columns: [], guess: { schema: x.table_schema, table: x.table_name } };
        byTable.set(k, t);
      }
      t.columns.push({ name: x.column_name, type: x.data_type });
    }
    const tables = [...byTable.values()].map((t) => ({ ...t, guess: guessMapping(t.schema, t.table, t.columns.map((c) => c.name)) }));
    // The likeliest user tables first: users, profiles, accounts…, then the rest.
    const likely = (t: TableInfo) => /^(users?|profiles?|accounts?|customers?|members?|app_users?)$/i.test(t.table) ? 0 : t.guess.email || t.guess.phone ? 1 : 2;
    tables.sort((a, b) => likely(a) - likely(b));
    return { hint: hintOf(url), supabase: supabaseUsable(sb.users), tables };
  }));
}

// ---- the query ---------------------------------------------------------------------------

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** A column of any date-ish type as a timestamptz: timestamps, dates, epoch seconds or ms, ISO text. */
function asTime(col: string, type: string): string {
  if (/timestamp|date/i.test(type)) return `${col}::timestamptz`;
  if (/int|numeric|double|real/i.test(type)) return `to_timestamp(case when ${col} > 100000000000 then ${col} / 1000.0 else ${col} end)`;
  return `nullif(${col}::text, '')::timestamptz`;
}

/** The SELECT every list and count reads from: name, email, phone, provider, created_at, last_used. */
async function baseQuery(c: pg.PoolClient, kind: Kind, map: Mapping | null): Promise<string> {
  if (kind === "supabase") {
    const { users: u, sessions: s } = await supabaseColumns(c);
    if (!supabaseUsable(u)) throw new UsersError("This login can't read auth.users any more.", 502);
    const meta = u.has("raw_user_meta_data")
      ? `coalesce(${["full_name", "name", "display_name", "user_name"].map((k) => `nullif(u.raw_user_meta_data->>'${k}', '')`).join(", ")})`
      : "null";
    const provider = [
      u.has("is_anonymous") ? "case when u.is_anonymous then 'anonymous' end" : null,
      u.has("raw_app_meta_data") ? "u.raw_app_meta_data->>'provider'" : null,
    ].filter(Boolean);
    // Last used: the last sign-in, or later if a session has been refreshed
    // since (an app that stays signed in for weeks never signs in again).
    const seen = s.has("user_id") && (s.has("refreshed_at") || s.has("updated_at"))
      ? `max(${s.has("refreshed_at") && s.has("updated_at") ? "coalesce(refreshed_at, updated_at)" : s.has("refreshed_at") ? "refreshed_at" : "updated_at"})`
      : null;
    const lastSignIn = u.has("last_sign_in_at") ? "u.last_sign_in_at" : "null::timestamptz";
    return `select ${meta}::text as name,
        ${u.has("email") ? "nullif(u.email, '')" : "null"}::text as email,
        ${u.has("phone") ? "nullif(u.phone, '')" : "null"}::text as phone,
        ${provider.length ? `coalesce(${provider.join(", ")})` : "null"}::text as provider,
        u.created_at::timestamptz as created_at,
        ${seen ? `greatest(${lastSignIn}, s.seen)` : lastSignIn}::timestamptz as last_used
      from auth.users u
      ${seen ? `left join (select user_id, ${seen}::timestamptz as seen from auth.sessions group by user_id) s on s.user_id = u.id` : ""}
      ${u.has("deleted_at") ? "where u.deleted_at is null" : ""}`;
  }
  if (!map) throw new UsersError("Pick the table that holds the users.");
  const cols = await c.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns where table_schema = $1 and table_name = $2`, [map.schema, map.table]);
  const types = new Map(cols.rows.map((r) => [r.column_name, r.data_type]));
  if (!types.size) throw new UsersError(`${map.schema}.${map.table} isn't there, or this login can't read it.`);
  const col = (field: keyof Mapping, label: string) => {
    const name = map[field];
    if (!name) return null;
    if (!types.has(name)) throw new UsersError(`${map.table} has no column "${name}" for ${label}.`);
    return `t.${ident(name)}`;
  };
  const name = col("name", "the name"), email = col("email", "email"), phone = col("phone", "phone");
  const created = col("created", "account created"), last = col("lastUsed", "last used");
  if (!email && !phone) throw new UsersError("Map an email or a phone column: that's how a user signs in.");
  return `select ${name ? `nullif(${name}::text, '')` : "null"}::text as name,
      ${email ? `nullif(${email}::text, '')` : "null"}::text as email,
      ${phone ? `nullif(${phone}::text, '')` : "null"}::text as phone,
      null::text as provider,
      ${created ? asTime(created, types.get(map.created!)!) : "null::timestamptz"} as created_at,
      ${last ? asTime(last, types.get(map.lastUsed!)!) : "null::timestamptz"} as last_used
    from ${ident(map.schema)}.${ident(map.table)} t`;
}

export type Sort = "created" | "used" | "name";
const ORDER: Record<Sort, string> = {
  created: "created_at desc nulls last, email, phone",
  used: "last_used desc nulls last, created_at desc nulls last",
  name: "lower(coalesce(name, email, phone)) asc nulls last",
};
export const PAGE_SIZE = 50;

interface Page { total: number; page: number; totalPages: number; users: AppUser[]; counts: { total: number; new30: number; active7: number } }

async function readPage(c: pg.PoolClient, base: string, opts: { q?: string; sort?: Sort; page?: number }): Promise<Page> {
  const counts = (await c.query<{ total: string; new30: string; active7: string }>(
    `select count(*) as total,
            count(*) filter (where created_at >= now() - interval '30 days') as new30,
            count(*) filter (where last_used >= now() - interval '7 days') as active7
       from (${base}) x`)).rows[0]!;
  const q = (opts.q ?? "").trim().slice(0, 200);
  // A search is a literal substring: % and _ in it mean themselves.
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const where = q ? `where name ilike $1 or email ilike $1 or phone ilike $1 or replace(phone, '+', '') ilike replace($1, '+', '')` : "";
  const params = q ? [like] : [];
  const total = q ? Number((await c.query<{ n: string }>(`select count(*) as n from (${base}) x ${where}`, params)).rows[0]!.n) : Number(counts.total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), totalPages);
  const rows = await c.query<{ name: string | null; email: string | null; phone: string | null; provider: string | null; created_at: Date | null; last_used: Date | null }>(
    `select * from (${base}) x ${where} order by ${ORDER[opts.sort ?? "created"] ?? ORDER.created} limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`, params);
  const iso = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
  return {
    total, page, totalPages,
    users: rows.rows.map((r) => ({ name: r.name, email: r.email, phone: r.phone, provider: r.provider, createdAt: iso(r.created_at), lastUsedAt: iso(r.last_used) })),
    counts: { total: Number(counts.total), new30: Number(counts.new30), active7: Number(counts.active7) },
  };
}

// ---- the saved source --------------------------------------------------------------------

function row(appId: string): Row | undefined {
  return db.prepare("SELECT app_id, url_enc, url_hint, kind, mapping, updated_at FROM app_user_sources WHERE app_id = ?").get(appId) as Row | undefined;
}

export function sourceOf(appId: string) {
  const r = row(appId);
  if (!r) return { connected: false as const };
  return { connected: true as const, kind: r.kind, hint: r.url_hint, mapping: r.kind === "table" ? json<Mapping | null>(r.mapping, null) : null, updatedAt: r.updated_at };
}

/** The saved connection string, for re-inspecting without pasting it again. */
export function savedUrl(appId: string): string {
  const r = row(appId);
  if (!r) throw new UsersError("This app has no database connected.", 404);
  return open(r.url_enc);
}

function cleanMapping(m: unknown): Mapping {
  const x = (m ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof x[k] === "string" && (x[k] as string).trim() ? (x[k] as string).trim().slice(0, 63) : undefined);
  const schema = s("schema"), table = s("table");
  if (!schema || !table) throw new UsersError("Pick the table that holds the users.");
  return { schema, table, name: s("name"), email: s("email"), phone: s("phone"), created: s("created"), lastUsed: s("lastUsed") };
}

/** Saves the source once a first page has actually been read through it. */
export async function connect(appId: string, input: { url?: string; kind?: string; mapping?: unknown }) {
  const url = input.url?.trim() || (row(appId) ? savedUrl(appId) : "");
  if (!url) throw new UsersError("Paste the database's connection string.");
  const kind: Kind = input.kind === "table" ? "table" : "supabase";
  const map = kind === "table" ? cleanMapping(input.mapping) : null;
  const sample = await withUrl(url, (pool) => readOnly(pool, async (c) => readPage(c, await baseQuery(c, kind, map), { page: 1 })));
  const t = now();
  db.prepare(`INSERT INTO app_user_sources (app_id, url_enc, url_hint, kind, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET url_enc = excluded.url_enc, url_hint = excluded.url_hint, kind = excluded.kind,
      mapping = excluded.mapping, updated_at = excluded.updated_at`)
    .run(appId, seal(url), hintOf(url), kind, JSON.stringify(map ?? {}), t, t);
  dropPool(appId);
  return { ...sourceOf(appId), users: sample.counts.total };
}

export function disconnect(appId: string): void {
  db.prepare("DELETE FROM app_user_sources WHERE app_id = ?").run(appId);
  dropPool(appId);
}

export async function listUsers(appId: string, opts: { q?: string; sort?: Sort; page?: number }): Promise<Page> {
  const r = row(appId);
  if (!r) throw new UsersError("This app has no database connected.", 404);
  const map = r.kind === "table" ? json<Mapping | null>(r.mapping, null) : null;
  const pool = poolFor(appId, open(r.url_enc), r.updated_at);
  return readOnly(pool, async (c) => readPage(c, await baseQuery(c, r.kind, map), opts));
}
