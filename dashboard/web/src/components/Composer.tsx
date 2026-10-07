// Writing mail: new, reply, reply all, forward, or picking up a draft (an AI
// draft included). Saves itself to Drafts as you write; Send waits five seconds
// so it can be undone; "Write with AI" drafts a reply in the company's voice.
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "../api";
import { saveDraft, sendDraft, type Draft, type Jmap } from "../jmap";
import { useApp, type ComposeIntent } from "../store";
import type { Company, Email, EmailAddress, Identity, Mailbox } from "../types";
import { bytes, cls, displayName, escapeHtml, isEmail, longTime, modKey, textToHtml } from "../util";
import { Bold, Italic, Link, List, Paperclip, Quote, Sparkle, Trash, X } from "../icons";
import { Button, IconButton, Spinner } from "../ui";
import { Recipients } from "./Recipients";

type Att = { blobId: string; name: string; type: string; size: number; uploading?: boolean; key: string };

const ours = (c: Company) => new Set(c.addresses.map((a) => a.email.toLowerCase()));

function bodyHtmlOf(e: Email): string {
  const h = e.htmlBody?.find((p) => p.type === "text/html" && p.partId && e.bodyValues?.[p.partId]);
  if (h) return DOMPurify.sanitize(e.bodyValues![h.partId!].value, { FORBID_TAGS: ["script", "style", "iframe", "form", "img"] }) as string;
  const t = (e.textBody ?? []).map((p) => e.bodyValues?.[p.partId!]?.value ?? "").join("\n");
  return textToHtml(t);
}

function signatureHtml(sig: string): string {
  return sig.trim() ? `<p><br></p><div class="xm-sig">${textToHtml(sig.trim())}</div>` : "";
}

