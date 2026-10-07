// The company's folders: Inbox, one per address, the system folders, the rest.
import { buildFolders, type Folder } from "../folders";
import { href, onNav, type Route } from "../router";
import { useApp } from "../store";
import { cls } from "../util";
import { Archive, At, Ban, FileText, Folder as FolderIcon, Inbox, Pencil, Send, Settings, Sparkle, Trash } from "../icons";
import type { Company, Mailbox } from "../types";

const ICONS: Record<string, (p: { size?: number }) => React.ReactElement> = {
  inbox: Inbox, drafts: FileText, sent: Send, archive: Archive, junk: Ban, trash: Trash,
};

export function Sidebar({ company, boxes, route, onCompose, onNavigate }: {
  company: Company; boxes: Mailbox[]; route: Route; onCompose: () => void; onNavigate?: () => void;
}) {
  const { unread } = useApp();
  const f = buildFolders(boxes, company);
  const current = route.page === "mail" ? route.box : "";
  const aiDrafts = unread[company.id]?.aiDrafts ?? 0;

  const item = (x: Folder, icon: React.ReactNode, extra?: React.ReactNode) => {
    const r: Route = { page: "mail", cid: company.id, box: x.key };
    const count = x.key === "drafts" ? x.total : x.unread;
    return (
      <a key={x.key} href={href(r)} onClick={(e) => { onNav(r)(e); onNavigate?.(); }} className={cls("nav-item", current === x.key && "is-active", x.unread > 0 && x.key !== "drafts" && "has-unread")}
        title={x.email}>
        {icon}
        <span className="nav-label">{x.name}</span>
        {extra}
        {count > 0 && x.key !== "sent" && x.key !== "trash" && x.key !== "archive" && <span className="nav-count">{count}</span>}
      </a>
    );
  };

  return (
    <aside className="sidebar" style={{ "--co": company.color } as React.CSSProperties}>
      <header className="sidebar-head">
        <div className="sidebar-co">
          <span className="sidebar-dot" />
          <div>
            <div className="sidebar-name">{company.name}</div>
            <div className="sidebar-domain">{company.email}</div>
          </div>
        </div>
        <button className="compose-btn" onClick={onCompose}>
          <Pencil size={16} /><span>Compose</span><kbd className="kbd">C</kbd>
        </button>
      </header>
      <nav className="sidebar-nav" aria-label="Folders">
        {f.inbox && item(f.inbox, <Inbox size={17} />)}
        {f.addresses.length > 0 && <div className="nav-section">Addresses</div>}
        {f.addresses.map((x) => item(x, <At size={17} />))}
        <div className="nav-section">Mail</div>
        {f.system.map((x) => item(x, (ICONS[x.key] ?? FolderIcon)({ size: 17 }),
          x.key === "drafts" && aiDrafts > 0 ? <span className="nav-ai" title={`${aiDrafts} AI ${aiDrafts === 1 ? "reply" : "replies"} to review`}><Sparkle size={13} />{aiDrafts}</span> : undefined))}
        {f.other.length > 0 && <div className="nav-section">Folders</div>}
        {f.other.map((x) => item(x, <FolderIcon size={17} />))}
      </nav>
      <footer className="sidebar-foot">
        <a href={href({ page: "settings", section: "company", cid: company.id, tab: "addresses" })} onClick={onNav({ page: "settings", section: "company", cid: company.id, tab: "addresses" })} className="nav-item">
          <Settings size={17} /><span className="nav-label">{company.name} settings</span>
        </a>
      </footer>
    </aside>
  );
}
