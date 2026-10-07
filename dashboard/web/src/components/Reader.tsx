// One conversation: its messages oldest first (earlier ones folded), the AI's
// draft waiting for review if there is one, and the reply box at the foot.
import { useEffect, useMemo, useState } from "react";
import { get, post } from "../api";
import type { Jmap } from "../jmap";
import { useApp, type ComposeIntent } from "../store";
import { buildFolders } from "../folders";
import type { BodyPart, Company, Email, Identity, Mailbox } from "../types";
import { bytes, cls, displayName, longTime, shortTime } from "../util";
import {
  Archive, Ban, ChevronLeft, Download, FileText, Folder, Forward, Inbox, Mail, More, Paperclip, Reply, ReplyAll, Send, Sparkle, Star, Trash, Undo,
} from "../icons";
import { Avatar, Button, Empty, IconButton, Menu, Spinner } from "../ui";
import { MessageBody } from "./MessageBody";
import { Composer } from "./Composer";

export type ReaderAction = "archive" | "trash" | "junk" | "inbox" | "unread" | "star" | "unstar" | "destroy" | { folderId: string; name: string };

export const threadOf = (c: ComposeIntent | null): string | undefined => (c && c.kind !== "new" ? c.email.threadId : undefined);

export function Reader({ company, jmap, threadId, boxes, identities, boxKey, tick, onAction, onBack, onChanged }: {
  company: Company; jmap: Jmap; threadId: string; boxes: Mailbox[]; identities: Identity[];
  /** The folder the conversation was opened from. */
  boxKey: string;
  /** Changes when the mailbox changed, so the conversation reloads. */
  tick: number;
  onAction: (a: ReaderAction) => void;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { compose, setCompose, toast, refreshUnread } = useApp();
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState(false);
  const [sched, setSched] = useState<{ id: number; draftId: string; sendAt: number } | null>(null);
  const scheduledDraft = emails?.find((e) => e.keywords.$draft && e.keywords.$ai && e.keywords.$ai_scheduled)?.id;

  // An AI reply waiting to go out: when it goes, so it can be stopped.
  useEffect(() => {
    if (!scheduledDraft) { setSched(null); return; }
    let live = true;
    get<{ id: number; draftId: string; sendAt: number }[]>(`/api/c/${company.id}/ai/scheduled`)
      .then((list) => { if (live) setSched(list.find((x) => x.draftId === scheduledDraft) ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [scheduledDraft, company.id]);

  const roles = useMemo(() => Object.fromEntries(boxes.filter((b) => b.role).map((b) => [b.role!, b.id])), [boxes]);
  const folders = useMemo(() => buildFolders(boxes, company), [boxes, company]);

  useEffect(() => {
    let live = true;
    jmap.thread(threadId).then((list) => {
      if (!live) return;
      if (!list.length) { setMissing(true); setEmails([]); return; }
      setMissing(false);
      setEmails(list);
      setOpen((prev) => {
        if (prev.size && list.some((e) => prev.has(e.id))) return prev;
        // The newest message, and any unread ones, start open.
        const real = list.filter((e) => !e.keywords.$draft);
        const ids = new Set(real.filter((e) => !e.keywords.$seen).map((e) => e.id));
        if (real.length) ids.add(real[real.length - 1].id);
        return ids;
      });
      const unread = list.filter((e) => !e.keywords.$seen && !e.keywords.$draft).map((e) => e.id);
      if (unread.length) jmap.setKeyword(unread, "$seen", true).then(() => { refreshUnread(); onChanged(); }).catch(() => {});
    }).catch((e) => { if (live) { toast({ text: (e as Error).message, tone: "error" }); setEmails([]); } });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jmap, threadId, tick]);

  if (!emails) return <section className="reader"><div className="reader-loading"><Spinner size={22} /></div></section>;
  if (missing) {
    return (
      <section className="reader">
        <Empty icon={<Mail size={22} />} title="This conversation is gone">It was deleted or moved somewhere else.</Empty>
      </section>
    );
  }

  const messages = emails.filter((e) => !e.keywords.$draft);
  const drafts = emails.filter((e) => e.keywords.$draft);
  const last = messages[messages.length - 1] ?? emails[emails.length - 1];
  const subject = last?.subject || "(no subject)";
  const inTrash = boxKey === "trash";
  const inJunk = boxKey === "junk";
  const starred = emails.some((e) => e.keywords.$flagged);
  const editing = threadOf(compose) === threadId ? (compose as Exclude<ComposeIntent, { kind: "new" }>) : null;
  const aiDraft = drafts.find((d) => d.keywords.$ai);
  const answers = (d: Email) => messages.find((m) => m.keywords.$ai_draft && (m.messageId ?? []).some((id) => (d.inReplyTo ?? []).includes(id)))
    ?? messages.find((m) => (m.messageId ?? []).some((id) => (d.inReplyTo ?? []).includes(id)));

  // Which of the company's addresses it came to, as the reader's tag.
  const toAddress = (() => {
    const rcpt = [...(last?.to ?? []), ...(last?.cc ?? [])].map((a) => a.email.toLowerCase());
    return company.addresses.find((a) => rcpt.includes(a.email.toLowerCase()));
  })();
  const addressFolder = toAddress && !toAddress.isPrimary ? folders.addresses.find((f) => f.email === toAddress.email) : undefined;

  const reply = (kind: "reply" | "replyAll" | "forward", email = last, aiText?: string) => setCompose({ kind, cid: company.id, email, aiText });
  const editDraft = async (d: Email) => {
    if (sched && sched.draftId === d.id) await stopSending(false);
    setCompose({ kind: "draft", cid: company.id, email: d, replyTo: answers(d)?.id });
  };

  async function stopSending(say = true) {
    if (!sched) return;
    try {
      await post(`/api/c/${company.id}/ai/scheduled/${sched.id}/cancel`);
      setSched(null);
      if (say) toast({ text: "Stopped. The reply is in Drafts for you to check." });
      onChanged();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
      onChanged();
    }
  }

  async function sendNow() {
    if (!sched) return;
    try {
      await post(`/api/c/${company.id}/ai/scheduled/${sched.id}/send`);
      setSched(null);
      toast({ text: "Sent.", tone: "ok" });
      refreshUnread();
      onChanged();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  }

  async function aiReply() {
    setAiBusy(true);
    try {
      const r = await post<{ text: string; decision: string; reason: string }>(`/api/c/${company.id}/ai/suggest`, { emailId: last.id });
      reply("reply", last, r.text);
      if (r.decision === "escalate") toast({ text: `Worth a careful read: ${r.reason}`, ms: 8000 });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    } finally {
      setAiBusy(false);
    }
  }

  async function discardDraft(d: Email) {
    await jmap.destroy([d.id]).catch(() => {});
    const orig = answers(d);
    if (orig?.keywords.$ai_draft) await jmap.setKeyword([orig.id], "$ai_draft", false).catch(() => {});
    if (orig?.keywords.$ai_scheduled) await jmap.setKeyword([orig.id], "$ai_scheduled", false).catch(() => {});
    toast({ text: "Draft discarded." });
    refreshUnread();
    onChanged();
  }

  const moveItems = [
    ...(boxKey !== "inbox" ? [{ label: "Inbox", icon: <Inbox size={16} />, onSelect: () => onAction("inbox") }] : []),
    ...folders.addresses.filter((f) => f.key !== boxKey).map((f) => ({ label: f.name, icon: <Folder size={16} />, onSelect: () => onAction({ folderId: f.id, name: f.name }) })),
    ...folders.other.filter((f) => f.key !== boxKey).map((f) => ({ label: f.name, icon: <Folder size={16} />, onSelect: () => onAction({ folderId: f.id, name: f.name }) })),
  ];

  return (
    <section className="reader" style={{ "--co": company.color } as React.CSSProperties} aria-label={subject}>
      <header className="reader-bar">
        <IconButton label="Back" shortcut="Esc" className="reader-back" onClick={onBack}><ChevronLeft size={18} /></IconButton>
        {inTrash || inJunk ? (
          <>
            <Button size="sm" icon={<Undo size={15} />} onClick={() => onAction("inbox")}>{inJunk ? "Not spam" : "Restore"}</Button>
            <Button size="sm" variant="ghost" icon={<Trash size={15} />} onClick={() => onAction("destroy")}>Delete forever</Button>
          </>
        ) : (
          <>
            {boxKey !== "archive" && <IconButton label="Archive" shortcut="E" onClick={() => onAction("archive")}><Archive size={18} /></IconButton>}
            {boxKey === "archive" && <IconButton label="Move to Inbox" onClick={() => onAction("inbox")}><Inbox size={18} /></IconButton>}
            <IconButton label="Delete" shortcut="#" onClick={() => onAction("trash")}><Trash size={18} /></IconButton>
            <IconButton label="Spam" shortcut="!" onClick={() => onAction("junk")}><Ban size={18} /></IconButton>
          </>
        )}
        <span className="bar-sep" />
        <IconButton label="Mark unread" shortcut="U" onClick={() => onAction("unread")}><Mail size={18} /></IconButton>
        <IconButton label={starred ? "Unstar" : "Star"} shortcut="S" active={starred} onClick={() => onAction(starred ? "unstar" : "star")}><Star size={18} className={starred ? "is-starred" : ""} /></IconButton>
        {moveItems.length > 0 && (
          <Menu trigger={(o) => <IconButton label="Move to" shortcut="V" onClick={o}><Folder size={18} /></IconButton>} items={moveItems} />
        )}
        <span className="bar-fill" />
        <span className="reader-count">{messages.length > 1 ? `${messages.length} messages` : ""}</span>
      </header>

      <div className="reader-scroll">
        <div className="reader-inner">
          <div className="reader-head">
            <h1 className="reader-subject">{subject}</h1>
            <div className="reader-tags">
              {addressFolder && <span className="chip chip-address">{addressFolder.name}</span>}
              {toAddress && <span className="reader-to">to {toAddress.email}</span>}
            </div>
          </div>

          {aiDraft && !editing && sched && sched.draftId === aiDraft.id ? (
            <div className="ai-banner is-sending">
              <span className="ai-banner-icon"><Send size={17} /></span>
              <div className="ai-banner-text">
                <b>AI reply sends in <Countdown to={sched.sendAt} onDone={() => setTimeout(onChanged, 20_000)} /></b>
                <span>Written in {company.name}'s voice. Stop it to check it first.</span>
                {aiDraft.preview && <q className="ai-banner-preview">{aiDraft.preview}</q>}
              </div>
              <div className="ai-banner-actions">
                <Button size="sm" variant="ghost" onClick={() => stopSending()}>Stop</Button>
                <Button size="sm" onClick={() => editDraft(aiDraft)}>Edit</Button>
                <Button size="sm" variant="accent" onClick={sendNow}>Send now</Button>
              </div>
            </div>
          ) : aiDraft && !editing && (
            <div className="ai-banner">
              <span className="ai-banner-icon"><Sparkle size={18} /></span>
              <div className="ai-banner-text">
                <b>A reply is ready for you to check</b>
                <span>Written by AI in {company.name}'s voice. Nothing has been sent.</span>
                {aiDraft.preview && <q className="ai-banner-preview">{aiDraft.preview}</q>}
              </div>
              <div className="ai-banner-actions">
                <Button size="sm" variant="ghost" onClick={() => discardDraft(aiDraft)}>Discard</Button>
                <Button size="sm" variant="accent" onClick={() => editDraft(aiDraft)}>Review and send</Button>
              </div>
            </div>
          )}

          <div className="thread">
            {messages.map((e, i) => (
              <Message key={e.id} email={e} jmap={jmap} company={company} expanded={open.has(e.id) || i === messages.length - 1}
                folded={messages.length > 4 && i > 0 && i < messages.length - 2 && !open.has(e.id) && !open.has("all")}
                foldCount={i === 1 ? messages.length - 3 : 0}
                onUnfold={() => setOpen((o) => new Set([...o, "all"]))}
                onToggle={() => setOpen((o) => { const n = new Set(o); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}
                onReply={(k) => reply(k, e)} sent={!!roles.sent && !!e.mailboxIds[roles.sent]} />
            ))}
            {!editing && drafts.filter((d) => d !== aiDraft).map((d) => (
              <div key={d.id} className={cls("draft-card", d.keywords.$ai && "is-ai")} onClick={() => editDraft(d)} role="button" tabIndex={0}
                onKeyDown={(ev) => { if (ev.key === "Enter") editDraft(d); }}>
                <span className="draft-tag">{d.keywords.$ai ? <><Sparkle size={13} />AI draft</> : <><FileText size={13} />Draft</>}</span>
                <span className="draft-to">to {(d.to ?? []).map((a) => displayName(a)).join(", ") || "nobody yet"}</span>
                <span className="draft-preview">{d.preview || "(empty)"}</span>
                <span className="draft-actions">
                  <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); discardDraft(d); }}>Discard</Button>
                  <Button size="sm" onClick={(ev) => { ev.stopPropagation(); editDraft(d); }}>Edit</Button>
                </span>
              </div>
            ))}
          </div>

          {editing ? (
            <Composer key={`${editing.kind}-${editing.email.id}-${"aiText" in editing ? editing.aiText?.length ?? 0 : 0}`} intent={editing} company={company} jmap={jmap}
              boxes={boxes} identities={identities} inline onClose={() => setCompose(null)} onSent={onChanged} />
          ) : last && !messages.every((m) => roles.drafts && m.mailboxIds[roles.drafts]) && (
            <div className="reply-bar">
              <button className="reply-btn" onClick={() => reply("reply")}><Reply size={16} />Reply</button>
              {(last.to?.length ?? 0) + (last.cc?.length ?? 0) > 1 && <button className="reply-btn" onClick={() => reply("replyAll")}><ReplyAll size={16} />Reply all</button>}
              <button className="reply-btn" onClick={() => reply("forward")}><Forward size={16} />Forward</button>
              <span className="bar-fill" />
              <button className="ai-btn" onClick={aiReply} disabled={aiBusy}>{aiBusy ? <Spinner size={14} /> : <Sparkle size={15} />}{aiBusy ? "Writing…" : "Reply with AI"}</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Message({ email: e, jmap, company, expanded, folded, foldCount, sent, onToggle, onUnfold, onReply }: {
  email: Email; jmap: Jmap; company: Company; expanded: boolean; folded: boolean; foldCount: number; sent: boolean;
  onToggle: () => void; onUnfold: () => void; onReply: (k: "reply" | "replyAll" | "forward") => void;
}) {
  if (folded) {
    return foldCount > 0 ? <button className="thread-fold" onClick={onUnfold}><span>{foldCount} more</span></button> : null;
  }
  const from = e.from?.[0];
  const mine = company.addresses.some((a) => a.email.toLowerCase() === from?.email.toLowerCase());
  const recipients = [...(e.to ?? []), ...(e.cc ?? [])];
  const files = attachmentsOf(e);
  if (!expanded) {
    return (
      <button className="msg msg-collapsed" onClick={onToggle}>
        <Avatar name={displayName(from)} email={from?.email ?? "?"} size={30} />
        <span className="msg-from">{mine ? "You" : displayName(from)}</span>
        <span className="msg-snippet">{e.preview}</span>
        {e.hasAttachment && <Paperclip size={14} />}
        <span className="msg-time">{shortTime(e.receivedAt)}</span>
      </button>
    );
  }
  return (
    <article className={cls("msg", mine && "is-mine")}>
      <header className="msg-head" onClick={onToggle}>
        <Avatar name={displayName(from)} email={from?.email ?? "?"} size={38} />
        <div className="msg-who">
          <div className="msg-line">
            <span className="msg-name">{displayName(from)}</span>
            <span className="msg-email">{from?.email}</span>
            {e.keywords.$ai_replied && <span className="chip chip-ai-done"><Sparkle size={12} />Answered by AI</span>}
            {sent && e.keywords.$ai && <span className="chip chip-ai-done"><Sparkle size={12} />Sent by AI</span>}
          </div>
          <div className="msg-to">
            to {recipients.map((a) => (company.addresses.some((x) => x.email.toLowerCase() === a.email.toLowerCase()) ? a.email : displayName(a))).join(", ") || "undisclosed recipients"}
          </div>
        </div>
        <time className="msg-time" dateTime={e.receivedAt} title={longTime(e.receivedAt)}>{longTime(e.sentAt ?? e.receivedAt)}</time>
        <div className="msg-actions" onClick={(ev) => ev.stopPropagation()}>
          <IconButton label="Reply" onClick={() => onReply("reply")}><Reply size={17} /></IconButton>
          <Menu trigger={(o) => <IconButton label="More" onClick={o}><More size={17} /></IconButton>} items={[
            { label: "Reply all", icon: <ReplyAll size={16} />, onSelect: () => onReply("replyAll") },
            { label: "Forward", icon: <Forward size={16} />, onSelect: () => onReply("forward") },
          ]} />
        </div>
      </header>
      <div className="msg-body">
        <MessageBody email={e} jmap={jmap} />
      </div>
      {files.length > 0 && (
        <div className="atts">
          {files.map((f) => {
            const isImage = f.type.startsWith("image/") && !/svg/.test(f.type);
            return (
              <a key={f.blobId} className="att" href={jmap.blobUrl(f.blobId!, f.name ?? "file", f.type, !isImage && f.type !== "application/pdf")} target="_blank" rel="noreferrer">
                {isImage ? <img className="att-thumb" src={jmap.blobUrl(f.blobId!, f.name ?? "image", f.type)} alt="" loading="lazy" /> : <span className="att-icon">{extOf(f)}</span>}
                <span className="att-meta">
                  <span className="att-name">{f.name ?? "file"}</span>
                  <span className="att-size">{bytes(f.size ?? 0)}</span>
                </span>
                <span className="att-dl" aria-hidden><Download size={15} /></span>
              </a>
            );
          })}
        </div>
      )}
    </article>
  );
}

/** Real attachments: not the pictures the HTML shows inline. */
function attachmentsOf(e: Email): BodyPart[] {
  const html = e.htmlBody?.map((p) => (p.partId ? e.bodyValues?.[p.partId]?.value ?? "" : "")).join("") ?? "";
  return (e.attachments ?? []).filter((a) => a.blobId && !(a.cid && html.includes(`cid:${a.cid.replace(/^<|>$/g, "")}`)));
}

function extOf(f: BodyPart): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(f.name ?? "");
  return (m?.[1] ?? f.type.split("/")[1] ?? "file").slice(0, 4).toUpperCase();
}

/** m:ss until a time, ticking. */
function Countdown({ to, onDone }: { to: number; onDone?: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, to - Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, to - Date.now());
      setLeft(l);
      if (l === 0) { clearInterval(t); onDone?.(); }
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  const s = Math.ceil(left / 1000);
  return <span className="countdown">{s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "a moment"}</span>;
}
