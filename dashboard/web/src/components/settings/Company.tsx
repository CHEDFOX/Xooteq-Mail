// One company: its addresses (each with a folder, auto-reply and AI mode),
// rules, AI voice, DNS, access from mail apps, and its name and colour.
import { useCallback, useEffect, useState } from "react";
import { del, get, patch, post } from "../../api";
import { go, href, onNav } from "../../router";
import { useApp } from "../../store";
import type { Address, AiMode, AutoReply, Company, DnsRecord, Provider, Rule } from "../../types";
import { cls, initials } from "../../util";
import { Alert, At, Check, Copy, Folder, Globe, Mail, Refresh, Sparkle, Trash } from "../../icons";
import { Button, Card, Field, Input, Modal, Pill, Segmented, Spinner, Textarea, Toggle } from "../../ui";
import { PageHead } from "./Settings";
import { COLORS } from "./Companies";
import { Rules } from "./Rules";
import { AiProfile } from "./Ai";

export type FullCompany = Company & { rules: Rule[] };

const TABS = [
  { id: "addresses", label: "Addresses" },
  { id: "rules", label: "Rules" },
  { id: "ai", label: "AI replies" },
  { id: "dns", label: "Domain & DNS" },
  { id: "apps", label: "Mail apps" },
  { id: "general", label: "General" },
];

export function CompanySettings({ cid, tab }: { cid: string; tab: string }) {
  const { toast } = useApp();
  const [c, setC] = useState<FullCompany | null>(null);
  const load = useCallback(() => get<FullCompany>(`/api/companies/${encodeURIComponent(cid)}`).then(setC).catch((e) => toast({ text: (e as Error).message, tone: "error" })), [cid, toast]);
  useEffect(() => { load(); }, [load]);
  if (!c) return <div className="center-pad"><Spinner /></div>;
  return (
    <div style={{ "--co": c.color } as React.CSSProperties}>
      <header className="co-head">
        <span className="co-tile">{initials(c.name)}</span>
        <div>
          <h2>{c.name}</h2>
          <p>{c.domain} · {c.addresses.length} {c.addresses.length === 1 ? "address" : "addresses"}</p>
        </div>
        <a className="btn btn-secondary btn-md" href={href({ page: "mail", cid: c.id, box: "inbox" })} onClick={onNav({ page: "mail", cid: c.id, box: "inbox" })}><Mail size={16} /><span>Open mail</span></a>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <a key={t.id} role="tab" aria-selected={tab === t.id} className={cls("tab", tab === t.id && "is-active")}
            href={href({ page: "settings", section: "company", cid, tab: t.id })} onClick={onNav({ page: "settings", section: "company", cid, tab: t.id })}>{t.label}</a>
        ))}
      </nav>
      {tab === "addresses" ? <Addresses c={c} onChange={setC} />
        : tab === "rules" ? <Rules c={c} onSaved={(rules) => setC({ ...c, rules })} />
        : tab === "ai" ? <AiProfile c={c} />
        : tab === "dns" ? <Dns c={c} />
        : tab === "apps" ? <MailApps c={c} />
        : <General c={c} onChange={setC} />}
    </div>
  );
}

const AI_MODES: { value: AiMode; label: string; title: string }[] = [
  { value: "off", label: "Off", title: "No AI on this address" },
  { value: "draft", label: "Draft", title: "AI writes a reply into Drafts for you to check and send" },
  { value: "send", label: "Send", title: "AI replies by itself, unless a person should answer" },
];

