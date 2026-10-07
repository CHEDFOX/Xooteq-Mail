// One company's mailbox, over JMAP through the dashboard's proxy. Everything the
// inbox does to mail is in here, so the views stay about what they show.
import { api } from "./api";
import type { Email, EmailAddress, Identity, Mailbox } from "./types";

type Call = [string, Record<string, unknown>, string];
type Result = Record<string, any>;

export class JmapError extends Error {}

export const LIST_PROPS = ["id", "threadId", "mailboxIds", "keywords", "from", "to", "subject", "preview", "receivedAt", "hasAttachment", "size"];
export const FULL_PROPS = [
  "id", "threadId", "mailboxIds", "keywords", "from", "to", "cc", "bcc", "replyTo", "subject", "preview", "receivedAt", "sentAt",
  "hasAttachment", "messageId", "references", "inReplyTo", "textBody", "htmlBody", "attachments", "bodyValues", "size",
];
const BODY_PROPS = ["partId", "blobId", "type", "name", "size", "cid", "disposition"];

export type ThreadRow = Email & { count: number; unread: boolean };

export class Jmap {
  readonly cid: string;
  private archiveId?: string;
  constructor(cid: string) {
    this.cid = cid;
  }

  async request(calls: Call[]): Promise<Result[]> {
    const res = await api<{ methodResponses: [string, Result, string][] }>("POST", `/api/c/${this.cid}/jmap`, { methodCalls: calls });
    return res.methodResponses.map(([name, args]) => {
      if (name === "error") throw new JmapError(String(args.description ?? args.type ?? "The mail server refused that."));
      for (const k of ["notCreated", "notUpdated", "notDestroyed"]) {
        if (args[k] && Object.keys(args[k]).length) {
          const first = Object.values(args[k] as Record<string, { description?: string; type?: string }>)[0];
          throw new JmapError(first.description || first.type || "The mail server refused that.");
        }
      }
      return args;
    });
  }

  async mailboxes(): Promise<Mailbox[]> {
    const [r] = await this.request([["Mailbox/get", { properties: ["name", "parentId", "role", "sortOrder", "totalEmails", "unreadEmails", "totalThreads", "unreadThreads"] }, "m"]]);
    return r.list as Mailbox[];
  }

  /** The Archive folder; Stalwart makes none by default, so the first archive makes it. */
  async archive(boxes: Mailbox[]): Promise<string> {
    if (this.archiveId) return this.archiveId;
    const found = boxes.find((b) => b.role === "archive") ?? boxes.find((b) => !b.parentId && b.name.toLowerCase() === "archive");
    if (found) return (this.archiveId = found.id);
    const [r] = await this.request([["Mailbox/set", { create: { a: { name: "Archive", role: "archive", parentId: null } } }, "c"]]);
    return (this.archiveId = r.created.a.id as string);
  }

  /** One row per conversation, newest first, with how many messages it has. */
  async threads(filter: Record<string, unknown>, position = 0, limit = 50): Promise<{ rows: ThreadRow[]; total: number }> {
    const [q, g, t] = await this.request([
      ["Email/query", { filter, sort: [{ property: "receivedAt", isAscending: false }], collapseThreads: true, position, limit, calculateTotal: true }, "q"],
      ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: LIST_PROPS }, "g"],
      ["Thread/get", { "#ids": { resultOf: "g", name: "Email/get", path: "/list/*/threadId" } }, "t"],
    ]);
    const counts = new Map<string, number>((t.list as { id: string; emailIds: string[] }[]).map((x) => [x.id, x.emailIds.length]));
    const byId = new Map((g.list as Email[]).map((e) => [e.id, e]));
    const rows = (q.ids as string[]).map((id) => byId.get(id)).filter(Boolean).map((e) => ({
      ...(e as Email), count: counts.get((e as Email).threadId) ?? 1, unread: !(e as Email).keywords?.$seen,
    }));
    return { rows, total: q.total ?? rows.length };
  }

  /** Every message of a conversation, oldest first, with bodies. */
  async thread(threadId: string): Promise<Email[]> {
    const [, g] = await this.request([
      ["Thread/get", { ids: [threadId] }, "t"],
      ["Email/get", {
        "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" }, properties: FULL_PROPS, bodyProperties: BODY_PROPS,
        fetchHTMLBodyValues: true, fetchTextBodyValues: true, maxBodyValueBytes: 2_000_000,
      }, "g"],
    ]);
    return (g.list as Email[]).sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
  }

  /** Every message of some conversations, with just their folders and flags (for acting on whole threads). */
  async threadEmails(threadIds: string[]): Promise<Email[]> {
    if (!threadIds.length) return [];
    const [, g] = await this.request([
      ["Thread/get", { ids: threadIds }, "t"],
      ["Email/get", { "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" }, properties: ["id", "threadId", "mailboxIds", "keywords", "receivedAt"] }, "g"],
    ]);
    return g.list as Email[];
  }

  /** How many conversations match. */
  async count(filter: Record<string, unknown>): Promise<number> {
    const [q] = await this.request([["Email/query", { filter, collapseThreads: true, calculateTotal: true, limit: 1 }, "q"]]);
    return Number(q.total ?? 0);
  }

  async email(id: string): Promise<Email | null> {
    const [g] = await this.request([["Email/get", { ids: [id], properties: FULL_PROPS, bodyProperties: BODY_PROPS, fetchHTMLBodyValues: true, fetchTextBodyValues: true, maxBodyValueBytes: 2_000_000 }, "g"]]);
    return (g.list as Email[])[0] ?? null;
  }

  async setKeyword(ids: string[], keyword: string, on: boolean): Promise<void> {
    if (!ids.length) return;
    await this.request([["Email/set", { update: Object.fromEntries(ids.map((id) => [id, { [`keywords/${keyword}`]: on ? true : null }])) }, "s"]]);
  }

  /** Patches each message's folders. */
  async setMailboxes(emails: Email[], change: (current: Record<string, boolean>) => Record<string, boolean>): Promise<void> {
    if (!emails.length) return;
    await this.request([["Email/set", { update: Object.fromEntries(emails.map((e) => [e.id, { mailboxIds: change({ ...e.mailboxIds }) }])) }, "s"]]);
  }

  async destroy(ids: string[]): Promise<void> {
    if (ids.length) await this.request([["Email/set", { destroy: ids }, "d"]]);
  }

  async identities(): Promise<Identity[]> {
    const [r] = await this.request([["Identity/get", {}, "i"]]);
    return r.list as Identity[];
  }

  async upload(file: Blob): Promise<{ blobId: string; size: number; type: string }> {
    return api("POST", `/api/c/${this.cid}/upload`, file, { headers: { "content-type": file.type || "application/octet-stream" } });
  }

  blobUrl(blobId: string, name: string, type: string, download = false): string {
    return `/api/c/${this.cid}/blob/${encodeURIComponent(blobId)}/${encodeURIComponent(name || "file")}?type=${encodeURIComponent(type || "application/octet-stream")}${download ? "&download=1" : ""}`;
  }

  async search(text: string, limit = 40): Promise<{ rows: ThreadRow[]; total: number }> {
    return this.threads({ text }, 0, limit);
  }

  /** Recent correspondents, for the To field's suggestions. */
  async recentContacts(): Promise<EmailAddress[]> {
    const [, g] = await this.request([
      ["Email/query", { sort: [{ property: "receivedAt", isAscending: false }], limit: 300 }, "q"],
      ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["from", "to", "cc"] }, "g"],
    ]);
    const seen = new Map<string, EmailAddress>();
    for (const e of g.list as Email[]) {
      for (const a of [...(e.from ?? []), ...(e.to ?? []), ...(e.cc ?? [])]) {
        const k = a.email.toLowerCase();
        if (!seen.has(k) || (!seen.get(k)!.name && a.name)) seen.set(k, a);
      }
    }
    return [...seen.values()];
  }
}

