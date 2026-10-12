// A Users tab (on each Sending app and each company): the people who use the
// product, read from its own database —
// a Supabase project's sign-ins, or any table mapped once. Name, how they sign
// in (email or phone), when the account was made and when it was last used.
// Xooteq only reads; the connection string never comes back to the page.
import { useCallback, useEffect, useState } from "react";
import { del, get, post, put } from "../../api";
import { useApp } from "../../store";
import type { AppUser, AppUsersPage, ProfileMap, UserInspect, UserMapping, UserSource, UserTable } from "../../types";
import { cls } from "../../util";
import { Refresh, Search, User } from "../../icons";
import { Avatar, Button, Card, Empty, Field, Input, Pill, Segmented, Spinner } from "../../ui";
import { PageHead } from "./Settings";

/** Whose users: a Sending app or a company, and where its Users API is. */
export type UsersOwner = { name: string; base: string };
const n = (v?: number) => (v ?? 0).toLocaleString();

/** Supabase keeps phone numbers as digits only; people read them with a +. */
const phoneText = (p: string) => (/^\d{8,15}$/.test(p) ? `+${p}` : p);
const dateText = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
/** "just now", "5 min ago", "3 h ago", "4 days ago", then the date. */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 31) return d === 1 ? "yesterday" : `${d} days ago`;
  return dateText(iso);
}
const PROVIDER: Record<string, string> = { email: "Email", phone: "Phone", google: "Google", apple: "Apple", github: "GitHub", anonymous: "Guest" };

export function AppUsers({ app }: { app: UsersOwner }) {
  const { toast } = useApp();
  const [src, setSrc] = useState<UserSource | null>(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => get<UserSource>(`${app.base}/source`).then(setSrc).catch((e) => toast({ text: (e as Error).message, tone: "error" })), [app.base, toast]);
  useEffect(() => { load(); }, [load]);
  if (!src) return <div className="center-pad"><Spinner /></div>;
  if (!src.connected || editing) {
    return <Connect app={app} saved={src.connected ? src : null}
      onCancel={src.connected ? () => setEditing(false) : undefined}
      onDone={(users) => { setEditing(false); load(); toast({ text: `Connected. ${n(users)} ${users === 1 ? "user" : "users"}.`, tone: "ok" }); }} />;
  }
  return <UserList app={app} src={src} onChange={() => setEditing(true)} onDisconnect={async () => {
    if (!confirm(`Disconnect ${app.name}'s database? Nothing in the database changes; Xooteq forgets the connection.`)) return;
    try { await del(`${app.base}/source`); toast({ text: "Disconnected." }); load(); }
    catch (e) { toast({ text: (e as Error).message, tone: "error" }); }
  }} />;
}

// ---- connecting -----------------------------------------------------------------------------

const FIELDS: { key: keyof Omit<UserMapping, "schema" | "table">; label: string; hint?: string }[] = [
  { key: "name", label: "Name" },
  { key: "gender", label: "Gender" },
  { key: "email", label: "Email", hint: "Email or phone, at least one." },
  { key: "phone", label: "Phone" },
  { key: "created", label: "Account created" },
  { key: "onboarded", label: "Onboarded", hint: "When they finished onboarding." },
  { key: "lastUsed", label: "Last used" },
];

/** "profiles · full_name, gender, onboarded_at", or with its schema when not public. */
const whereNames = (p: ProfileMap) =>
  `${p.schema === "public" ? "" : `${p.schema}.`}${p.table} · ${[[p.name, p.nameLast].filter(Boolean).join(" + "), p.gender, p.onboardedAt ?? p.onboarded, p.lastSeen].filter(Boolean).join(", ")}`;

/** A first guess for a table picked by hand: its user-id column, name, gender and onboarding. */
function guessNames(t: UserTable): ProfileMap {
  const cols = t.columns.map((c) => c.name);
  const key = cols.find((c) => /^(user_?id|uid|user_?uuid|auth_?(user_?)?id|owner_?id)$/i.test(c))
    ?? cols.find((c) => c === "id") ?? t.columns.find((c) => c.type === "uuid")?.name ?? cols[0] ?? "";
  const flag = t.columns.find((c) => c.type === "boolean" && /^(is_?|has_?)?onboarded$|^onboarding_?(complete|completed|done|finished)$/i.test(c.name))?.name;
  const seen = t.columns.find((c) => /timestamp|date/i.test(c.type) && /^last_?(seen|active|activity|used|opened)(_?at)?$/i.test(c.name))?.name;
  return { schema: t.schema, table: t.table, key, name: t.guess.name, gender: t.guess.gender, onboardedAt: t.guess.onboarded, onboarded: flag, lastSeen: seen };
}

