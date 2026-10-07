// Sending: what your apps send through Postal (Supabase codes, contact forms,
// anything on SMTP or the API). Each app has its keys, sending domains, message
// log and blocked addresses here, so Postal's own admin is no longer needed.
import { useCallback, useEffect, useState } from "react";
import { del, get, patch, post } from "../../api";
import { go, href, onNav } from "../../router";
import { useApp } from "../../store";
import type { SendApp, SendDomain, SendKey, SendMessage, SendOverview, SendPage } from "../../types";
import { cls, initials, relative } from "../../util";
import { Copy, Eye, Key, Plus, Refresh, Send, Trash } from "../../icons";
import { Button, Card, Empty, Field, Input, Modal, Pill, Segmented, Spinner, Toggle } from "../../ui";
import { PageHead } from "./Settings";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "messages", label: "Messages" },
  { id: "domains", label: "Domains" },
  { id: "keys", label: "Keys" },
  { id: "blocked", label: "Blocked" },
  { id: "settings", label: "Settings" },
];

const base = (app: string) => `/api/sending/apps/${encodeURIComponent(app)}`;
const n = (v?: number) => (v ?? 0).toLocaleString();

function copyText(text: string, toast: ReturnType<typeof useApp>["toast"], what = "Copied.") {
  navigator.clipboard.writeText(text).then(() => toast({ text: what }), () => toast({ text: "Could not copy; select the text instead.", tone: "error" }));
}

/** Fourteen days of sending, as bars. */
function Bars({ daily }: { daily?: { day: string; sent: number; bounced: number }[] }) {
  const days = daily ?? [];
  const max = Math.max(1, ...days.map((d) => d.sent));
  return (
    <div className="send-bars" aria-label="Sent per day, last 14 days">
      {days.map((d) => (
        <span key={d.day} className="send-bar" title={`${d.day}: ${d.sent} sent${d.bounced ? `, ${d.bounced} bounced` : ""}`}>
          <span style={{ height: `${Math.max(d.sent ? 6 : 2, (d.sent / max) * 100)}%` }} className={cls(d.bounced > 0 && "has-bounce")} />
        </span>
      ))}
    </div>
  );
}

export function SendingApps() {
  const { toast } = useApp();
  const [o, setO] = useState<SendOverview | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => get<SendOverview>("/api/sending").then((x) => { setO(x); setError(""); }).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <PageHead title="Sending" sub="What your apps send through this server: sign-in codes, contact forms, receipts. Each app has its own keys, domains and message log."
        actions={o && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New app</Button>} />
      {error ? <Card><Empty icon={<Send size={22} />} title="Sending isn't connected">{error}</Empty></Card>
        : !o ? <div className="center-pad"><Spinner /></div> : (
        <>
          <div className="send-grid">
            {o.servers.map((s) => (
              <a key={s.id} className="send-card" href={href({ page: "settings", section: "sending", cid: s.id, tab: "overview" })} onClick={onNav({ page: "settings", section: "sending", cid: s.id, tab: "overview" })}>
                <div className="send-card-head">
                  <span className="send-tile">{initials(s.name)}</span>
                  <div>
                    <b>{s.name}</b>
                    <span className="mono">{s.smtpUsername}</span>
                  </div>
                  <span className="bar-fill" />
                  {s.mode === "Development" ? <Pill tone="warn" dot>Development</Pill> : s.suspended ? <Pill tone="error" dot>Suspended</Pill> : <Pill tone="ok" dot>Live</Pill>}
                </div>
                <Bars daily={s.daily} />
                <div className="send-nums">
                  <span><b>{n(s.sent24h)}</b> sent today</span>
                  <span className={cls((s.bounced24h ?? 0) > 0 && "is-bad")}><b>{n(s.bounced24h)}</b> bounced</span>
                  <span className={cls((s.held ?? 0) > 0 && "is-warn")}><b>{n(s.held)}</b> held</span>
                </div>
              </a>
            ))}
            {o.servers.length === 0 && <Card><Empty icon={<Send size={22} />} title="No apps yet" action={<Button variant="primary" onClick={() => setCreating(true)}>New app</Button>}>Make one per thing that sends mail, e.g. "Tailzu" for its sign-in codes.</Empty></Card>}
          </div>
          <Card title="Connecting an app" subtitle="Every app connects the same way; each has its own username and keys.">
            <div className="kv"><span>SMTP server</span><code>{o.smtp.host}</code><button className="icon-btn" aria-label="Copy" onClick={() => copyText(o.smtp.host, toast)}><Copy size={14} /></button></div>
            <div className="kv"><span>Port</span><code>{o.smtp.port} ({o.smtp.security})</code><span /></div>
            <div className="kv"><span>HTTP API</span><code>{o.api.url}</code><button className="icon-btn" aria-label="Copy" onClick={() => copyText(o.api.url, toast)}><Copy size={14} /></button></div>
          </Card>
        </>
      )}
      {creating && <NewApp onClose={() => setCreating(false)} onDone={(s) => { setCreating(false); toast({ text: `${s.name} is ready. Add a domain and a key next.`, tone: "ok" }); go({ page: "settings", section: "sending", cid: s.id, tab: "domains" }); }} />}
    </>
  );
}