export type Draft = {
  id?: string;
  fromEmail: string;
  fromName: string;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  html: string;
  text: string;
  attachments: { blobId: string; name: string; type: string; size: number }[];
  inReplyTo?: string[];
  references?: string[];
  replyToEmailId?: string;
};

function emailObject(d: Draft, drafts: string): Record<string, unknown> {
  return {
    mailboxIds: { [drafts]: true },
    keywords: { $draft: true, $seen: true },
    from: [{ name: d.fromName, email: d.fromEmail }],
    to: d.to, cc: d.cc, bcc: d.bcc,
    subject: d.subject,
    ...(d.inReplyTo?.length ? { inReplyTo: d.inReplyTo, references: d.references ?? d.inReplyTo } : {}),
    bodyValues: { t: { value: d.text }, h: { value: d.html } },
    textBody: [{ partId: "t", type: "text/plain" }],
    htmlBody: [{ partId: "h", type: "text/html" }],
    attachments: d.attachments.map((a) => ({ blobId: a.blobId, type: a.type, name: a.name, size: a.size, disposition: "attachment" })),
  };
}

/** Saves (or replaces) a draft; returns its new id. Messages are immutable, so a new version replaces the old. */
export async function saveDraft(j: Jmap, boxes: Mailbox[], d: Draft): Promise<string> {
  const drafts = boxes.find((b) => b.role === "drafts")?.id;
  if (!drafts) throw new JmapError("This mailbox has no Drafts folder.");
  const [r] = await j.request([["Email/set", { create: { d: emailObject(d, drafts) }, ...(d.id ? { destroy: [d.id] } : {}) }, "s"]]);
  return r.created.d.id as string;
}

/** Sends a saved draft from the identity matching its From address. */
export async function sendDraft(j: Jmap, boxes: Mailbox[], identities: Identity[], draftId: string, fromEmail: string, replyToEmailId?: string): Promise<void> {
  const identity = identities.find((i) => i.email.toLowerCase() === fromEmail.toLowerCase());
  if (!identity) throw new JmapError(`${fromEmail} cannot send from this mailbox.`);
  const drafts = boxes.find((b) => b.role === "drafts")?.id;
  const sent = boxes.find((b) => b.role === "sent")?.id;
  const calls: Call[] = [["EmailSubmission/set", {
    create: { s: { identityId: identity.id, emailId: draftId } },
    onSuccessUpdateEmail: { "#s": { ...(drafts ? { [`mailboxIds/${drafts}`]: null } : {}), ...(sent ? { [`mailboxIds/${sent}`]: true } : {}), "keywords/$draft": null } },
  }, "s"]];
  if (replyToEmailId) calls.push(["Email/set", { update: { [replyToEmailId]: { "keywords/$answered": true, "keywords/$ai_draft": null, "keywords/$ai_scheduled": null } } }, "a"]);
  await j.request(calls);
}
