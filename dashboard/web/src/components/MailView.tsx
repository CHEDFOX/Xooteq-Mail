// A folder (or a search) of one company: the list on the left, the open
// conversation on the right, kept live by the server's push stream, and
// driven from the keyboard the way the big mail apps are.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadRow } from "../jmap";
import { folderFor, buildFolders } from "../folders";
import { refreshMailData, useMailData } from "../mailData";
import { go, type Route } from "../router";
import { useApp } from "../store";
import { destroyThreads, markRead, moveThreads, star, type MoveTo } from "../threadActions";
import type { Company } from "../types";
import { cls, modKey } from "../util";
import { Archive, Ban, Check, Folder, Mail, Refresh, Search, Trash, Undo, X } from "../icons";
import { Empty, IconButton, Kbd, Menu } from "../ui";
import { MessageList } from "./MessageList";
import { Reader, type ReaderAction } from "./Reader";
import { Mark } from "./Brand";

type MailRoute = Extract<Route, { page: "mail" } | { page: "search" }>;
const PAGE = 50;

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function MailView({ route, company }: { route: MailRoute; company: Company }) {
  const { jmap, setCompose, compose, toast, refreshUnread, palette, help } = useApp();
  const j = jmap(company.id);
  const data = useMailData(j);
  const box = route.page === "mail" ? route.box : undefined;
  const q = route.page === "search" ? route.q : "";
  const folder = box ? folderFor(box, data.boxes, company) : undefined;
  const folders = useMemo(() => buildFolders(data.boxes, company), [data.boxes, company]);

  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focused, setFocused] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const [searchText, setSearchText] = useState(q);
  const lastCheck = useRef<number | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const key = `${company.id}|${box ?? ""}|${q}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  const filter = useCallback((): Record<string, unknown> | null => {
    if (route.page === "search") {
      const skip = data.boxes.filter((b) => b.role === "trash" || b.role === "junk").map((b) => b.id);
      return skip.length ? { operator: "AND", conditions: [{ text: q }, { inMailboxOtherThan: skip }] } : { text: q };
    }
    return folder ? { inMailbox: folder.id } : null;
  }, [route.page, q, folder, data.boxes]);

  const load = useCallback(async (mode: "reset" | "refresh" | "more") => {
    const f = filter();
    if (!f) return;
    const k = keyRef.current;
    if (mode === "more") setLoadingMore(true);
    if (mode === "reset") setLoading(true);
    try {
      const position = mode === "more" ? rowsRef.current.length : 0;
      const limit = mode === "refresh" ? Math.max(PAGE, rowsRef.current.length) : PAGE;
      const res = await j.threads(f, position, limit);
      if (keyRef.current !== k) return;
      setRows((cur) => (mode === "more" ? [...cur, ...res.rows.filter((r) => !cur.some((c) => c.id === r.id))] : res.rows));
      setTotal(res.total);
    } catch (e) {
      if (keyRef.current === k) toast({ text: (e as Error).message, tone: "error" });
    } finally {
      if (keyRef.current === k) { setLoading(false); setLoadingMore(false); }
    }
  }, [filter, j, toast]);

  // A new folder or search starts from the top.
  useEffect(() => {
    setRows([]);
    setFocused(0);
    setChecked(new Set());
    setSearchText(q);
    if (data.loaded) load("reset");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, data.loaded]);

  const refreshAll = useCallback(() => {
    load("refresh");
    refreshMailData(j);
    refreshUnread();
    setTick((t) => t + 1);
  }, [load, j, refreshUnread]);
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;

  // Live: Stalwart says when anything in the mailbox changed; refresh shortly after.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => refreshRef.current(), 500); };
    const es = new EventSource(`/api/c/${encodeURIComponent(company.id)}/events`);
    es.addEventListener("state", soon);
    es.onmessage = soon;
    const onFocus = () => soon();
    window.addEventListener("focus", onFocus);
    const poll = setInterval(() => { if (es.readyState === EventSource.CLOSED) soon(); }, 60_000);
    return () => { es.close(); clearTimeout(timer); clearInterval(poll); window.removeEventListener("focus", onFocus); };
  }, [company.id]);

  const open = (threadId?: string) => {
    if (route.page === "mail") go({ page: "mail", cid: company.id, box: route.box, thread: threadId });
    else go({ page: "search", cid: company.id, q, thread: threadId });
  };

  const targets = (): string[] => (checked.size ? [...checked] : route.thread ? [route.thread] : rows[focused] ? [rows[focused].threadId] : []);

  async function act(a: ReaderAction, ids = targets()) {
    if (!ids.length) return;
    const fromBox = folder?.id;
    const n = ids.length;
    const what = n === 1 ? "Conversation" : `${n} conversations`;
    // Leaving the open conversation: go to the next one down, like Gmail.
    const advance = () => {
      if (!route.thread || !ids.includes(route.thread)) return;
      const i = rows.findIndex((r) => r.threadId === route.thread);
      const next = rows.slice(i + 1).find((r) => !ids.includes(r.threadId)) ?? rows.slice(0, i).reverse().find((r) => !ids.includes(r.threadId));
      open(window.innerWidth >= 1024 ? next?.threadId : undefined);
    };
    try {
      if (a === "unread" || a === "star" || a === "unstar") {
        if (a === "unread") { await markRead(j, ids, false); if (route.thread && ids.includes(route.thread)) open(undefined); }
        else await star(j, ids, a === "star");
        setRows((rs) => rs.map((r) => ids.includes(r.threadId)
          ? { ...r, unread: a === "unread" ? true : r.unread, keywords: { ...r.keywords, ...(a !== "unread" ? { $flagged: a === "star" } : {}) } } : r));
      } else if (a === "destroy") {
        if (!confirm(`Delete ${n === 1 ? "this conversation" : `these ${n} conversations`} for good? This cannot be undone.`)) return;
        advance();
        setRows((rs) => rs.filter((r) => !ids.includes(r.threadId)));
        await destroyThreads(j, ids);
        toast({ text: `${what} deleted for good.` });
      } else {
        const to: MoveTo = a;
        advance();
        setRows((rs) => rs.filter((r) => !ids.includes(r.threadId)));
        setTotal((t) => Math.max(0, t - n));
        const { undo } = await moveThreads(j, data.boxes, company, ids, to, fromBox);
        const done = typeof to === "object" ? `Moved to ${to.name}` : to === "archive" ? "Archived" : to === "trash" ? "Moved to Trash" : to === "junk" ? "Marked as spam" : "Moved to Inbox";
        toast({ text: `${done}.`, action: { label: "Undo", run: async () => { await undo(); refreshAll(); toast({ text: "Undone." }); } } });
      }
      setChecked(new Set());
      refreshMailData(j);
      refreshUnread();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
      load("refresh");
    }
  }
  const actRef = useRef(act);
  actRef.current = act;

  function onCheck(row: ThreadRow, index: number, range: boolean) {
    setChecked((cur) => {
      const next = new Set(cur);
      if (range && lastCheck.current !== null) {
        const [a, b] = [Math.min(lastCheck.current, index), Math.max(lastCheck.current, index)];
        for (let i = a; i <= b; i++) next.add(rows[i].threadId);
      } else if (next.has(row.threadId)) next.delete(row.threadId);
      else next.add(row.threadId);
      return next;
    });
    lastCheck.current = index;
    setFocused(index);
  }

  // The keyboard: j/k to move, Enter to open, e/#/!/s/u/r/a/f to act.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || palette || help || document.querySelector(".modal-scrim")) return;
      const rs = rowsRef.current;
      const inThread = !!route.thread;
      const k = e.key;
      const move = (d: number) => {
        e.preventDefault();
        if (inThread) {
          const i = rs.findIndex((r) => r.threadId === route.thread);
          const n = rs[i + d];
          if (n) { setFocused(i + d); open(n.threadId); if (i + d >= rs.length - 5 && rs.length < total) load("more"); }
        } else {
          setFocused((f) => { const n = Math.max(0, Math.min(rs.length - 1, f + d)); if (n >= rs.length - 5 && rs.length < total) load("more"); return n; });
        }
      };
      if (k === "j" || k === "ArrowDown") move(1);
      else if (k === "k" || k === "ArrowUp") move(-1);
      else if ((k === "Enter" || k === "o") && !inThread && rs[focused]) { e.preventDefault(); open(rs[focused].threadId); }
      else if (k === "Escape" || k === "u" && inThread) {
        if (inThread) { e.preventDefault(); open(undefined); }
        else if (checked.size) { e.preventDefault(); setChecked(new Set()); }
      }
      else if (k === "x" && rs[focused]) { e.preventDefault(); onCheck(rs[focused], focused, false); }
      else if (k === "e") { e.preventDefault(); actRef.current(box === "archive" ? "inbox" : "archive"); }
      else if (k === "#" || k === "Delete") { e.preventDefault(); actRef.current(box === "trash" ? "destroy" : "trash"); }
      else if (k === "!") { e.preventDefault(); actRef.current(box === "junk" ? "inbox" : "junk"); }
      else if (k === "s") {
        e.preventDefault();
        const t = targets();
        const r = rs.find((x) => x.threadId === t[0]);
        actRef.current(r?.keywords?.$flagged ? "unstar" : "star", t);
      }
      else if (k === "U") { e.preventDefault(); actRef.current("unread"); }
      else if (k === "I") { e.preventDefault(); markRead(j, targets(), true).then(refreshAll); }
      else if ((k === "r" || k === "a" || k === "f") && inThread) {
        e.preventDefault();
        j.thread(route.thread!).then((list) => {
          const real = list.filter((m) => !m.keywords.$draft);
          const last = real[real.length - 1];
          if (last) setCompose({ kind: k === "r" ? "reply" : k === "a" ? "replyAll" : "forward", cid: company.id, email: last });
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const labelFor = useCallback((r: ThreadRow) => {
    if (folder?.kind === "address") return undefined;
    return folders.addresses.find((f) => r.mailboxIds?.[f.id])?.name;
  }, [folder, folders]);

  const title = route.page === "search" ? `Results for “${q}”` : folder?.name ?? "Mail";
  const empty = route.page === "search"
    ? { title: `Nothing matches “${q}”`, text: "Try fewer words, a name, or an address.", search: true }
    : emptyFor(box ?? "", folder?.email, company);
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.threadId));
  const unreadHere = folder?.unread ?? 0;

  const header = (
    <header className="list-head">
      <form className="search" role="search" onSubmit={(e) => {
        e.preventDefault();
        const t = searchText.trim();
        if (t) go({ page: "search", cid: company.id, q: t });
      }}>
        <Search size={16} />
        <input id="mail-search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={`Search ${company.name}`} aria-label="Search mail"
          onKeyDown={(e) => { if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); if (route.page === "search") go({ page: "mail", cid: company.id, box: "inbox" }); } }} />
        {route.page === "search" ? (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => go({ page: "mail", cid: company.id, box: "inbox" })}><X size={14} /></button>
        ) : <Kbd>/</Kbd>}
      </form>
      {checked.size > 0 ? (
        <div className="list-title is-bulk">
          <button className={cls("bulk-all", allChecked && "is-on")} onClick={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.threadId)))} aria-label={allChecked ? "Untick all" : "Tick all"}><Check size={14} /></button>
          <span className="bulk-count">{checked.size} selected</span>
          <span className="bar-fill" />
          {box === "trash" || box === "junk" ? (
            <IconButton label={box === "junk" ? "Not spam" : "Restore"} onClick={() => act("inbox")}><Undo size={17} /></IconButton>
          ) : (
            <IconButton label={box === "archive" ? "Move to Inbox" : "Archive"} shortcut="E" onClick={() => act(box === "archive" ? "inbox" : "archive")}><Archive size={17} /></IconButton>
          )}
          <IconButton label={box === "trash" ? "Delete forever" : "Delete"} shortcut="#" onClick={() => act(box === "trash" ? "destroy" : "trash")}><Trash size={17} /></IconButton>
          {box !== "junk" && <IconButton label="Spam" shortcut="!" onClick={() => act("junk")}><Ban size={17} /></IconButton>}
          <IconButton label="Mark read" shortcut="⇧I" onClick={() => markRead(j, [...checked], true).then(() => { setChecked(new Set()); refreshAll(); })}><Mail size={17} /></IconButton>
          {folders.addresses.length + folders.other.length > 0 && (
            <Menu trigger={(o) => <IconButton label="Move to" onClick={o}><Folder size={17} /></IconButton>}
              items={[...folders.addresses, ...folders.other].filter((f) => f.key !== box).map((f) => ({ label: f.name, icon: <Folder size={16} />, onSelect: () => act({ folderId: f.id, name: f.name }) }))} />
          )}
          <IconButton label="Clear" shortcut="Esc" onClick={() => setChecked(new Set())}><X size={17} /></IconButton>
        </div>
      ) : (
        <div className="list-title">
          <h2>{title}</h2>
          {route.page === "mail" && unreadHere > 0 && <span className="list-sub">{unreadHere} unread</span>}
          {route.page === "search" && !loading && <span className="list-sub">{total} found</span>}
          <span className="bar-fill" />
          {route.page === "mail" && unreadHere > 0 && (
            <button className="link-btn" onClick={async () => {
              const all = await j.threads({ operator: "AND", conditions: [{ inMailbox: folder!.id }, { notKeyword: "$seen" }] }, 0, 500);
              await markRead(j, all.rows.map((r) => r.threadId), true);
              refreshAll();
              toast({ text: `Marked ${all.rows.length} as read.` });
            }}>Mark all read</button>
          )}
          <IconButton label="Refresh" onClick={refreshAll}><Refresh size={16} /></IconButton>
        </div>
      )}
    </header>
  );

  const thread = route.thread;
  return (
    <div className={cls("mail", thread && "has-thread")}>
      <MessageList rows={rows} total={total} loading={loading || !data.loaded} loadingMore={loadingMore} selected={thread} focused={thread ? -1 : focused}
        checked={checked} company={company} folderName={title} labelFor={labelFor} empty={empty} header={header}
        onOpen={(r, i) => { setFocused(i); open(r.threadId); }} onCheck={onCheck} onMore={() => load("more")} />
      {thread ? (
        <Reader key={thread} company={company} jmap={j} threadId={thread} boxes={data.boxes} identities={data.identities} boxKey={box ?? ""} tick={tick}
          onAction={(a) => act(a, [thread])} onBack={() => open(undefined)} onChanged={() => { load("refresh"); refreshMailData(j); }} />
      ) : (
        <section className="reader reader-idle" aria-hidden={rows.length === 0}>
          <div className="idle">
            <Mark size={44} />
            <p className="idle-title">{rows.length ? "Pick a conversation" : compose ? "" : "All caught up"}</p>
            <ul className="idle-keys">
              <li><Kbd>J</Kbd><Kbd>K</Kbd><span>move</span></li>
              <li><Kbd>↵</Kbd><span>open</span></li>
              <li><Kbd>C</Kbd><span>write</span></li>
              <li><Kbd>{modKey}</Kbd><Kbd>K</Kbd><span>do anything</span></li>
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function emptyFor(box: string, email: string | undefined, c: Company): { title: string; text: string } {
  switch (box) {
    case "inbox": return { title: "Inbox zero", text: `Nothing waiting. Mail to ${c.email} and ${c.name}'s other addresses arrives here.` };
    case "drafts": return { title: "No drafts", text: "Mail you start and do not send waits here, and so do replies the AI wrote for you to check." };
    case "sent": return { title: "Nothing sent yet", text: `Mail you send from ${c.domain} is kept here.` };
    case "archive": return { title: "Archive is empty", text: "Archived conversations leave the Inbox and wait here. Press E on one to archive it." };
    case "junk": return { title: "No spam", text: "Mail the server judges to be junk is kept here, out of your way." };
    case "trash": return { title: "Trash is empty", text: "Deleted mail waits here until you delete it for good." };
    default: return email ? { title: "Nothing here yet", text: `Mail to ${email} is filed here, and also shows in the Inbox.` } : { title: "Nothing here", text: "This folder is empty." };
  }
}

export function NoCompany() {
  return <Empty icon={<Mail size={22} />} title="No such company">It may have been removed from the dashboard.</Empty>;
}