function Connect({ app, saved, onDone, onCancel }: { app: UsersOwner; saved: Extract<UserSource, { connected: true }> | null; onDone: (users: number) => void; onCancel?: () => void }) {
  const [url, setUrl] = useState("");
  const [found, setFound] = useState<UserInspect | null>(null);
  const [kind, setKind] = useState<"supabase" | "table">(saved?.kind ?? "supabase");
  const [map, setMap] = useState<UserMapping | null>(saved?.mapping ?? null);
  // Supabase: where the names come from. null = found automatically.
  const [names, setNames] = useState<ProfileMap | null>(saved?.profile ?? null);
  const namesTable: UserTable | undefined = found?.tables.find((t) => names && t.schema === names.schema && t.table === names.table);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const table: UserTable | undefined = found?.tables.find((t) => map && t.schema === map.schema && t.table === map.table);

  const look = async () => {
    setBusy("look"); setError("");
    try {
      const r = await post<UserInspect>(`${app.base}/inspect`, url.trim() ? { url } : {});
      setFound(r);
      const k = saved && !url.trim() ? saved.kind : r.supabase ? "supabase" : "table";
      setKind(k);
      const keep = saved?.mapping && r.tables.some((t) => t.schema === saved.mapping!.schema && t.table === saved.mapping!.table);
      setMap(keep ? saved!.mapping : r.tables[0]?.guess ?? null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };
  const save = async () => {
    setBusy("save"); setError("");
    try {
      const r = await put<{ users: number }>(`${app.base}/source`, { ...(url.trim() ? { url } : {}), kind, ...(kind === "table" ? { mapping: map } : { profile: names }) });
      onDone(r.users);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };

  return (
    <>
      <PageHead title="Users" sub={`The people who use ${app.name}, read from its own database: their name, gender, email, when they joined and finished onboarding, and when they last used it.`}
        actions={onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>} />
      <Card title={saved ? "Change the connection" : "Connect the database"}
        subtitle={<>Xooteq only reads: every query runs in a read-only transaction. The connection string is stored encrypted and never shown again.</>}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); look(); }}>
          <Field label="Connection string" error={!found ? error || undefined : undefined}
            hint={saved ? <>Leave empty to keep <span className="mono">{saved.hint}</span>.</>
              : <>Supabase: the project's <b>Connect</b> button → <b>Session pooler</b>, with the database password filled in. Any Postgres works; a login that can only read is best.</>}>
            <Input id="users-url" type="password" autoComplete="off" spellCheck={false} value={url} onChange={(e) => { setUrl(e.target.value); setFound(null); }}
              placeholder="postgresql://postgres.abcd:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" />
          </Field>
          {!found && <div className="form-foot"><Button variant="primary" type="submit" busy={busy === "look"} disabled={!url.trim() && !saved}>Look at the database</Button></div>}
        </form>
      </Card>

      {found && (
        <Card title="Where the users are" subtitle={<>Connected to <span className="mono">{found.hint}</span>.</>}>
          <div className="form">
            {found.supabase && (
              <Field label="Read from">
                <Segmented value={kind} onChange={setKind} options={[
                  { value: "supabase", label: "Supabase sign-ins" },
                  { value: "table", label: "A table of my own" },
                ]} />
              </Field>
            )}
            {kind === "supabase" ? (
              <>
                <p className="field-hint">Every account in <span className="mono">auth.users</span>: email or phone, the provider it signs in with, when it was made, and the last sign-in or session refresh. Deleted accounts are left out.</p>
                <div className="users-names">
                  <span className="mini-label">Names, gender and onboarding</span>
                  {!names ? (
                    <p className="field-hint">
                      {found.profile
                        ? <>From <span className="mono">{whereNames(found.profile)}</span>, what the app saved at onboarding; where it has none, the name Google or Apple sent.</>
                        : <>No table of names was found, so names are the ones Google, Apple or the sign-up form sent. If the app saves names at onboarding, pick where.</>}
                      {" "}{found.tables.length > 0 && <Button size="sm" variant="ghost" onClick={() => setNames(found.profile ?? guessNames(found.tables[0]!))}>{found.profile ? "Pick another table" : "Pick the table"}</Button>}
                    </p>
                  ) : (
                    <>
                      <div className="users-map">
                        <Field label="Table" hint="Where the app saves what it asks at onboarding.">
                          <select className="input select" value={`${names.schema}.${names.table}`} onChange={(e) => {
                            const t = found.tables.find((x) => `${x.schema}.${x.table}` === e.target.value);
                            if (t) setNames(guessNames(t));
                          }}>
                            {found.tables.map((t) => <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.schema === "public" ? t.table : `${t.schema}.${t.table}`}</option>)}
                          </select>
                        </Field>
                        {namesTable && ([
                          ["key", "User id", "The column with the user's id from sign-in."],
                          ["name", "Name", undefined],
                          ["nameLast", "Last name", "Only if the name is split in two."],
                          ["gender", "Gender", undefined],
                          ["onboardedAt", "Onboarded on", "When they finished onboarding (a date)."],
                          ["onboarded", "Onboarding finished", "A yes/no column, if there's no date."],
                          ["lastSeen", "Last seen", "The app's own last-activity time, if it keeps one."],
                        ] as const).map(([k, label, hint]) => (
                          <Field key={k} label={label} hint={hint}>
                            <select className="input select" value={names[k] ?? ""} onChange={(e) => setNames({ ...names, [k]: e.target.value || (k === "key" ? "" : undefined) })}>
                              {k !== "key" && <option value="">— none —</option>}
                              {namesTable.columns.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.type}</option>)}
                            </select>
                          </Field>
                        ))}
                      </div>
                      <p className="field-hint"><Button size="sm" variant="ghost" onClick={() => setNames(null)}>Find it automatically</Button></p>
                    </>
                  )}
                </div>
              </>
            ) : found.tables.length === 0 ? (
              <p className="field-hint">This login can't see any tables. Grant it read access to the users table, then look again.</p>
            ) : (
              <>
                <Field label="Table">
                  <select className="input select" value={map ? `${map.schema}.${map.table}` : ""} onChange={(e) => {
                    const t = found.tables.find((x) => `${x.schema}.${x.table}` === e.target.value);
                    setMap(t ? t.guess : null);
                  }}>
                    {found.tables.map((t) => <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.schema === "public" ? t.table : `${t.schema}.${t.table}`}</option>)}
                  </select>
                </Field>
                {table && map && (
                  <div className="users-map">
                    {FIELDS.map((f) => (
                      <Field key={f.key} label={f.label} hint={f.hint}>
                        <select className="input select" value={map[f.key] ?? ""} onChange={(e) => setMap({ ...map, [f.key]: e.target.value || undefined })}>
                          <option value="">— none —</option>
                          {table.columns.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.type}</option>)}
                        </select>
                      </Field>
                    ))}
                  </div>
                )}
              </>
            )}
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="form-foot">
              <Button variant="ghost" onClick={() => setFound(null)}>Back</Button>
              <Button variant="primary" busy={busy === "save"} onClick={save}
                disabled={kind === "table" ? !(map && (map.email || map.phone))
                  : !!names && !(names.key && (names.name || names.gender || names.onboardedAt || names.onboarded || names.lastSeen))}>Connect</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