function NewApp({ onClose, onDone }: { onClose: () => void; onDone: (s: SendApp) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try { onDone(await post<SendApp>("/api/sending/apps", { name, mode: "Live" })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New app" width={480}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!name.trim()} onClick={submit}>Create</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Name" hint="What sends the mail: an app, a site, a service." error={error || undefined}>
          <Input id="new-app-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Plutto" autoFocus maxLength={60} />
        </Field>
      </form>
    </Modal>
  );
}

export function SendingApp({ id, tab }: { id: string; tab: string }) {
  const { toast } = useApp();
  const [s, setS] = useState<SendApp | null>(null);
  const [o, setO] = useState<SendOverview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => get<SendApp>(base(id)).then((x) => { setS(x); setError(""); }).catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => { load(); get<SendOverview>("/api/sending").then(setO).catch(() => {}); }, [load]);
  if (error) return <Card><Empty icon={<Send size={22} />} title="Can't open this app">{error}</Empty></Card>;
  if (!s) return <div className="center-pad"><Spinner /></div>;
  const r = (t: string) => ({ page: "settings" as const, section: "sending", cid: id, tab: t });
  return (
    <div>
      <header className="co-head">
        <span className="send-tile is-big">{initials(s.name)}</span>
        <div>
          <h2>{s.name}</h2>
          <p><span className="mono">{s.smtpUsername}</span> · {s.domains} {s.domains === 1 ? "domain" : "domains"} · {s.credentials} {s.credentials === 1 ? "key" : "keys"}</p>
        </div>
        {s.mode === "Development" ? <Pill tone="warn" dot>Development</Pill> : <Pill tone="ok" dot>Live</Pill>}
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <a key={t.id} role="tab" aria-selected={tab === t.id} className={cls("tab", tab === t.id && "is-active")} href={href(r(t.id))} onClick={onNav(r(t.id))}>
            {t.label}{t.id === "messages" && (s.held ?? 0) > 0 && <span className="tab-count">{s.held}</span>}
          </a>
        ))}
      </nav>
      {tab === "messages" ? <Messages app={s} />
        : tab === "domains" ? <Domains app={s} onChange={load} />
        : tab === "keys" ? <Keys app={s} onChange={load} />
        : tab === "blocked" ? <Blocked app={s} />
        : tab === "settings" ? <AppSettings app={s} onChange={load} toast={toast} />
        : <Overview app={s} o={o} />}
    </div>
  );
}

