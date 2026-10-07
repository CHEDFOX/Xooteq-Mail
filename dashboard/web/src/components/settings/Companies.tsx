// All companies at a glance, and adding one: a domain, its main address, and
// the other addresses (support@, contact@, ...) that each get their own folder.
import { useEffect, useState } from "react";
import { get, post } from "../../api";
import { go, href, onNav } from "../../router";
import { useApp } from "../../store";
import type { Company } from "../../types";
import { cls, initials, isEmail } from "../../util";
import { At, Check, Folder, Inbox, Plus, Sparkle, X } from "../../icons";
import { Button, Card, Field, Input, Pill } from "../../ui";
import { PageHead } from "./Settings";

export const COLORS = ["#12A594", "#3B82F6", "#E8A23C", "#8B5CF6", "#EF4444", "#10B981", "#EC4899", "#F97316", "#06B6D4", "#64748B"];
const SUGGESTED = ["support", "contact", "sales", "billing", "info", "careers", "press", "partners"];
const titled = (s: string) => s.replace(/[._+-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function Companies() {
  const { me } = useApp();
  return (
    <>
      <PageHead title="Companies" sub="Each company is one domain: a mailbox with its addresses, folders, rules and AI voice."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => go("/settings/new")}>Add a company</Button>} />
      <div className="co-grid">
        {me?.companies.map((c) => (
          <a key={c.id} className="co-card" href={href({ page: "settings", section: "company", cid: c.id, tab: "addresses" })}
            onClick={onNav({ page: "settings", section: "company", cid: c.id, tab: "addresses" })} style={{ "--co": c.color } as React.CSSProperties}>
            <span className="co-tile">{initials(c.name)}</span>
            <span className="co-name">{c.name}</span>
            <span className="co-domain">{c.domain}</span>
            <span className="co-addrs">
              {c.addresses.slice(0, 5).map((a) => <span key={a.id} className="co-addr">{a.local}@</span>)}
              {c.addresses.length > 5 && <span className="co-addr">+{c.addresses.length - 5}</span>}
            </span>
            <span className="co-ai">
              {c.addresses.some((a) => a.aiMode !== "off")
                ? <Pill tone="accent" dot>AI on {c.addresses.filter((a) => a.aiMode !== "off").length} of {c.addresses.length}</Pill>
                : <Pill dot>AI off</Pill>}
            </span>
          </a>
        ))}
        <a className="co-card co-add" href="/settings/new" onClick={onNav("/settings/new")}>
          <span className="co-tile"><Plus size={20} /></span>
          <span className="co-name">Add a company</span>
          <span className="co-domain">Bring a domain over from Google, Zoho or anywhere else.</span>
        </a>
      </div>
    </>
  );
}

type Unclaimed = { email: string; name: string; domain: string; aliases: string[] };

