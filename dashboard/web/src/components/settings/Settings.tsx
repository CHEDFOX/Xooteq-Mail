// Settings: companies (and everything about each), AI providers, what the AI
// did, and the owner's account. A side list on the left, the page on the right.
import { useEffect, useState } from "react";
import { get, post } from "../../api";
import { go, href, onNav, type Route } from "../../router";
import { useApp } from "../../store";
import type { AiRun } from "../../types";
import { cls, relative } from "../../util";
import { Activity, Building, ChevronLeft, Key, Plus, Send, Sparkle, User } from "../../icons";
import { Button, Card, Empty, Field, Input, Pill, Spinner } from "../../ui";
import { Companies, NewCompany } from "./Companies";
import { CompanySettings } from "./Company";
import { Providers } from "./Ai";
import { SendingApp, SendingApps } from "./Sending";

type SettingsRoute = Extract<Route, { page: "settings" }>;

export function Settings({ route }: { route: SettingsRoute }) {
  const { me } = useApp();
  const s = route.section;
  const link = (r: Route, label: React.ReactNode, active: boolean, icon: React.ReactNode, extra?: React.ReactNode) => (
    <a href={href(r)} onClick={onNav(r)} className={cls("set-nav-item", active && "is-active")}>{icon}<span>{label}</span>{extra}</a>
  );
  return (
    <div className="settings">
      <aside className="set-nav">
        <a className="set-back" href="/" onClick={onNav("/")}><ChevronLeft size={16} />Back to mail</a>
        <h1 className="set-title">Settings</h1>
        <div className="set-group">Companies</div>
        {me?.companies.map((c) => link({ page: "settings", section: "company", cid: c.id, tab: route.cid === c.id ? route.tab : "addresses" }, c.name,
          s === "company" && route.cid === c.id, <span className="set-dot" style={{ background: c.color }} />))}
        {link({ page: "settings", section: "new" }, "Add a company", s === "new", <Plus size={16} />)}
        {link({ page: "settings", section: "companies" }, "All companies", s === "companies", <Building size={16} />)}
        <div className="set-group">Sending</div>
        {link({ page: "settings", section: "sending" }, "Apps, SMTP and API", s === "sending", <Send size={16} />)}
        <div className="set-group">Automation</div>
        {link({ page: "settings", section: "ai" }, "AI providers", s === "ai", <Key size={16} />)}
        {link({ page: "settings", section: "activity" }, "AI activity", s === "activity", <Activity size={16} />)}
        <div className="set-group">You</div>
        {link({ page: "settings", section: "account" }, "Account", s === "account", <User size={16} />)}
      </aside>
      <div className="set-page">
        {me && me.setupMissing.length > 0 && (
          <div className="set-warn">The server is missing {me.setupMissing.join(", ")}. Run workspace-setup.sh on the VPS to finish it.</div>
        )}
        {s === "companies" ? <Companies />
          : s === "new" ? <NewCompany />
          : s === "company" && route.cid ? <CompanySettings key={route.cid} cid={route.cid} tab={route.tab ?? "addresses"} />
          : s === "sending" && route.cid ? <SendingApp key={route.cid} id={route.cid} tab={route.tab ?? "overview"} />
          : s === "sending" ? <SendingApps />
          : s === "ai" ? <Providers />
          : s === "activity" ? <ActivityLog />
          : s === "account" ? <Account />
          : <Companies />}
      </div>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

const STATUS: Record<string, { tone: "ok" | "warn" | "error" | "neutral" | "accent" | "info"; label: string }> = {
  sent: { tone: "ok", label: "Sent" },
  drafted: { tone: "accent", label: "Draft to check" },
  needs_person: { tone: "warn", label: "Needs you" },
  skipped: { tone: "neutral", label: "Left alone" },
  error: { tone: "error", label: "Failed" },
  working: { tone: "info", label: "Working" },
  scheduled: { tone: "accent", label: "Sending soon" },
  sending: { tone: "info", label: "Sending" },
  cancelled: { tone: "neutral", label: "Stopped" },
};

function ActivityLog() {
  const { me } = useApp();
  const [runs, setRuns] = useState<AiRun[] | null>(null);
  const [company, setCompany] = useState("");
  useEffect(() => {
    setRuns(null);
    get<AiRun[]>(`/api/ai/runs?limit=300${company ? `&company=${encodeURIComponent(company)}` : ""}`).then(setRuns).catch(() => setRuns([]));
  }, [company]);
  const name = (cid: string) => me?.companies.find((c) => c.id === cid);
  return (
    <>
      <PageHead title="AI activity" sub="Every message the AI looked at: what it did, and why."
        actions={(
          <select className="input select" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company">
            <option value="">All companies</option>
            {me?.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )} />
      {!runs ? <div className="center-pad"><Spinner /></div> : !runs.length ? (
        <Card><Empty icon={<Sparkle size={22} />} title="Nothing yet">When an address has AI replies on, each message it answers or leaves alone shows up here.</Empty></Card>
      ) : (
        <div className="runs">
          {runs.map((r) => {
            const c = name(r.company_id);
            const st = STATUS[r.status] ?? { tone: "neutral" as const, label: r.status };
            const target: Route | null = c && r.thread_id ? { page: "mail", cid: c.id, box: r.status === "drafted" || r.status === "needs_person" ? "drafts" : "inbox", thread: r.thread_id } : null;
            return (
              <a key={r.id} className={cls("run", !target && "is-static")} href={target ? href(target) : undefined} onClick={target ? onNav(target) : (e) => e.preventDefault()}>
                <span className="run-co" style={{ background: c?.color ?? "var(--ink-3)" }} title={c?.name} />
                <span className="run-main">
                  <span className="run-line"><b>{r.sender || "Unknown sender"}</b><span className="run-subject">{r.subject || "(no subject)"}</span></span>
                  <span className="run-why">{r.reason || (r.status === "working" ? "Reading and writing…" : "")}</span>
                </span>
                <span className="run-to">{r.address}</span>
                <Pill tone={st.tone} dot>{st.label}</Pill>
                <span className="run-time">{relative(r.created_at)}</span>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

function Account() {
  const { me, toast, refreshMe } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next.length < 10) return setError("Use at least 10 characters.");
    if (next !== again) return setError("The two new passwords are different.");
    setBusy(true);
    try {
      await post("/api/me/password", { current, next });
      toast({ text: "Password changed. Sign in with the new one.", tone: "ok" });
      await refreshMe();
      go("/login", true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead title="Account" sub={<>Signed in as <b>{me?.owner.email}</b>.</>} />
      <Card title="Password" subtitle="Changing it signs you out everywhere.">
        <form className="form" onSubmit={save}>
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
          <div className="form-row">
            <Field label="New password"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
            <Field label="New password again" error={error || undefined}><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
          </div>
          <div className="form-foot"><Button variant="primary" type="submit" busy={busy}>Change password</Button></div>
        </form>
      </Card>
    </>
  );
}