function Overview({ app, o }: { app: SendApp; o: SendOverview | null }) {
  const { toast } = useApp();
  const smtpKey = app.credentialList?.find((k) => k.type === "SMTP" && !k.hold);
  const apiKey = app.credentialList?.find((k) => k.type === "API" && !k.hold);
  const domain = app.domainList?.[0]?.name;
  const [to, setTo] = useState("");
  const [from, setFrom] = useState(domain ? `test@${domain}` : "");
  const [busy, setBusy] = useState(false);
  const row = (k: string, v: string, secret = false) => (
    <div className="kv"><span>{k}</span><code className={cls(secret && "is-secret")}>{secret ? `${v.slice(0, 4)}••••••••${v.slice(-4)}` : v}</code>
      <button className="icon-btn" aria-label={`Copy ${k}`} onClick={() => copyText(v, toast, `${k} copied.`)}><Copy size={14} /></button></div>
  );
  return (
    <>
      <div className="send-tiles">
        <div><b>{n(app.sent24h)}</b><span>sent, last 24 h</span></div>
        <div className={cls((app.bounced24h ?? 0) > 0 && "is-bad")}><b>{n(app.bounced24h)}</b><span>bounced, last 24 h</span></div>
        <div className={cls((app.held ?? 0) > 0 && "is-warn")}><b>{n(app.held)}</b><span>held for review</span></div>
        <div><b>{n(app.queued)}</b><span>waiting to send</span></div>
        <div className={cls((app.bounceRate ?? 0) > 5 && "is-bad")}><b>{(app.bounceRate ?? 0).toFixed(1)}%</b><span>bounce rate, 30 days</span></div>
      </div>
      <Card title="Last 14 days"><Bars daily={app.daily} /></Card>
      <div className="form-row">
        <Card title="SMTP" subtitle="For Supabase and anything with SMTP settings.">
          {o && row("Server", o.smtp.host)}
          {o && <div className="kv"><span>Port</span><code>{o.smtp.port} · {o.smtp.security}</code><span /></div>}
          {row("Username", app.smtpUsername)}
          {smtpKey ? row("Password", smtpKey.key, true) : <p className="field-hint">No SMTP key yet. <a href={href({ page: "settings", section: "sending", cid: app.id, tab: "keys" })} onClick={onNav({ page: "settings", section: "sending", cid: app.id, tab: "keys" })}>Make one</a>.</p>}
        </Card>
        <Card title="HTTP API" subtitle="For code that sends with a POST request.">
          {o && row("URL", o.api.url)}
          {o && row("Header", o.api.header)}
          {apiKey ? row("Key", apiKey.key, true) : <p className="field-hint">No API key yet. <a href={href({ page: "settings", section: "sending", cid: app.id, tab: "keys" })} onClick={onNav({ page: "settings", section: "sending", cid: app.id, tab: "keys" })}>Make one</a>.</p>}
        </Card>
      </div>
      <Card title="Send a test" subtitle="Goes through this app like real mail, and shows up under Messages.">
        <form className="form-inline" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try {
            await post(`${base(app.id)}/test`, { from, to });
            toast({ text: `Queued to ${to}. Watch it under Messages.`, tone: "ok" });
          } catch (err) { toast({ text: (err as Error).message, tone: "error" }); }
          finally { setBusy(false); }
        }}>
          <Input id="test-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={domain ? `test@${domain}` : "From, on one of its domains"} aria-label="From" />
          <Input id="test-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" aria-label="To" required />
          <Button variant="primary" type="submit" busy={busy} icon={<Send size={15} />} disabled={!to || !from}>Send test</Button>
        </form>
      </Card>
    </>
  );
}

const STATUS_TONE: Record<string, "ok" | "warn" | "error" | "neutral" | "info"> = {
  Sent: "ok", Pending: "info", Held: "warn", SoftFail: "warn", HardFail: "error", Bounced: "error", Processed: "ok",
};