export function NewCompany() {
  const { me, refreshMe, toast } = useApp();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [local, setLocal] = useState("hello");
  const [color, setColor] = useState(COLORS[(me?.companies.length ?? 0) % COLORS.length]);
  const [aliases, setAliases] = useState<{ local: string; label: string }[]>([{ local: "support", label: "Support" }, { local: "contact", label: "Contact" }]);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unclaimed, setUnclaimed] = useState<Unclaimed[]>([]);

  useEffect(() => { get<Unclaimed[]>("/api/mailboxes/unclaimed").then(setUnclaimed).catch(() => {}); }, []);

  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/^@/, "");
  const validDomain = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
  const taken = me?.companies.some((c) => c.domain === d);

  const [aliasNote, setAliasNote] = useState("");
  // Adds an address to the list, or says why not (never silently nothing).
  const addAlias = (raw: string): boolean => {
    const l = raw.trim().toLowerCase().replace(/@.*$/, "");
    if (!l) return false;
    if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(l)) {
      setAliasNote(`"${raw.trim()}" can't be an address. Use letters, digits, dots or dashes, with no spaces (e.g. customer.care).`);
      return false;
    }
    if (l === local) { setAliasNote(`${l}@ is the main address already.`); return false; }
    if (aliases.some((a) => a.local === l)) { setAliasNote(`${l}@ is already in the list.`); return false; }
    setAliases((a) => [...a, { local: l, label: titled(l) }]);
    setAliasNote("");
    return true;
  };

  function adopt(u: Unclaimed) {
    setName(u.name.includes("@") ? titled(u.domain.split(".")[0]) : u.name);
    setDomain(u.domain);
    setLocal(u.email.split("@")[0]);
    setAliases(u.aliases.map((a) => ({ local: a, label: titled(a) })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Give the company a name.");
    if (!validDomain) return setError("Enter the domain, like tailzu.space.");
    if (!isEmail(`${local}@${d}`)) return setError("The main address is not valid.");
    setBusy(true);
    try {
      const c = await post<Company>("/api/companies", { name: name.trim(), domain: d, local, color, aliases });
      await refreshMe();
      toast({ text: `${c.name} is set up. Now point ${c.domain} here.`, tone: "ok" });
      go({ page: "settings", section: "company", cid: c.id, tab: "dns" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Add a company" sub="One domain, one mailbox, as many addresses as you like. Every address gets its own folder, auto-reply and AI setting." />
      <div className="new-co">
        <form className="form card" onSubmit={create}>
          <div className="form-row">
            <Field label="Company name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tailzu" autoFocus required /></Field>
            <Field label="Domain" error={taken ? `${d} is already here.` : undefined}><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="tailzu.space" spellCheck={false} autoCapitalize="off" required /></Field>
          </div>
          <Field label="Main address" hint="The mailbox itself. Everything else arrives here too.">
            <div className="input-affix">
              <Input value={local} onChange={(e) => setLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._+-]/g, ""))} spellCheck={false} />
              <span className="affix">@{d || "your-domain"}</span>
            </div>
          </Field>
          <Field label="Other addresses" hint="Mail to each is filed in its own folder, so support, contact forms and sales never mix.">
            <div className="alias-box">
              {aliases.map((a, i) => (
                <div key={a.local} className="alias-row">
                  <At size={15} />
                  <span className="alias-addr">{a.local}@{d || "…"}</span>
                  <span className="alias-arrow">→</span>
                  <Folder size={15} />
                  <input className="alias-label" value={a.label} aria-label={`Folder for ${a.local}`}
                    onChange={(e) => setAliases((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <button type="button" className="icon-btn" aria-label={`Remove ${a.local}`} onClick={() => setAliases((all) => all.filter((_, j) => j !== i))}><X size={14} /></button>
                </div>
              ))}
              <div className="alias-add">
                <input id="new-alias" value={extra} placeholder="Add an address, e.g. orders" aria-label="Another address"
                  onChange={(e) => { setExtra(e.target.value); setAliasNote(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (addAlias(extra)) setExtra(""); } }} />
                <Button size="sm" type="button" onClick={() => { if (addAlias(extra)) setExtra(""); }} disabled={!extra.trim()}>Add</Button>
              </div>
              {aliasNote && <div className="alias-note" role="alert">{aliasNote}</div>}
              <div className="alias-suggest">
                {SUGGESTED.filter((s) => s !== local && !aliases.some((a) => a.local === s)).map((s) => (
                  <button type="button" key={s} className="suggest-chip" onClick={() => addAlias(s)}><Plus size={12} />{s}@</button>
                ))}
              </div>
            </div>
          </Field>
          <Field label="Colour" hint="Marks the company everywhere, so you always know whose mail you are in.">
            <div className="swatches" role="radiogroup">
              {COLORS.map((c) => (
                <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={c} className={cls("swatch", c === color && "is-on")} style={{ background: c }} onClick={() => setColor(c)}>
                  {c === color && <Check size={14} />}
                </button>
              ))}
            </div>
          </Field>
          {error && <div className="form-error">{error}</div>}
          <div className="form-foot">
            <span className="form-note">Next you will see the DNS records to add at your domain's registrar.</span>
            <Button variant="primary" type="submit" busy={busy} disabled={!!taken}>Create {name.trim() || "company"}</Button>
          </div>
        </form>

        <aside className="new-preview" style={{ "--co": color } as React.CSSProperties} aria-label="Preview">
          <div className="preview-head">
            <span className="co-tile">{initials(name || "New")}</span>
            <div>
              <b>{name || "New company"}</b>
              <span>{local}@{d || "your-domain"}</span>
            </div>
          </div>
          <div className="preview-nav">
            <span className="preview-item is-active"><Inbox size={15} />Inbox</span>
            {aliases.map((a) => <span key={a.local} className="preview-item"><At size={15} />{a.label || titled(a.local)}</span>)}
          </div>
          <p className="preview-note"><Sparkle size={14} />Turn on AI replies per address once it is created.</p>
        </aside>
      </div>

      {unclaimed.length > 0 && (
        <Card title="Already on the mail server" subtitle="Mailboxes made outside the dashboard. Add one to manage it here; nothing on the server changes.">
          <div className="unclaimed">
            {unclaimed.map((u) => (
              <div key={u.email} className="unclaimed-row">
                <div><b>{u.email}</b>{u.aliases.length > 0 && <span> · also {u.aliases.map((a) => `${a}@`).join(", ")}</span>}</div>
                <Button size="sm" onClick={() => adopt(u)}>Use this</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
