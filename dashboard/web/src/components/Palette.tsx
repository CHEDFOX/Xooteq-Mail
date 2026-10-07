// ⌘K: jump to any company or folder, write, search, or open any setting by typing.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildFolders } from "../folders";
import { useMailData } from "../mailData";
import { go, type Route } from "../router";
import { useApp } from "../store";
import { cls } from "../util";
import { Activity, At, Building, Globe, Inbox, Key, Moon, Pencil, Plus, Rules, Search, Settings, Sparkle, Sun, User } from "../icons";

type Cmd = { id: string; label: string; hint?: string; group: string; icon: ReactNode; run: () => void; keywords?: string };

/** Subsequence match, scored: earlier, tighter and word-start matches win. */
function score(text: string, q: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 - (t.length - q.length) * 0.1 + (direct === 0 || t[direct - 1] === " " ? 200 : 0);
  let ti = 0, s = 0, last = -1;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    s += at === last + 1 ? 8 : at === 0 || t[at - 1] === " " ? 6 : 1;
    last = at;
    ti = at + 1;
  }
  return s;
}

export function Palette({ route }: { route: Route }) {
  const { me, setPalette, setCompose, setTheme, setHelp, jmap, company: getCompany, viewAddress } = useApp();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const cid = route.page === "mail" || route.page === "search" || route.page === "settings" ? route.cid : undefined;
  const current = getCompany(cid) ?? me?.companies[0];
  const data = useMailData(current ? jmap(current.id) : undefined);
  const close = () => setPalette(false);

  const commands = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    const run = (fn: () => void) => () => { close(); fn(); };
    if (current) {
      out.push({ id: "compose", label: `Write from ${current.name}`, hint: "C", group: "Actions", icon: <Pencil size={16} />, run: run(() => setCompose({ kind: "new", cid: current.id, from: current.id === cid ? viewAddress : undefined })), keywords: "compose new email message" });
      const f = buildFolders(data.boxes, current);
      for (const x of [f.inbox, ...f.addresses, ...f.system, ...f.other]) {
        if (!x) continue;
        out.push({ id: `f-${x.key}`, label: `${x.name}`, hint: x.unread ? `${x.unread} unread` : undefined, group: current.name, icon: x.kind === "address" ? <At size={16} /> : <Inbox size={16} />,
          run: run(() => go({ page: "mail", cid: current.id, box: x.key })), keywords: `go folder ${x.email ?? ""}` });
      }
    }
    me?.companies.forEach((c, i) => {
      out.push({ id: `c-${c.id}`, label: c.name, hint: i < 9 ? `⌘${i + 1}` : undefined, group: "Companies", icon: <span className="pal-dot" style={{ background: c.color }} />,
        run: run(() => go({ page: "mail", cid: c.id, box: "inbox" })), keywords: `${c.domain} ${c.email} switch` });
      out.push({ id: `cs-${c.id}`, label: `${c.name} settings`, group: "Settings", icon: <Building size={16} />, run: run(() => go({ page: "settings", section: "company", cid: c.id, tab: "addresses" })), keywords: `${c.domain} addresses auto reply` });
      out.push({ id: `cr-${c.id}`, label: `${c.name}: rules`, group: "Settings", icon: <Rules size={16} />, run: run(() => go({ page: "settings", section: "company", cid: c.id, tab: "rules" })), keywords: "filters automations" });
      out.push({ id: `ca-${c.id}`, label: `${c.name}: AI replies`, group: "Settings", icon: <Sparkle size={16} />, run: run(() => go({ page: "settings", section: "company", cid: c.id, tab: "ai" })), keywords: "voice profile automation" });
      out.push({ id: `cd-${c.id}`, label: `${c.name}: domain and DNS`, group: "Settings", icon: <Globe size={16} />, run: run(() => go({ page: "settings", section: "company", cid: c.id, tab: "dns" })), keywords: "mx spf dkim dmarc records" });
    });
    out.push(
      { id: "new", label: "Add a company", group: "Settings", icon: <Plus size={16} />, run: run(() => go("/settings/new")), keywords: "domain new mailbox" },
      { id: "ai", label: "AI providers and keys", group: "Settings", icon: <Key size={16} />, run: run(() => go("/settings/ai")), keywords: "openai anthropic claude gemini key model" },
      { id: "activity", label: "AI activity", group: "Settings", icon: <Activity size={16} />, run: run(() => go("/settings/activity")), keywords: "log runs history" },
      { id: "account", label: "Your account", group: "Settings", icon: <User size={16} />, run: run(() => go("/settings/account")), keywords: "password sign out" },
      { id: "all", label: "All settings", group: "Settings", icon: <Settings size={16} />, run: run(() => go("/settings")) },
      { id: "light", label: "Light appearance", group: "Appearance", icon: <Sun size={16} />, run: run(() => setTheme("light")), keywords: "theme" },
      { id: "dark", label: "Dark appearance", group: "Appearance", icon: <Moon size={16} />, run: run(() => setTheme("dark")), keywords: "theme" },
      { id: "system", label: "Match the system appearance", group: "Appearance", icon: <Sun size={16} />, run: run(() => setTheme("system")), keywords: "theme auto" },
      { id: "help", label: "Keyboard shortcuts", hint: "?", group: "Help", icon: <Key size={16} />, run: run(() => setHelp(true)), keywords: "keys help" },
    );
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, current, data.boxes]);

  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    const words = (c: Cmd) => `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase();
    const scored = commands.map((c) => {
      const label = score(c.label, query);
      const exact = words(c).includes(query) ? 400 : -1;
      return { c, s: Math.max(label >= query.length * 4 || label >= 600 ? label : -1, exact) };
    }).filter((x) => x.s >= 0);
    if (query) scored.sort((a, b) => b.s - a.s);
    const list = scored.map((x) => x.c);
    if (query && current) {
      list.push({ id: "search", label: `Search ${current.name} for “${q.trim()}”`, group: "Search", icon: <Search size={16} />, run: () => { close(); go({ page: "search", cid: current.id, q: q.trim() }); } });
    }
    return list.slice(0, 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, query, current]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  let lastGroup = "";
  return (
    <div className="palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-label="Command menu">
        <div className="palette-input">
          <Search size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to, write, search, change…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); results[active]?.run(); }
              else if (e.key === "Escape") { e.preventDefault(); close(); }
            }} aria-controls="palette-list" aria-activedescendant={results[active] ? `pal-${results[active].id}` : undefined} />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">Nothing matches.</div>}
          {results.map((c, i) => {
            const showGroup = !query && c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {showGroup && <div className="palette-group">{c.group}</div>}
                <button id={`pal-${c.id}`} data-i={i} role="option" aria-selected={i === active} className={cls("palette-item", i === active && "is-active")}
                  onMouseMove={() => setActive(i)} onClick={c.run}>
                  <span className="palette-icon">{c.icon}</span>
                  <span className="palette-label">{c.label}</span>
                  {query && <span className="palette-where">{c.group}</span>}
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
