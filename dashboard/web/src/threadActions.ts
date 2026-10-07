// What you can do to whole conversations: archive, delete, spam, move, read,
// star. Each move returns an undo that puts every message back where it was.
import { buildFolders } from "./folders";
import type { Jmap } from "./jmap";
import type { Company, Email, Mailbox } from "./types";

export type MoveTo = "archive" | "trash" | "junk" | "inbox" | { folderId: string; name: string };
export type Undo = () => Promise<void>;

/** Moves conversations; messages only in Sent or Drafts stay put unless deleting. */
export async function moveThreads(j: Jmap, boxes: Mailbox[], company: Company, threadIds: string[], to: MoveTo, fromBoxId?: string): Promise<{ undo: Undo; moved: number }> {
  const emails = await j.threadEmails(threadIds);
  const role = (r: string) => boxes.find((b) => b.role === r)?.id;
  const inbox = role("inbox"), sent = role("sent"), drafts = role("drafts"), trash = role("trash"), junk = role("junk");
  const addressIds = new Set(buildFolders(boxes, company).addresses.map((f) => f.id));
  const target = to === "archive" ? await j.archive(boxes) : to === "trash" ? trash : to === "junk" ? junk : to === "inbox" ? inbox : to.folderId;
  if (!target) throw new Error(`This mailbox has no ${typeof to === "string" ? to : to.name} folder.`);

  const onlyOutgoing = (e: Email) => Object.keys(e.mailboxIds).every((id) => id === sent || id === drafts);
  const before = new Map<string, { mailboxIds: Record<string, boolean>; keywords: Record<string, boolean> }>();
  const update: Record<string, Record<string, unknown>> = {};
  for (const e of emails) {
    const ids = Object.keys(e.mailboxIds);
    let next: Record<string, boolean> | null = null;
    if (to === "archive") {
      // Out of the Inbox, the address folders and the folder being looked at.
      const leave = ids.filter((id) => id === inbox || addressIds.has(id) || id === fromBoxId);
      if (leave.length && target) next = Object.fromEntries([...ids.filter((id) => !leave.includes(id)), target].map((id) => [id, true]));
    } else if (to === "trash") {
      if (!(ids.length === 1 && ids[0] === trash)) next = { [target]: true };
    } else if (to === "junk") {
      if (!onlyOutgoing(e)) next = { [target]: true };
    } else if (to === "inbox") {
      // Back to the Inbox from Spam, Trash or Archive (and the address folder it was filed in).
      if (!onlyOutgoing(e) || ids.includes(trash ?? "") || ids.includes(junk ?? "")) {
        const keep = ids.filter((id) => id !== trash && id !== junk && id !== fromBoxId && id !== drafts);
        next = Object.fromEntries([...new Set([...keep, target])].map((id) => [id, true]));
      }
    } else if (!onlyOutgoing(e) || ids.includes(fromBoxId ?? "")) {
      next = { [target]: true };
    }
    if (!next) continue;
    before.set(e.id, { mailboxIds: e.mailboxIds, keywords: e.keywords });
    const patch: Record<string, unknown> = { mailboxIds: next };
    if (to === "junk") { patch["keywords/$junk"] = true; patch["keywords/$notjunk"] = null; }
    if (to === "inbox" && ids.includes(junk ?? "")) { patch["keywords/$junk"] = null; patch["keywords/$notjunk"] = true; }
    update[e.id] = patch;
  }
  if (Object.keys(update).length) await j.request([["Email/set", { update }, "m"]]);
  return {
    moved: new Set(emails.filter((e) => before.has(e.id)).map((e) => e.threadId)).size,
    undo: async () => {
      const back = Object.fromEntries([...before].map(([id, v]) => [id, {
        mailboxIds: v.mailboxIds,
        "keywords/$junk": v.keywords.$junk ? true : null,
        "keywords/$notjunk": v.keywords.$notjunk ? true : null,
      }]));
      if (Object.keys(back).length) await j.request([["Email/set", { update: back }, "u"]]);
    },
  };
}

/** Deletes conversations for good (from Trash or Spam). */
export async function destroyThreads(j: Jmap, threadIds: string[]): Promise<number> {
  const emails = await j.threadEmails(threadIds);
  await j.destroy(emails.map((e) => e.id));
  return threadIds.length;
}

export async function markRead(j: Jmap, threadIds: string[], read: boolean): Promise<void> {
  const emails = await j.threadEmails(threadIds);
  if (read) {
    await j.setKeyword(emails.filter((e) => !e.keywords.$seen).map((e) => e.id), "$seen", true);
  } else {
    // Unread means the newest message is unread, like every mail app.
    const newest = new Map<string, Email>();
    for (const e of emails) if (!newest.has(e.threadId) || newest.get(e.threadId)!.receivedAt < e.receivedAt) newest.set(e.threadId, e);
    await j.setKeyword([...newest.values()].map((e) => e.id), "$seen", false);
  }
}

/** Stars (or unstars) a conversation's newest message; unstarring clears every star in it. */
export async function star(j: Jmap, threadIds: string[], on: boolean): Promise<void> {
  const emails = await j.threadEmails(threadIds);
  if (!on) {
    await j.setKeyword(emails.filter((e) => e.keywords.$flagged).map((e) => e.id), "$flagged", false);
    return;
  }
  const newest = new Map<string, Email>();
  for (const e of emails) if (!newest.has(e.threadId) || newest.get(e.threadId)!.receivedAt < e.receivedAt) newest.set(e.threadId, e);
  await j.setKeyword([...newest.values()].map((e) => e.id), "$flagged", true);
}