function initial(intent: ComposeIntent, c: Company): { draft: Draft; html: string; atts: Att[] } {
  const primary = c.addresses.find((a) => a.isPrimary) ?? c.addresses[0];
  const mine = ours(c);
  const base: Draft = { fromEmail: primary.email, fromName: c.name, to: [], cc: [], bcc: [], subject: "", html: "", text: "", attachments: [] };
  if (intent.kind === "new") {
    return { draft: { ...base, to: intent.to ? [{ email: intent.to }] : [] }, html: `<p><br></p>${signatureHtml(c.signature)}`, atts: [] };
  }
  const e = intent.email;
  if (intent.kind === "draft") {
    const atts = (e.attachments ?? []).filter((a) => a.blobId).map((a) => ({ blobId: a.blobId!, name: a.name ?? "file", type: a.type, size: a.size ?? 0, key: a.blobId! }));
    return {
      draft: { ...base, id: e.id, fromEmail: e.from?.[0]?.email ?? base.fromEmail, to: e.to ?? [], cc: e.cc ?? [], bcc: e.bcc ?? [], subject: e.subject ?? "",
        inReplyTo: e.inReplyTo ?? undefined, references: e.references ?? undefined, attachments: atts },
      html: bodyHtmlOf(e), atts,
    };
  }
  // Reply, reply all, forward: from the address the message came to.
  const received = [...(e.to ?? []), ...(e.cc ?? [])].map((a) => a.email.toLowerCase());
  const fromEmail = c.addresses.find((a) => received.includes(a.email.toLowerCase()))?.email ?? primary.email;
  const quoteHead = `On ${escapeHtml(longTime(e.sentAt ?? e.receivedAt))}, ${escapeHtml(displayName(e.from?.[0]))} &lt;${escapeHtml(e.from?.[0]?.email ?? "")}&gt; wrote:`;
  const quoted = `<div class="xm-quote-block"><p>${quoteHead}</p><blockquote type="cite">${bodyHtmlOf(e)}</blockquote></div>`;
  const subject = e.subject ?? "";
  const refs = [...(e.references ?? []), ...(e.messageId ?? [])];
  if (intent.kind === "forward") {
    const head = `<p>---------- Forwarded message ----------<br>From: ${escapeHtml(displayName(e.from?.[0]))} &lt;${escapeHtml(e.from?.[0]?.email ?? "")}&gt;<br>Date: ${escapeHtml(longTime(e.sentAt ?? e.receivedAt))}<br>Subject: ${escapeHtml(subject)}<br>To: ${escapeHtml((e.to ?? []).map((a) => a.email).join(", "))}</p>`;
    const atts = (e.attachments ?? []).filter((a) => a.blobId && a.disposition !== "inline").map((a) => ({ blobId: a.blobId!, name: a.name ?? "file", type: a.type, size: a.size ?? 0, key: a.blobId! }));
    return {
      draft: { ...base, fromEmail, subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`, attachments: atts },
      html: `<p><br></p>${signatureHtml(c.signature)}<p><br></p>${head}${bodyHtmlOf(e)}`, atts,
    };
  }
  const replyTo: EmailAddress[] = (e.replyTo?.length ? e.replyTo : e.from) ?? [];
  let to = replyTo;
  let cc: EmailAddress[] = [];
  if (intent.kind === "replyAll") {
    const seen = new Set([...mine, ...to.map((a) => a.email.toLowerCase())]);
    const add = (list: EmailAddress[] = []) => list.filter((a) => { const k = a.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    to = [...to, ...add(e.to ?? [])];
    cc = add(e.cc ?? []);
  }
  const ai = intent.aiText ? textToHtml(intent.aiText) : "<p><br></p>";
  return {
    draft: { ...base, fromEmail, to, cc, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, inReplyTo: e.messageId ?? undefined, references: refs.length ? refs : undefined, replyToEmailId: e.id },
    html: `${ai}${intent.aiText ? "" : signatureHtml(c.signature)}<p><br></p>${quoted}`, atts: [],
  };
}

export function Composer({ intent, company, jmap, boxes, identities, inline, onClose, onSent }: {
  intent: ComposeIntent; company: Company; jmap: Jmap; boxes: Mailbox[]; identities: Identity[]; inline?: boolean;
  onClose: () => void;
  /** Called once the mail is sent or the draft thrown away, so the views can refresh. */
  onSent?: () => void;
}) {
  const { toast, dismiss, refreshUnread } = useApp();
  const start = useMemo(() => initial(intent, company), [intent, company]);
  const [d, setD] = useState<Draft>(start.draft);
  const [atts, setAtts] = useState<Att[]>(start.atts);
  const [showCc, setShowCc] = useState(start.draft.cc.length > 0 || start.draft.bcc.length > 0);
  const [contacts, setContacts] = useState<EmailAddress[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [ai, setAi] = useState<{ open: boolean; busy: boolean; instruction: string; note?: string }>({ open: false, busy: false, instruction: "" });
  const [dragging, setDragging] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const draftId = useRef<string | undefined>(start.draft.id);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);
  const edits = useRef(0);
  // The message being answered: the one replied to, or the one an (AI) draft answers.
  const replyToId = intent.kind === "reply" || intent.kind === "replyAll" ? intent.email.id : intent.kind === "draft" ? intent.replyTo : undefined;

  useEffect(() => {
    if (editor.current) editor.current.innerHTML = start.html;
    if (intent.kind !== "new" && editor.current) {
      editor.current.focus();
      const sel = window.getSelection();
      const first = editor.current.firstChild;
      if (sel && first) { const r = document.createRange(); r.setStart(first, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    }
    jmap.recentContacts().then(setContacts).catch(() => {});
  }, [start, jmap, intent.kind]);

  const current = (): Draft => ({
    ...d, id: draftId.current,
    html: editor.current?.innerHTML ?? "",
    text: (editor.current?.innerText ?? "").replace(/\n{3,}/g, "\n\n"),
    attachments: atts.filter((a) => !a.uploading).map(({ blobId, name, type, size }) => ({ blobId, name, type, size })),
  });

  // Saves run one after another, each replacing the last version.
  function save(): Promise<void> {
    saveChain.current = saveChain.current.then(async () => {
      setSaving("saving");
      const version = edits.current;
      try {
        draftId.current = await saveDraft(jmap, boxes, current());
        setSaving("saved");
        if (edits.current === version) setDirty(false);
      } catch (e) {
        setSaving("idle");
        toast({ text: `Could not save the draft: ${(e as Error).message}`, tone: "error" });
      }
    });
    return saveChain.current;
  }

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(save, 2500);
    return () => clearTimeout(t);
  });

  const touch = () => { edits.current++; setDirty(true); setSaving("idle"); };
  const update = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); touch(); };

  async function upload(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (f.size > 45 * 1024 * 1024) { toast({ text: `${f.name} is over 45 MB; mail servers refuse files that large.`, tone: "error" }); continue; }
      const key = `${f.name}-${f.size}-${Math.random()}`;
      setAtts((a) => [...a, { blobId: "", name: f.name, type: f.type || "application/octet-stream", size: f.size, uploading: true, key }]);
      try {
        const up = await jmap.upload(f);
        setAtts((a) => a.map((x) => (x.key === key ? { ...x, blobId: up.blobId, uploading: false } : x)));
        touch();
      } catch (e) {
        setAtts((a) => a.filter((x) => x.key !== key));
        toast({ text: `${f.name} did not upload: ${(e as Error).message}`, tone: "error" });
      }
    }
  }

  async function send() {
    const all = [...d.to, ...d.cc, ...d.bcc];
    if (!all.length) { toast({ text: "Add someone to send it to.", tone: "error" }); return; }
    const bad = all.find((a) => !isEmail(a.email));
    if (bad) { toast({ text: `${bad.email} is not an email address.`, tone: "error" }); return; }
    if (atts.some((a) => a.uploading)) { toast({ text: "Wait for the attachments to finish uploading." }); return; }
    if (!d.subject.trim() && !confirm("Send without a subject?")) return;
    await save();
    const id = draftId.current;
    if (!id) return;
    onClose();
    let undone = false;
    const pending = toast({ text: "Sending…", ms: 5200, action: { label: "Undo", run: () => { undone = true; toast({ text: "Not sent. It is in Drafts." }); } } });
    setTimeout(async () => {
      if (undone) return;
      dismiss(pending);
      try {
        await sendDraft(jmap, boxes, identities, id, d.fromEmail, replyToId);
        toast({ text: `Sent to ${displayName(all[0])}${all.length > 1 ? ` and ${all.length - 1} more` : ""}.`, tone: "ok" });
        onSent?.();
        refreshUnread();
      } catch (e) {
        toast({ text: `Not sent: ${(e as Error).message}. It is in Drafts.`, tone: "error" });
      }
    }, 5000);
  }

  async function discard() {
    const id = draftId.current;
    onClose();
    if (id) {
      try { await jmap.destroy([id]); } catch { /* already gone */ }
    }
    // Throwing away an AI draft means it no longer waits for review.
    if (intent.kind === "draft" && replyToId) {
      await jmap.setKeyword([replyToId], "$ai_draft", false).catch(() => {});
      await jmap.setKeyword([replyToId], "$ai_scheduled", false).catch(() => {});
    }
    onSent?.();
    toast({ text: "Draft discarded." });
    refreshUnread();
  }

  async function close() {
    if (dirty) {
      await save();
      toast({ text: "Saved to Drafts." });
    }
    onClose();
  }

  async function writeWithAi() {
    if (!replyToId) return;
    setAi((a) => ({ ...a, busy: true, note: undefined }));
    try {
      const r = await post<{ text: string; decision: string; reason: string }>(`/api/c/${company.id}/ai/suggest`, { emailId: replyToId, from: d.fromEmail, instruction: ai.instruction || undefined });
      if (editor.current) {
        const quote = editor.current.querySelector(".xm-quote-block");
        const sig = editor.current.querySelector(".xm-sig");
        const html = textToHtml(r.text);
        // Replace what is above the quote (and the signature, which the AI text carries).
        sig?.remove();
        if (quote) {
          while (editor.current.firstChild && editor.current.firstChild !== quote) editor.current.removeChild(editor.current.firstChild);
          quote.insertAdjacentHTML("beforebegin", html + "<p><br></p>");
        } else {
          editor.current.innerHTML = html;
        }
      }
      setAi({ open: false, busy: false, instruction: "", note: r.decision === "escalate" ? `The AI thinks a person should look at this: ${r.reason}` : undefined });
      touch();
    } catch (e) {
      setAi((a) => ({ ...a, busy: false }));
      toast({ text: (e as Error).message, tone: "error" });
    }
  }

  const exec = (cmd: string, value?: string) => { editor.current?.focus(); document.execCommand(cmd, false, value); touch(); };
  const title = intent.kind === "new" ? "New message" : intent.kind === "forward" ? "Forward" : intent.kind === "draft" ? (d.subject || "Draft") : `Reply to ${displayName(intent.email.from?.[0])}`;

  return (
    <div className={cls("composer", inline ? "composer-inline" : "composer-floating", dragging && "is-dragging")}
      style={{ "--co": company.color } as React.CSSProperties}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
        if (e.key === "Escape" && !inline) { e.preventDefault(); close(); }
        e.stopPropagation();
      }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); } }}
      role="dialog" aria-label={title}>
      <header className="cmp-head">
        <span className="cmp-title">{title}</span>
        <span className="cmp-status">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}</span>
        <IconButton label="Close" onClick={close}><X size={16} /></IconButton>
      </header>
      <div className="cmp-fields">
        <label className="cmp-row">
          <span className="cmp-label">From</span>
          <select className="cmp-from" value={d.fromEmail} onChange={(e) => update({ fromEmail: e.target.value })}>
            {company.addresses.map((a) => <option key={a.email} value={a.email}>{company.name} &lt;{a.email}&gt;</option>)}
          </select>
        </label>
        <div className="cmp-row">
          <span className="cmp-label">To</span>
          <Recipients value={d.to} onChange={(to) => update({ to })} suggestions={contacts} autoFocus={intent.kind === "new" || intent.kind === "forward"} placeholder="Name or address" />
          {!showCc && <button type="button" className="cmp-link" onClick={() => setShowCc(true)}>Cc Bcc</button>}
        </div>
        {showCc && <div className="cmp-row"><span className="cmp-label">Cc</span><Recipients value={d.cc} onChange={(cc) => update({ cc })} suggestions={contacts} /></div>}
        {showCc && <div className="cmp-row"><span className="cmp-label">Bcc</span><Recipients value={d.bcc} onChange={(bcc) => update({ bcc })} suggestions={contacts} /></div>}
        <label className="cmp-row">
          <span className="cmp-label">Subject</span>
          <input className="cmp-subject" value={d.subject} onChange={(e) => update({ subject: e.target.value })} placeholder="What it is about" />
        </label>
      </div>

      {ai.open && (
        <div className="cmp-ai">
          <Sparkle size={16} />
          <input autoFocus placeholder="Anything it should say? (optional) e.g. offer a call on Friday" value={ai.instruction}
            onChange={(e) => setAi((a) => ({ ...a, instruction: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); writeWithAi(); } }} />
          <Button variant="accent" size="sm" onClick={writeWithAi} busy={ai.busy}>Write it</Button>
          <IconButton label="Close" onClick={() => setAi({ open: false, busy: false, instruction: "" })}><X size={14} /></IconButton>
        </div>
      )}
      {ai.note && <div className="cmp-note">{ai.note}</div>}

      <div className={cls("cmp-editor-wrap", ai.busy && "is-thinking")}>
        <div ref={editor} className="cmp-editor" contentEditable suppressContentEditableWarning onInput={touch}
          onPaste={(e) => {
            if (e.clipboardData.files.length) { e.preventDefault(); upload(e.clipboardData.files); return; }
            const html = e.clipboardData.getData("text/html");
            if (html) { e.preventDefault(); document.execCommand("insertHTML", false, DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "script", "meta"], FORBID_ATTR: ["style", "class"] }) as string); }
          }}
          aria-label="Message" role="textbox" aria-multiline="true" />
      </div>

      {atts.length > 0 && (
        <div className="cmp-atts">
          {atts.map((a) => (
            <span key={a.key} className={cls("att-chip", a.uploading && "is-uploading")}>
              {a.uploading ? <Spinner size={12} /> : <Paperclip size={13} />}
              <span className="att-name">{a.name}</span>
              <span className="att-size">{bytes(a.size)}</span>
              <button aria-label={`Remove ${a.name}`} onClick={() => { setAtts((x) => x.filter((y) => y.key !== a.key)); touch(); }}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      <footer className="cmp-foot">
        <Button variant="accent" onClick={send} title={`Send  ${modKey}↵`}>Send</Button>
        <div className="cmp-tools">
          <IconButton label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip size={17} /></IconButton>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
          <span className="cmp-sep" />
          <IconButton label="Bold" shortcut={`${modKey}B`} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")}><Bold size={16} /></IconButton>
          <IconButton label="Italic" shortcut={`${modKey}I`} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")}><Italic size={16} /></IconButton>
          <IconButton label="List" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")}><List size={16} /></IconButton>
          <IconButton label="Quote" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("formatBlock", "blockquote")}><Quote size={16} /></IconButton>
          <IconButton label="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => { const u = prompt("Link address"); if (u) exec("createLink", /^https?:|^mailto:/.test(u) ? u : `https://${u}`); }}><Link size={16} /></IconButton>
          {replyToId && (
            <button className="ai-btn" onClick={() => setAi((a) => ({ ...a, open: !a.open }))} disabled={ai.busy}>
              <Sparkle size={15} />Write with AI
            </button>
          )}
        </div>
        <IconButton label="Discard draft" onClick={discard}><Trash size={16} /></IconButton>
      </footer>
      {dragging && <div className="cmp-drop">Drop to attach</div>}
    </div>
  );
}
