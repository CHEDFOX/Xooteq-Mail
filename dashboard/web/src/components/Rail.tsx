// The far-left rail: one tile per company (its colour, its initials, its unread
// count), then the way to add one, and the app's own controls at the foot.
import { go, href, onNav, type Route } from "../router";
import { useApp } from "../store";
import { cls, initials, modKey } from "../util";
import { Command, LogOut, Moon, Monitor, Plus, Settings, Sun } from "../icons";
import { Menu } from "../ui";
import { Mark } from "./Brand";
import { post } from "../api";

export function Rail({ route }: { route: Route }) {
  const { me, unread, theme, setTheme, setPalette, refreshMe } = useApp();
  const activeCid = route.page === "mail" || route.page === "search" ? route.cid : route.page === "settings" ? route.cid : undefined;
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <nav className="rail" aria-label="Companies">
      <a className="rail-mark" href="/" onClick={onNav("/")} aria-label="Xooteq Mail"><Mark size={30} /></a>
      <div className="rail-companies">
        {me?.companies.map((c, i) => {
          const n = unread[c.id]?.inbox ?? 0;
          const ai = unread[c.id]?.aiDrafts ?? 0;
          const r: Route = { page: "mail", cid: c.id, box: "inbox" };
          return (
            <a key={c.id} href={href(r)} onClick={onNav(r)} className={cls("rail-tile", c.id === activeCid && "is-active")}
              style={{ "--tile": c.color } as React.CSSProperties} data-tip={`${c.name}  ${i < 9 ? `${modKey}${i + 1}` : ""}`} aria-label={`${c.name}${n ? `, ${n} unread` : ""}`}>
              <span className="rail-tile-face">{initials(c.name)}</span>
              {n > 0 && <span className="rail-badge">{n > 99 ? "99+" : n}</span>}
              {ai > 0 && n === 0 && <span className="rail-ai" />}
            </a>
          );
        })}
        <a className="rail-add" href="/settings/new" onClick={onNav("/settings/new")} data-tip="Add a company" aria-label="Add a company"><Plus size={18} /></a>
      </div>
      <div className="rail-foot">
        <button className="rail-btn" onClick={() => setPalette(true)} data-tip={`Command menu  ${modKey}K`} aria-label="Command menu"><Command size={18} /></button>
        <Menu align="start" trigger={(open) => (
          <button className="rail-btn" onClick={open} data-tip="Appearance" aria-label="Appearance"><ThemeIcon size={18} /></button>
        )} items={[
          { label: "System", icon: <Monitor size={16} />, onSelect: () => setTheme("system"), hint: theme === "system" ? "✓" : undefined },
          { label: "Light", icon: <Sun size={16} />, onSelect: () => setTheme("light"), hint: theme === "light" ? "✓" : undefined },
          { label: "Dark", icon: <Moon size={16} />, onSelect: () => setTheme("dark"), hint: theme === "dark" ? "✓" : undefined },
        ]} />
        <a className={cls("rail-btn", route.page === "settings" && !route.cid && "is-active")} href="/settings" onClick={onNav("/settings")} data-tip="Settings" aria-label="Settings"><Settings size={18} /></a>
        <Menu align="start" trigger={(open) => (
          <button className="rail-me" onClick={open} aria-label="Account" data-tip={me?.owner.email}>{initials(me?.owner.name || me?.owner.email || "?")}</button>
        )} items={[
          { label: me?.owner.email ?? "", onSelect: () => go("/settings/account") },
          "sep",
          { label: "Sign out", icon: <LogOut size={16} />, onSelect: async () => { await post("/api/auth/logout"); await refreshMe(); go("/login", true); } },
        ]} />
      </div>
    </nav>
  );
}
