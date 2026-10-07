// The frame around everything once signed in: the company rail, the folders,
// the page, the floating composer, and the shortcuts that work everywhere.
import { useEffect, useRef, useState } from "react";
import { go, type Route } from "../router";
import { useApp } from "../store";
import { useMailData } from "../mailData";
import { cls } from "../util";
import { Menu as MenuIcon, Pencil } from "../icons";
import { Rail } from "./Rail";
import { Sidebar } from "./Sidebar";
import { isTyping, MailView, NoCompany } from "./MailView";
import { threadOf } from "./Reader";
import { Composer } from "./Composer";
import { Palette } from "./Palette";
import { Help } from "./Help";
import { Settings } from "./settings/Settings";

export function Shell({ route }: { route: Route }) {
  const app = useApp();
  const { me, compose, setCompose, setPalette, setHelp, palette, help, viewAddress } = app;
  const [drawer, setDrawer] = useState(false);
  const pendingG = useRef(0);
  const cid = route.page === "mail" || route.page === "search" ? route.cid : undefined;
  const company = app.company(cid);

  // Global shortcuts. Mail-specific ones live in MailView.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(!palette); return; }
      if (mod && /^[1-9]$/.test(e.key)) {
        const c = me?.companies[Number(e.key) - 1];
        if (c) { e.preventDefault(); go({ page: "mail", cid: c.id, box: "inbox" }); }
        return;
      }
      if (isTyping(e) || mod || e.altKey || palette || help || document.querySelector(".modal-scrim")) return;
      const target = company ?? me?.companies[0];
      if (Date.now() - pendingG.current < 1200 && target) {
        pendingG.current = 0;
        const box = { i: "inbox", d: "drafts", s: "sent", a: "archive", t: "trash", j: "junk" }[e.key];
        if (box) { e.preventDefault(); go({ page: "mail", cid: target.id, box }); }
        else if (e.key === "o") { e.preventDefault(); go("/settings"); }
        return;
      }
      if (e.key === "g") { pendingG.current = Date.now(); return; }
      if (e.key === "c" && target) { e.preventDefault(); setCompose({ kind: "new", cid: target.id, from: target.id === company?.id ? viewAddress : undefined }); }
      else if (e.key === "/") { const s = document.getElementById("mail-search"); if (s) { e.preventDefault(); s.focus(); } }
      else if (e.key === "?") { e.preventDefault(); setHelp(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me, company, palette, help, setPalette, setHelp, setCompose, viewAddress]);

  useEffect(() => setDrawer(false), [route]);

  // A composer floats unless the conversation it belongs to is open (then it sits inline there).
  const openThread = route.page === "mail" || route.page === "search" ? route.thread : undefined;
  const floating = compose && (compose.kind === "new" || threadOf(compose) !== openThread || compose.cid !== cid) ? compose : null;
  const floatingCompany = app.company(floating?.cid);

  return (
    <div className={cls("shell", drawer && "drawer-open", route.page === "settings" && "is-settings")}>
      <Rail route={route} />
      {(route.page === "mail" || route.page === "search") && company ? (
        <>
          <MailSidebar route={route} companyId={company.id} onClose={() => setDrawer(false)} />
          <div className="drawer-scrim" onClick={() => setDrawer(false)} />
          <main className="main">
            <div className="mobile-bar">
              <button className="icon-btn" aria-label="Folders" onClick={() => setDrawer(true)}><MenuIcon size={18} /></button>
              <span className="mobile-co"><span className="sidebar-dot" style={{ background: company.color }} />{company.name}</span>
            </div>
            <MailView key={company.id} route={route} company={company} />
            <button className="fab" aria-label="Write" onClick={() => setCompose({ kind: "new", cid: company.id, from: viewAddress })}><Pencil size={20} /></button>
          </main>
        </>
      ) : route.page === "settings" ? (
        <main className="main main-settings"><Settings route={route} /></main>
      ) : (
        <main className="main"><NoCompany /></main>
      )}
      {floating && floatingCompany && <FloatingComposer key={`${floating.kind}-${floating.kind === "new" ? floating.to ?? "" : floating.email.id}`} />}
      {palette && <Palette route={route} />}
      {help && <Help />}
    </div>
  );
}

function MailSidebar({ route, companyId, onClose }: { route: Route; companyId: string; onClose: () => void }) {
  const app = useApp();
  const company = app.company(companyId)!;
  const data = useMailData(app.jmap(companyId));
  return <Sidebar company={company} boxes={data.boxes} route={route} onCompose={() => app.setCompose({ kind: "new", cid: companyId, from: app.viewAddress })} onNavigate={onClose} />;
}

function FloatingComposer() {
  const app = useApp();
  const intent = app.compose!;
  const company = app.company(intent.cid)!;
  const j = app.jmap(company.id);
  const data = useMailData(j);
  if (!data.loaded) return null;
  return (
    <div className="composer-dock">
      <Composer intent={intent} company={company} jmap={j} boxes={data.boxes} identities={data.identities} onClose={() => app.setCompose(null)} />
    </div>
  );
}