function Addresses({ c, onChange }: { c: FullCompany; onChange: (c: FullCompany) => void }) {
  const { toast, refreshMe } = useApp();
  const [local, setLocal] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Address | null>(null);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  useEffect(() => { get<Provider[]>("/api/ai/providers").then(setProviders).catch(() => setProviders([])); }, []);

  const apply = async (key: string, fn: () => Promise<Company>, done?: string) => {
    setBusy(key);
    try {
      const next = await fn();
      onChange({ ...next, rules: c.rules });
      refreshMe();
      if (done) toast({ text: done, tone: "ok" });
      return true;
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const base = `/api/companies/${encodeURIComponent(c.id)}`;
  const anyAi = c.addresses.some((a) => a.aiMode !== "off");

  return (
    <>
      <PageHead title="Addresses" sub={<>Every address delivers to the {c.name} mailbox. Mail to each is also filed in its own folder.</>}
        actions={<Button size="sm" icon={<Refresh size={15} />} busy={busy === "sync"} onClick={() => apply("sync", () => post(`${base}/sync`), "Up to date with the server.")}>Sync</Button>} />
      {anyAi && providers && providers.length === 0 && (
        <div className="notice notice-warn"><Alert size={16} /><span>AI is on for some addresses, but there is no AI provider yet. <a href="/settings/ai" onClick={onNav("/settings/ai")}>Add a key</a> so it can write.</span></div>
      )}
      <div className="addr-list">
        {c.addresses.map((a) => (
          <div key={a.id} className="addr">
            <div className="addr-main">
              <span className="addr-icon">{a.isPrimary ? <Mail size={16} /> : <At size={16} />}</span>
              <div>
                <div className="addr-email">{a.email}{a.isPrimary && <Pill>Main</Pill>}</div>
                <div className="addr-folder">{a.isPrimary ? "Arrives in the Inbox" : <><Folder size={13} />Filed in “{a.label}”</>}</div>
              </div>
            </div>
            <div className="addr-ctl">
              <div className="addr-ctl-item">
                <span className="mini-label">Auto-reply</span>
                <button className={cls("addr-ar", a.autoReply?.enabled && "is-on")} onClick={() => setEditing(a)}>
                  {a.autoReply?.enabled ? <><Check size={13} />On</> : "Off"}
                </button>
              </div>
              <div className="addr-ctl-item">
                <span className="mini-label"><Sparkle size={12} />AI</span>
                <Segmented size="sm" value={a.aiMode} options={AI_MODES}
                  onChange={(v) => apply(`ai-${a.id}`, () => patch(`${base}/addresses/${a.id}`, { aiMode: v }),
                    v === "off" ? `AI is off for ${a.email}.` : v === "draft" ? `AI will draft replies to ${a.email} for you to check.` : `AI will answer ${a.email} by itself.`)} />
              </div>
              {a.isPrimary ? <span className="icon-btn-space" aria-hidden /> : (
                <button className="icon-btn" aria-label={`Remove ${a.email}`} data-tip="Remove address" disabled={busy === `rm-${a.id}`}
                  onClick={() => { if (confirm(`Stop receiving mail at ${a.email}? Mail already filed stays in its folder.`)) apply(`rm-${a.id}`, () => del(`${base}/addresses/${a.id}`), `${a.email} removed.`); }}>
                  <Trash size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Card title="Add an address" subtitle="For a site's contact form, a department, a campaign. It starts working as soon as it is added.">
        <form className="form-inline" onSubmit={async (e) => {
          e.preventDefault();
          if (await apply("add", () => post(`${base}/addresses`, { local, label }), `${local}@${c.domain} added.`)) { setLocal(""); setLabel(""); }
        }}>
          <div className="input-affix">
            <Input value={local} onChange={(e) => setLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._+-]/g, ""))} placeholder="orders" aria-label="Address" spellCheck={false} />
            <span className="affix">@{c.domain}</span>
          </div>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Folder name (optional)" aria-label="Folder name" />
          <Button variant="primary" type="submit" busy={busy === "add"} disabled={!local}>Add address</Button>
        </form>
      </Card>
      <div className="mode-key">
        <div><b>Off</b> Mail arrives; nobody answers it but you.</div>
        <div><b>Draft</b> AI reads each new message and leaves a reply in Drafts, marked for review. Nothing is sent until you send it.</div>
        <div><b>Send</b> AI answers by itself after a short wait you can cancel. Anything about money, complaints or legal matters, or anything it is unsure of, becomes a draft for you instead.</div>
      </div>
      {editing && (
        <AutoReplyEditor address={editing} company={c} onClose={() => setEditing(null)}
          onSave={async (r) => { if (await apply(`ar-${editing.id}`, () => patch(`${base}/addresses/${editing.id}`, { autoReply: r }), r.enabled ? `Auto-reply on for ${editing.email}.` : `Auto-reply off for ${editing.email}.`)) setEditing(null); }} />
      )}
    </>
  );
}

function AutoReplyEditor({ address, company, onClose, onSave }: { address: Address; company: Company; onClose: () => void; onSave: (r: AutoReply) => void }) {
  const cur = address.autoReply;
  const [r, setR] = useState<AutoReply>(cur ?? {
    enabled: true, subject: `Thanks for writing to ${company.name}`, days: 3, start: "", end: "",
    body: `Hello,\n\nThanks for your message. We have it and will answer within one working day.\n\n${company.name}`,
  });
  const set = (p: Partial<AutoReply>) => setR((x) => ({ ...x, ...p }));
  return (
    <Modal open onClose={onClose} title={<>Auto-reply for <span className="mono">{address.email}</span></>} width={600}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(r)}>Save</Button></>}>
      <div className="form">
        <label className="toggle-row">
          <Toggle checked={r.enabled} onChange={(v) => set({ enabled: v })} label="Auto-reply on" />
          <span><b>Send an automatic reply</b><span className="field-hint">Sent by the mail server itself, the moment mail arrives. Not sent to mailing lists or other robots.</span></span>
        </label>
        <Field label="Subject"><Input value={r.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Re: their subject" /></Field>
        <Field label="Message"><Textarea rows={7} value={r.body} onChange={(e) => set({ body: e.target.value })} /></Field>
        <div className="form-row form-row-3">
          <Field label="Once per sender every" hint="days"><Input type="number" min={1} max={365} value={r.days} onChange={(e) => set({ days: Number(e.target.value) })} /></Field>
          <Field label="From" hint="Optional"><Input type="date" value={r.start ?? ""} onChange={(e) => set({ start: e.target.value })} /></Field>
          <Field label="Until" hint="Optional, e.g. for a holiday"><Input type="date" value={r.end ?? ""} onChange={(e) => set({ end: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function Dns({ c }: { c: Company }) {
  const { toast } = useApp();
  const [records, setRecords] = useState<DnsRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    setBusy(true);
    try {
      const r = await get<{ records: DnsRecord[] }>(`/api/companies/${encodeURIComponent(c.id)}/dns`);
      setRecords(r.records);
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
      setRecords([]);
    } finally {
      setBusy(false);
    }
  }, [c.id, toast]);
  useEffect(() => { check(); }, [check]);
  const required = records?.filter((r) => r.required) ?? [];
  const ok = required.filter((r) => r.status === "ok").length;
  const ready = records && required.length > 0 && ok === required.length;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast({ text: "Copied." }));
  return (
    <>
      <PageHead title="Domain & DNS" sub={<>Add these at the place you bought <b>{c.domain}</b> (its DNS settings). Then mail for it comes here, and mail from it reaches inboxes, not spam.</>}
        actions={<Button size="sm" icon={<Refresh size={15} />} busy={busy} onClick={check}>Check again</Button>} />
      {records && required.length > 0 && (
        <div className={cls("dns-summary", ready ? "is-ok" : "is-todo")}>
          <span className="dns-ring" style={{ "--p": `${(ok / required.length) * 100}%` } as React.CSSProperties}><span>{ok}/{required.length}</span></span>
          <div>
            <b>{ready ? `${c.domain} is ready` : `${required.length - ok} ${required.length - ok === 1 ? "record" : "records"} to add or fix`}</b>
            <p>{ready ? "Mail is delivered here and signed as yours." : "Changes can take from a few minutes to a few hours to show. Check again later."}</p>
          </div>
        </div>
      )}
      {!records ? <div className="center-pad"><Spinner /></div> : (
        <div className="dns-list">
          {records.map((r, i) => (
            <div key={i} className={cls("dns", `is-${r.status ?? "unknown"}`)}>
              <div className="dns-top">
                <span className="dns-kind">{r.kind}</span>
                <span className="dns-type">{r.type}{r.priority !== undefined ? ` · priority ${r.priority}` : ""}</span>
                {!r.required && <Pill>Optional</Pill>}
                <span className="bar-fill" />
                <Pill tone={r.status === "ok" ? "ok" : r.status === "missing" ? (r.required ? "error" : "neutral") : r.status === "differs" ? "warn" : "neutral"} dot>
                  {r.status === "ok" ? "Found" : r.status === "missing" ? "Not found" : r.status === "differs" ? "Different" : "Unknown"}
                </Pill>
              </div>
              <p className="dns-why">{r.why}</p>
              <div className="dns-fields">
                <div className="dns-field"><span className="mini-label">Name / Host</span><code>{r.host}</code><button className="icon-btn" aria-label="Copy name" onClick={() => copy(r.host)}><Copy size={14} /></button></div>
                <div className="dns-field"><span className="mini-label">Value</span><code className="dns-value">{r.value}</code><button className="icon-btn" aria-label="Copy value" onClick={() => copy(r.value)}><Copy size={14} /></button></div>
              </div>
              {r.status === "differs" && r.current?.length ? <p className="dns-note">Now: <code>{r.current.join(" | ")}</code></p> : null}
              {r.note && <p className="dns-note">{r.note}</p>}
            </div>
          ))}
        </div>
      )}
      <Card title="Moving from Google Workspace or Zoho" subtitle="So no mail is lost on the way.">
        <ol className="steps">
          <li>Add the DKIM, DMARC and SPF records above first. They do not move mail yet.</li>
          <li>Replace the domain's MX records with the one above, and remove the old ones. New mail starts arriving here within the hour.</li>
          <li>Copy old mail across with <code>imapsync</code> (see the README), then cancel the old plan.</li>
        </ol>
      </Card>
    </>
  );
}

type MailApp = { username: string; incoming: { protocol: string; host: string; port: number; security: string }; outgoing: { protocol: string; host: string; port: number; security: string } };

function MailApps({ c }: { c: Company }) {
  const { toast } = useApp();
  const [info, setInfo] = useState<MailApp | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<MailApp>(`/api/companies/${encodeURIComponent(c.id)}/mail-app`).then(setInfo).catch(() => {}); }, [c.id]);
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast({ text: "Copied." }));
  const row = (k: string, v: string | number) => (
    <div className="kv"><span>{k}</span><code>{v}</code><button className="icon-btn" aria-label={`Copy ${k}`} onClick={() => copy(String(v))}><Copy size={14} /></button></div>
  );
  return (
    <>
      <PageHead title="Mail apps" sub="Read and send this company's mail from a phone or desktop app too: Apple Mail, Outlook, Thunderbird, Gmail's app." />
      {info && (
        <div className="form-row">
          <Card title="Incoming (IMAP)">{row("Server", info.incoming.host)}{row("Port", info.incoming.port)}{row("Security", info.incoming.security)}{row("Username", info.username)}</Card>
          <Card title="Outgoing (SMTP)">{row("Server", info.outgoing.host)}{row("Port", info.outgoing.port)}{row("Security", info.outgoing.security)}{row("Username", info.username)}</Card>
        </div>
      )}
      <Card title="App password" subtitle="Apps sign in with this. Setting a new one signs out apps using the old one. The dashboard does not need it.">
        <form className="form-inline" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(`/api/companies/${encodeURIComponent(c.id)}/mail-app`, { password: pw });
            toast({ text: "Password set. Use it in your mail app now; it is not shown again.", tone: "ok", ms: 8000 });
          } catch (err) {
            toast({ text: (err as Error).message, tone: "error" });
          } finally {
            setBusy(false);
          }
        }}>
          <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 12 characters" aria-label="New app password" spellCheck={false} autoComplete="new-password" />
          <Button type="button" onClick={() => setPw(Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 55]).join(""))}>Generate</Button>
          <Button variant="primary" type="submit" busy={busy} disabled={pw.length < 12}>Set password</Button>
        </form>
      </Card>
    </>
  );
}