// ---- the list ---------------------------------------------------------------------------------

type Sort = "created" | "onboarded" | "used" | "name";

function UserList({ app, src, onChange, onDisconnect }: { app: UsersOwner; src: Extract<UserSource, { connected: true }>; onChange: () => void; onDisconnect: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("created");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AppUsersPage | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setData(null); setError("");
    const p = new URLSearchParams({ sort, page: String(page), ...(q ? { q } : {}) });
    get<AppUsersPage>(`${app.base}?${p}`).then(setData).catch((e) => setError((e as Error).message));
  }, [app.base, q, sort, page]);
  useEffect(() => { load(); }, [load]);
  const from = src.kind === "supabase" ? "Supabase sign-ins" : src.mapping ? `${src.mapping.schema === "public" ? "" : `${src.mapping.schema}.`}${src.mapping.table}` : "a table";

  return (
    <>
      <PageHead title="Users" sub={<>{from} · <span className="mono">{src.hint}</span></>}
        actions={<>
          <Button size="sm" variant="ghost" onClick={onChange}>Change</Button>
          <Button size="sm" variant="ghost" onClick={onDisconnect}>Disconnect</Button>
        </>} />
      {data && (
        <div className="send-tiles">
          <div><b>{n(data.counts.total)}</b><span>users</span></div>
          <div><b>{n(data.counts.new30)}</b><span>joined, last 30 days</span></div>
          <div><b>{n(data.counts.active7)}</b><span>used it, last 7 days</span></div>
          {data.fields.onboarded && (
            <div><b>{n(data.counts.onboarded)}</b><span>finished onboarding{data.counts.total ? ` · ${Math.round((100 * data.counts.onboarded) / data.counts.total)}%` : ""}</span></div>
          )}
        </div>
      )}
      <div className="send-filters">
        <form className="send-search users-search" role="search" onSubmit={(e) => { e.preventDefault(); setQ(String(new FormData(e.currentTarget).get("q") ?? "").trim()); setPage(1); }}>
          <Search size={15} />
          <input className="input" name="q" defaultValue={q} placeholder="Name, email or phone" aria-label="Search users" />
          <Button type="submit" size="sm">Search</Button>
          {q && <Button size="sm" variant="ghost" onClick={(e) => { (e.currentTarget.form?.elements.namedItem("q") as HTMLInputElement).value = ""; setQ(""); setPage(1); }}>Clear</Button>}
        </form>
        <span className="bar-fill" />
        <Segmented size="sm" value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={[
          { value: "created", label: "Newest" },
          ...(data?.fields.onboarded ? [{ value: "onboarded" as const, label: "Onboarded" }] : []),
          { value: "used", label: "Last used" }, { value: "name", label: "Name" },
        ]} />
        <button className="icon-btn" aria-label="Refresh" data-tip="Refresh" onClick={load}><Refresh size={16} /></button>
      </div>
      {error ? <Card><Empty icon={<User size={22} />} title="Couldn't read the users" action={<Button onClick={onChange}>Change the connection</Button>}>{error}</Empty></Card>
        : !data ? <div className="center-pad"><Spinner /></div>
        : data.users.length === 0 ? <Card><Empty icon={<User size={22} />} title={q ? "No one matches" : "No users yet"}>{q ? `Nobody's name, email or phone contains "${q}".` : `When people sign up for ${app.name}, they show up here.`}</Empty></Card>
        : (
          <div className="send-log users-table" role="table" aria-label={`${app.name} users`}>
            <div className={cls("user-row is-head", data.fields.gender && "has-gender", data.fields.onboarded && "has-onboarded")} role="row">
              <span role="columnheader">Name</span>
              {data.fields.gender && <span role="columnheader" className="user-gender">Gender</span>}
              <span role="columnheader">Email</span>
              <span role="columnheader" className="user-created">Joined</span>
              {data.fields.onboarded && <span role="columnheader" className="user-onboarded">Onboarded</span>}
              <span role="columnheader" className="user-used">Last used</span>
            </div>
            {data.users.map((u, i) => <UserRow key={`${data.page}-${i}`} u={u} gender={data.fields.gender} onboarded={data.fields.onboarded} />)}
          </div>
        )}
      {data && data.totalPages > 1 && (
        <div className="send-pages">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {data.page} of {data.totalPages} · {n(data.total)} {q ? "found" : "users"}</span>
          <Button size="sm" variant="ghost" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}

const genderText = (g: string) => g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();

/** The onboarding cell: the day they finished, else yes or not yet, else nothing known. */
function onboardedText(u: AppUser): { text: string; none: boolean } {
  if (u.onboardedAt) return { text: dateText(u.onboardedAt), none: false };
  if (u.onboarded === true) return { text: "Yes", none: false };
  if (u.onboarded === false) return { text: "Not yet", none: true };
  return { text: "—", none: true };
}

function UserRow({ u, gender, onboarded }: { u: AppUser; gender: boolean; onboarded: boolean }) {
  const id = u.email ?? (u.phone ? phoneText(u.phone) : "");
  const provider = u.provider ? PROVIDER[u.provider] ?? u.provider : null;
  const onb = onboardedText(u);
  return (
    <div className={cls("user-row", gender && "has-gender", onboarded && "has-onboarded")} role="row">
      <span className="user-who" role="cell">
        <Avatar name={u.name || id.split("@")[0] || "?"} email={id || u.name || "?"} size={28} />
        <span className={cls("user-name", !u.name && "is-none")}>{u.name || "No name"}</span>
      </span>
      {gender && <span className={cls("user-gender", !u.gender && "is-none")} role="cell">{u.gender ? genderText(u.gender) : "—"}</span>}
      <span className="user-auth" role="cell">
        {u.email && <span className="user-id">{u.email}</span>}
        {u.phone && <span className={cls("user-id", u.email && "is-second")}>{phoneText(u.phone)}</span>}
        {provider && <Pill tone={u.provider === "anonymous" ? "warn" : "neutral"}>{provider}</Pill>}
      </span>
      <span className="user-created" role="cell" title={u.createdAt ? new Date(u.createdAt).toLocaleString() : undefined}>{u.createdAt ? dateText(u.createdAt) : "—"}</span>
      {onboarded && (
        <span className={cls("user-onboarded", onb.none && "is-none")} role="cell" title={u.onboardedAt ? new Date(u.onboardedAt).toLocaleString() : undefined}>{onb.text}</span>
      )}
      <span className={cls("user-used", !u.lastUsedAt && "is-none")} role="cell" title={u.lastUsedAt ? new Date(u.lastUsedAt).toLocaleString() : undefined}>
        {u.lastUsedAt ? ago(u.lastUsedAt) : "Never"}
      </span>
    </div>
  );
}