function Messages({ app }: { app: SendApp }) {
  const { toast } = useApp();
  const [scope, setScope] = useState<"outgoing" | "incoming" | "held">((app.held ?? 0) > 0 ? "held" : "outgoing");
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SendPage<{ messages: SendMessage[] }> | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    const q = new URLSearchParams({ scope, page: String(page), ...(to ? { to } : {}), ...(from ? { from } : {}), ...(status ? { status } : {}) });
    setData(null);
    get<SendPage<{ messages: SendMessage[] }>>(`${base(app.id)}/messages?${q}`).then(setData).catch((e) => toast({ text: (e as Error).message, tone: "error" }));
  }, [app.id, scope, page, to, from, status, toast]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="send-filters">
        <Segmented value={scope} onChange={(v) => { setScope(v); setPage(1); }} options={[{ value: "outgoing", label: "Sent" }, { value: "incoming", label: "Received" }, { value: "held", label: `Held${app.held ? ` (${app.held})` : ""}` }]} />
        <form className="send-search" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setTo(String(f.get("to") ?? "").trim()); setFrom(String(f.get("from") ?? "").trim()); setPage(1); }}>
          <input className="input" name="to" defaultValue={to} placeholder="To address" aria-label="To address" />
          <input className="input" name="from" defaultValue={from} placeholder="From address" aria-label="From address" />
          {scope !== "held" && (
            <select className="input select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
              <option value="">Any status</option>
              {["Sent", "Pending", "SoftFail", "HardFail", "Bounced", "Held"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          <Button type="submit" size="sm">Filter</Button>
        </form>
        <span className="bar-fill" />
        <button className="icon-btn" aria-label="Refresh" data-tip="Refresh" onClick={load}><Refresh size={16} /></button>
      </div>
      {!data ? <div className="center-pad"><Spinner /></div> : data.messages.length === 0 ? (
        <Card><Empty icon={<Send size={22} />} title={scope === "held" ? "Nothing held" : "No messages"}>{scope === "held" ? "Mail Postal holds back (suspected spam, a held key, Development mode) waits here for you." : "Nothing matches. Messages are kept for a while after sending."}</Empty></Card>
      ) : (
        <div className="send-log">
          {data.messages.map((m) => (
            <button key={m.id} className="send-row" onClick={() => setOpen(m.id)}>
              <Pill tone={STATUS_TONE[m.status] ?? "neutral"} dot>{m.status}</Pill>
              <span className="send-row-main">
                <span className="send-row-to">{scope === "incoming" ? m.from : m.to}</span>
                <span className="send-row-subject">{m.subject || "(no subject)"}</span>
              </span>
              <span className="send-row-from mono">{scope === "incoming" ? m.to : m.from}</span>
              <span className="send-row-time">{m.timestamp ? relative(Date.parse(m.timestamp)) : ""}</span>
            </button>
          ))}
        </div>
      )}
      {data && data.totalPages > 1 && (
        <div className="send-pages">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span>Page {page} of {data.totalPages} · {n(data.total)} messages</span>
          <Button size="sm" variant="ghost" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
      {open !== null && <MessageDetail app={app} id={open} onClose={() => setOpen(null)} onChange={load} />}
    </>
  );
}

function MessageDetail({ app, id, onClose, onChange }: { app: SendApp; id: number; onClose: () => void; onChange: () => void }) {
  const { toast } = useApp();
  const [m, setM] = useState<SendMessage | null>(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { get<SendMessage>(`${base(app.id)}/messages/${id}`).then(setM).catch((e) => toast({ text: (e as Error).message, tone: "error" })); }, [app.id, id, toast]);
  const act = async (what: "retry" | "cancel-hold", done: string) => {
    setBusy(what);
    try { setM(await post<SendMessage>(`${base(app.id)}/messages/${id}/${what}`)); toast({ text: done, tone: "ok" }); onChange(); }
    catch (e) { toast({ text: (e as Error).message, tone: "error" }); }
    finally { setBusy(""); }
  };
  return (
    <Modal open onClose={onClose} width={680} title={m ? (m.subject || "(no subject)") : "Message"}
      footer={m && <>
        {m.held && <Button variant="ghost" busy={busy === "cancel-hold"} onClick={() => act("cancel-hold", "Hold cancelled; it won't be sent.")}>Don't send</Button>}
        {m.raw && <Button variant="primary" busy={busy === "retry"} onClick={() => act("retry", m.held ? "Released. It goes out shortly." : "It will be sent again shortly.")}>{m.held ? "Release and send" : "Send again"}</Button>}
      </>}>
      {!m ? <div className="center-pad"><Spinner /></div> : (
        <div className="form">
          <div className="send-detail">
            <div className="kv"><span>Status</span><Pill tone={STATUS_TONE[m.status] ?? "neutral"} dot>{m.status}</Pill><span /></div>
            <div className="kv"><span>To</span><code>{m.to}</code><span /></div>
            <div className="kv"><span>From</span><code>{m.from}</code><span /></div>
            {m.timestamp && <div className="kv"><span>{m.scope === "incoming" ? "Received" : "Handed in"}</span><code>{new Date(m.timestamp).toLocaleString()}</code><span /></div>}
            {m.messageId && <div className="kv"><span>Message-ID</span><code>{m.messageId}</code><span /></div>}
          </div>
          <div>
            <h4 className="send-h">Delivery attempts</h4>
            {m.deliveries?.length ? (
              <ol className="send-deliveries">
                {m.deliveries.map((d, i) => (
                  <li key={i}>
                    <Pill tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status}</Pill>
                    <span>{d.details || ""}{d.output ? <code className="send-output">{d.output}</code> : null}</span>
                    <span className="send-row-time">{d.timestamp ? new Date(d.timestamp).toLocaleString() : ""}{d.sentWithSsl ? " · TLS" : ""}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="field-hint">{m.queued ? "Waiting to be sent." : "No attempts yet."}</p>}
          </div>
          {m.body && <div><h4 className="send-h">Text</h4><pre className="send-body">{m.body}</pre></div>}
        </div>
      )}
    </Modal>
  );
}

const PART: Record<string, keyof SendDomain["status"]> = { SPF: "spf", DKIM: "dkim", "Return path": "returnPath", MX: "mx" };

function Domains({ app, onChange }: { app: SendApp; onChange: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const domains = app.domainList ?? [];
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); if (done) toast({ text: done, tone: "ok" }); onChange(); }
    catch (e) { toast({ text: (e as Error).message, tone: "error" }); }
    finally { setBusy(""); }
  };
  return (
    <>
      <PageHead title="Sending domains" sub={`${app.name} can send from addresses on these domains. Add each record at the domain's DNS (Hostinger), then Check.`} />
      {domains.map((d) => {
        const bad = Object.entries(d.status).filter(([k, v]) => k !== "mx" && v.status !== "OK").length;
        const pill = !d.checkedAt ? <Pill dot>Not checked yet</Pill> : bad ? <Pill tone="warn" dot>{bad} to fix</Pill> : <Pill tone="ok" dot>Ready</Pill>;
        return (
          <Card key={d.id} className="send-domain" title={<>{d.name} {pill}</>}
            subtitle={d.checkedAt ? `Checked ${relative(Date.parse(d.checkedAt))}` : "Not checked yet"}
            actions={<>
              <Button size="sm" icon={<Refresh size={15} />} busy={busy === `check-${d.id}`} onClick={() => run(`check-${d.id}`, () => post(`${base(app.id)}/domains/${d.id}/check`), `Checked ${d.name}.`)}>Check</Button>
              <button className="icon-btn" aria-label={`Remove ${d.name}`} data-tip="Remove" onClick={() => { if (confirm(`Stop ${app.name} sending from ${d.name}?`)) run(`rm-${d.id}`, () => del(`${base(app.id)}/domains/${d.id}`), `${d.name} removed.`); }}><Trash size={16} /></button>
            </>}>
            <div className="dns-list">
              {d.records.map((r) => {
                const st = d.status[PART[r.kind]];
                const ok = st?.status === "OK";
                return (
                  <div key={r.kind} className={cls("dns", ok ? "is-ok" : r.required ? "is-missing" : "is-unknown")}>
                    <div className="dns-top">
                      <span className="dns-kind">{r.kind}</span>
                      <span className="dns-type">{r.type}{r.priority !== undefined ? ` · priority ${r.priority}` : ""}</span>
                      {!r.required && <Pill>Optional</Pill>}
                      <span className="bar-fill" />
                      <Pill tone={ok ? "ok" : !st?.status ? "neutral" : r.required ? "error" : "neutral"} dot>{ok ? "Found" : st?.status ?? "Not checked"}</Pill>
                    </div>
                    <p className="dns-why">{r.why}</p>
                    <div className="dns-fields">
                      <div className="dns-field"><span className="mini-label">Name / Host</span><code>{r.host}</code><button className="icon-btn" aria-label="Copy name" onClick={() => copyText(r.host, toast)}><Copy size={14} /></button></div>
                      <div className="dns-field"><span className="mini-label">Value</span><code className="dns-value">{r.value}</code><button className="icon-btn" aria-label="Copy value" onClick={() => copyText(r.value, toast)}><Copy size={14} /></button></div>
                    </div>
                    {!ok && st?.error && <p className="dns-note">{st.error}</p>}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      <Card title="Add a domain" subtitle="It gets its own signing key. Mail from it is signed once the DKIM record is in place.">
        <form className="form-inline" onSubmit={(e) => { e.preventDefault(); run("add", () => post(`${base(app.id)}/domains`, { name }), `${name} added. Add its records next.`).then(() => setName("")); }}>
          <Input id="send-domain" value={name} onChange={(e) => setName(e.target.value.toLowerCase().trim())} placeholder="plutto.space" aria-label="Domain" spellCheck={false} />
          <Button variant="primary" type="submit" busy={busy === "add"} disabled={!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)}>Add domain</Button>
        </form>
      </Card>
    </>
  );
}

function Keys({ app, onChange }: { app: SendApp; onChange: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState("");
  const [type, setType] = useState<"SMTP" | "API">("SMTP");
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const keys = app.credentialList ?? [];
  const run = async (k: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(k);
    try { await fn(); if (done) toast({ text: done, tone: "ok" }); onChange(); }
    catch (e) { toast({ text: (e as Error).message, tone: "error" }); }
    finally { setBusy(""); }
  };
  return (
    <>
      <PageHead title="Keys" sub={<>One per thing that sends, so each can be paused or replaced alone. SMTP keys are passwords with the username <span className="mono">{app.smtpUsername}</span>.</>} />
      {keys.length === 0 ? <Card><Empty icon={<Key size={22} />} title="No keys yet">Make one below for each app or service that sends through {app.name}.</Empty></Card> : (
        <div className="addr-list">
          {keys.map((k) => (
            <div key={k.id} className="addr">
              <div className="addr-main">
                <span className="addr-icon"><Key size={16} /></span>
                <div>
                  <div className="addr-email">{k.name} <Pill tone={k.type === "API" ? "info" : "neutral"}>{k.type}</Pill>{k.hold && <Pill tone="warn" dot>Holding</Pill>}</div>
                  <div className="addr-folder">
                    <code className="send-key">{shown.has(k.id) ? k.key : `${k.key.slice(0, 4)}••••••••••••${k.key.slice(-4)}`}</code>
                    <span className="addr-dot">·</span>
                    <span>{k.lastUsedAt ? `used ${relative(Date.parse(k.lastUsedAt))}` : "never used"}</span>
                  </div>
                </div>
              </div>
              <div className="addr-ctl">
                <button className="icon-btn" aria-label={shown.has(k.id) ? "Hide key" : "Show key"} data-tip={shown.has(k.id) ? "Hide" : "Show"} onClick={() => setShown((x) => { const y = new Set(x); if (y.has(k.id)) y.delete(k.id); else y.add(k.id); return y; })}><Eye size={16} /></button>
                <button className="icon-btn" aria-label="Copy key" data-tip="Copy" onClick={() => copyText(k.key, toast, "Key copied.")}><Copy size={16} /></button>
                <div className="addr-ctl-item">
                  <span className="mini-label">Hold mail</span>
                  <Toggle checked={k.hold} label="Hold mail sent with this key" onChange={(v) => run(`hold-${k.id}`, () => patch(`${base(app.id)}/credentials/${k.id}`, { hold: v }), v ? `Mail sent with ${k.name} now waits under Held.` : `${k.name} sends normally again.`)} />
                </div>
                <button className="icon-btn" aria-label={`Delete ${k.name}`} data-tip="Delete key" onClick={() => { if (confirm(`Delete the key "${k.name}"? Anything using it stops sending at once.`)) run(`rm-${k.id}`, () => del(`${base(app.id)}/credentials/${k.id}`), `${k.name} deleted.`); }}><Trash size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Card title="New key">
        <form className="form-inline" onSubmit={(e) => { e.preventDefault(); run("add", () => post(`${base(app.id)}/credentials`, { name, type }), `Key "${name}" made.`).then(() => setName("")); }}>
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="What uses it, e.g. supabase" aria-label="Key name" />
          <Segmented value={type} onChange={setType} options={[{ value: "SMTP", label: "SMTP" }, { value: "API", label: "API" }]} />
          <Button variant="primary" type="submit" busy={busy === "add"} disabled={!name.trim()}>Make key</Button>
        </form>
      </Card>
    </>
  );
}

function Blocked({ app }: { app: SendApp }) {
  const { toast } = useApp();
  const [data, setData] = useState<SendPage<{ suppressions: { type: string; address: string; reason: string | null; since: string; until: string }[] }> | null>(null);
  const [page, setPage] = useState(1);
  const load = useCallback(() => get<typeof data>(`${base(app.id)}/suppressions?page=${page}`).then(setData).catch((e) => toast({ text: (e as Error).message, tone: "error" })), [app.id, page, toast]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <PageHead title="Blocked addresses" sub="Postal stops sending to an address that hard-bounces, so dead addresses don't hurt your reputation. Each is kept here for 30 days; remove one to try it again now." />
      {!data ? <div className="center-pad"><Spinner /></div> : data.suppressions.length === 0 ? (
        <Card><Empty icon={<Send size={22} />} title="Nothing blocked">Every address is being sent to.</Empty></Card>
      ) : (
        <div className="send-log">
          {data.suppressions.map((x) => (
            <div key={x.type + x.address} className="send-row is-static">
              <Pill tone="error">{x.type === "recipient" ? "Bounced" : x.type}</Pill>
              <span className="send-row-main"><span className="send-row-to">{x.address}</span><span className="send-row-subject">{x.reason || "no reason given"}</span></span>
              <span className="send-row-time">until {new Date(x.until).toLocaleDateString()}</span>
              <Button size="sm" variant="ghost" onClick={async () => {
                try { await del(`${base(app.id)}/suppressions?type=${encodeURIComponent(x.type)}&address=${encodeURIComponent(x.address)}`); toast({ text: `${x.address} can be sent to again.`, tone: "ok" }); load(); }
                catch (e) { toast({ text: (e as Error).message, tone: "error" }); }
              }}>Remove</Button>
            </div>
          ))}
        </div>
      )}
      {data && data.totalPages > 1 && (
        <div className="send-pages">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span>Page {page} of {data.totalPages}</span>
          <Button size="sm" variant="ghost" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </>
  );
}

function AppSettings({ app, onChange, toast }: { app: SendApp; onChange: () => void; toast: ReturnType<typeof useApp>["toast"] }) {
  const [name, setName] = useState(app.name);
  const [mode, setMode] = useState(app.mode);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <PageHead title="Settings" />
      <Card>
        <form className="form" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await patch(base(app.id), { name, mode }); toast({ text: "Saved.", tone: "ok" }); onChange(); }
          catch (err) { toast({ text: (err as Error).message, tone: "error" }); }
          finally { setBusy(false); }
        }}>
          <Field label="Name"><Input id="app-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Mode" hint={mode === "Development" ? "Development: mail is accepted and logged under Held, but nothing is delivered. For testing." : "Live: mail is delivered."}>
            <Segmented value={mode} onChange={setMode} options={[{ value: "Live", label: "Live" }, { value: "Development", label: "Development" }]} />
          </Field>
          <div className="form-foot"><Button variant="primary" type="submit" busy={busy} disabled={name === app.name && mode === app.mode}>Save</Button></div>
        </form>
      </Card>
      <Card title="Delete this app" subtitle="Its keys stop working at once and its message log is removed. Its username can't be used again." className="card-danger">
        <Button variant="danger" icon={<Trash size={16} />} onClick={() => setDeleting(true)}>Delete {app.name}</Button>
      </Card>
      {deleting && (
        <Modal open onClose={() => setDeleting(false)} title={`Delete ${app.name}?`} width={480}
          footer={<><Button variant="ghost" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" disabled={confirmName !== app.name} onClick={async () => {
              try { await del(base(app.id)); toast({ text: `${app.name} deleted.` }); go("/settings/sending"); }
              catch (err) { toast({ text: (err as Error).message, tone: "error" }); }
            }}>Delete</Button></>}>
          <Field label={<>Type <b>{app.name}</b> to confirm</>}><Input id="confirm-delete" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoFocus /></Field>
        </Modal>
      )}
    </>
  );
}