function General({ c, onChange }: { c: FullCompany; onChange: (c: FullCompany) => void }) {
  const { toast, refreshMe } = useApp();
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);
  const [signature, setSignature] = useState(c.signature);
  const [busy, setBusy] = useState(false);
  const dirty = name !== c.name || color !== c.color || signature !== c.signature;
  return (
    <>
      <PageHead title="General" />
      <Card>
        <form className="form" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const next = await patch<Company>(`/api/companies/${encodeURIComponent(c.id)}`, { name, color, signature });
            onChange({ ...next, rules: c.rules });
            await refreshMe();
            toast({ text: "Saved.", tone: "ok" });
          } catch (err) {
            toast({ text: (err as Error).message, tone: "error" });
          } finally {
            setBusy(false);
          }
        }}>
          <Field label="Name" hint="Shown as the sender's name on mail you send."><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Colour">
            <div className="swatches">
              {[...new Set([c.color, ...COLORS])].map((x) => (
                <button type="button" key={x} className={cls("swatch", x === color && "is-on")} style={{ background: x }} aria-label={x} onClick={() => setColor(x)}>{x === color && <Check size={14} />}</button>
              ))}
            </div>
          </Field>
          <Field label="Signature" hint="Added under new mail and replies you write here.">
            <Textarea rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={`${c.name}\n${c.domain}`} />
          </Field>
          <div className="form-foot"><Button variant="primary" type="submit" busy={busy} disabled={!dirty}>Save</Button></div>
        </form>
      </Card>
      <Card title="Remove from the dashboard" subtitle={<>The mailbox, its mail and {c.domain} stay on the mail server; add it back any time from “Add a company”.</>} className="card-danger">
        <Button variant="danger" icon={<Globe size={16} />} onClick={async () => {
          if (!confirm(`Remove ${c.name} from the dashboard? Its mail stays on the server.`)) return;
          await del(`/api/companies/${encodeURIComponent(c.id)}`);
          await refreshMe();
          go("/settings");
        }}>Remove {c.name}</Button>
      </Card>
    </>
  );
}
