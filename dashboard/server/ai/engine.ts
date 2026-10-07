// AI replies. Stalwart posts every delivered message to /hooks/stalwart; for
// each recipient address whose AI mode is on, this finds the message in the
// company's mailbox, checks it deserves an answer, asks the company's provider
// for one in the company's voice, and then either:
//
//   draft  saves the reply as a draft in the thread (marked "AI draft") for a
//          person to read, edit and send, or
//   send   sends it, after the profile's delay (so it can still be cancelled),
//          unless the model judged it needs a person, the sender already had
//          today's share of automatic replies, or anything looks off: then a
//          draft, as above.
//
// Every decision is a row in ai_runs, shown in the dashboard.
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { companyForAddress, listCompanies, getCompany, type Company, type CompanyAddress } from "../companies.ts";
import { Mailbox } from "../stalwart.ts";
import { AiError, complete, defaultProvider, getProvider, type Provider } from "./providers.ts";
import { getProfile, REPLY_SCHEMA, systemPrompt, userPrompt, type ReplyAnswer, type ThreadMessage } from "./prompt.ts";

type Addr = { name?: string | null; email: string };
type JEmail = {
  id: string; threadId: string; mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>;
  from?: Addr[] | null; to?: Addr[] | null; cc?: Addr[] | null; replyTo?: Addr[] | null;
  subject?: string | null; sentAt?: string | null; receivedAt: string;
  messageId?: string[] | null; references?: string[] | null;
  textBody?: { partId: string; type: string }[]; htmlBody?: { partId: string; type: string }[];
  bodyValues?: Record<string, { value: string }>;
  "header:Auto-Submitted:asText"?: string | null;
  "header:List-Id:asText"?: string | null;
  "header:List-Unsubscribe:asText"?: string | null;
  "header:Precedence:asText"?: string | null;
};

const EMAIL_PROPS = [
  "id", "threadId", "mailboxIds", "keywords", "from", "to", "cc", "replyTo", "subject", "sentAt", "receivedAt",
  "messageId", "references", "textBody", "htmlBody", "bodyValues",
  "header:Auto-Submitted:asText", "header:List-Id:asText", "header:List-Unsubscribe:asText", "header:Precedence:asText",
];

const fmt = (a?: Addr[] | null) => (a ?? []).map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(", ");

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function bodyText(e: JEmail): string {
  const parts = e.textBody ?? [];
  const text = parts.map((p) => {
    const v = e.bodyValues?.[p.partId]?.value ?? "";
    return p.type === "text/html" ? stripHtml(v) : v;
  }).join("\n").trim();
  if (text) return text;
  return (e.htmlBody ?? []).map((p) => stripHtml(e.bodyValues?.[p.partId]?.value ?? "")).join("\n").trim();
}

/** Plain text to a small, safe HTML body: paragraphs and line breaks. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55">` +
    text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("") + "</div>";
}

/** Reasons not to answer a message automatically at all. */
export function skipReason(e: JEmail, ourDomains: Set<string>, junkId?: string): string | null {
  const sender = e.from?.[0]?.email?.toLowerCase() ?? "";
  if (!sender) return "no sender";
  const auto = (e["header:Auto-Submitted:asText"] ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return "automatic message (Auto-Submitted)";
  if (e["header:List-Id:asText"] || e["header:List-Unsubscribe:asText"]) return "mailing list or newsletter";
  if (/^(bulk|list|junk)$/i.test((e["header:Precedence:asText"] ?? "").trim())) return "bulk mail";
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([+.-]|@)/i.test(sender)) return "sent from a no-reply address";
  if (ourDomains.has(sender.split("@")[1] ?? "")) return "from one of our own domains";
  if (e.keywords?.$junk || (junkId && e.mailboxIds?.[junkId])) return "in Junk";
  return null;
}

function log(companyId: string, run: Record<string, unknown>): number {
  const r = db.prepare(`INSERT INTO ai_runs (company_id, address, message_id, email_id, thread_id, sender, subject, mode, status, reason, draft_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(companyId, run.address as string ?? null, run.messageId as string ?? null, run.emailId as string ?? null,
    run.threadId as string ?? null, run.sender as string ?? null, run.subject as string ?? null, run.mode as string ?? null,
    run.status as string, run.reason as string ?? null, run.draftId as string ?? null, now());
  return Number(r.lastInsertRowid);
}
function update(id: number, patch: Record<string, string | null>) {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE ai_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
}

// ---- the queue: two at a time, each message once per company ----
type Job = { rcpt: string; messageId: string };
const queue: Job[] = [];
let running = 0;

export function enqueue(job: Job): void {
  queue.push(job);
  pump();
}
function pump(): void {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    running++;
    handle(job).catch((e) => console.error("ai: job failed:", (e as Error).message)).finally(() => { running--; pump(); });
  }
}

/** Stalwart's webhook body: { events: [{ type, data: { to, from, messageId, ... } }] }. */
export function fromWebhook(body: unknown): number {
  const events = (body as { events?: { type?: string; data?: { to?: string[]; messageId?: string } }[] })?.events ?? [];
  let n = 0;
  for (const ev of events) {
    if (ev.type !== "message-ingest.ham" || !ev.data?.messageId) continue;
    for (const rcpt of ev.data.to ?? []) {
      const hit = companyForAddress(rcpt);
      if (hit && hit.address.aiMode !== "off") { enqueue({ rcpt: rcpt.toLowerCase(), messageId: ev.data.messageId }); n++; }
    }
  }
  return n;
}

function providerFor(companyId: string): Provider | null {
  const { providerId } = getProfile(companyId);
  return (providerId ? getProvider(providerId) : null) ?? defaultProvider();
}

/**
 * The message the webhook named. Stalwart's search does not index Message-ID,
 * so this reads the Message-IDs of the most recent arrivals and matches
 * exactly: a message that has just been delivered is always among them.
 */
async function findEmail(box: Mailbox, messageId: string): Promise<JEmail | null> {
  const id = messageId.replace(/^<|>$/g, "");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await box.request([
      ["Email/query", { sort: [{ property: "receivedAt", isAscending: false }], limit: 100 }, "q"],
      ["Email/get", { "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["id", "messageId"] }, "g"],
    ]);
    const hit = ((res[1][1].list ?? []) as { id: string; messageId?: string[] | null }[]).find((e) => e.messageId?.includes(id));
    if (hit) {
      const full = await box.call("Email/get", { ids: [hit.id], properties: EMAIL_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 60000 });
      return ((full.list ?? []) as JEmail[])[0] ?? null;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function threadContext(box: Mailbox, e: JEmail, ourEmails: Set<string>): Promise<ThreadMessage[]> {
  const res = await box.request([
    ["Thread/get", { ids: [e.threadId] }, "t"],
    ["Email/get", { "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" }, properties: ["id", "from", "subject", "sentAt", "receivedAt", "textBody", "htmlBody", "bodyValues", "keywords"], fetchTextBodyValues: true, maxBodyValueBytes: 8000 }, "g"],
  ]);
  return ((res[1][1].list ?? []) as JEmail[])
    .filter((m) => m.id !== e.id && !m.keywords?.$draft)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1))
    .map((m) => ({ from: fmt(m.from), date: m.sentAt ?? m.receivedAt, subject: m.subject ?? "", body: bodyText(m), ours: ourEmails.has(m.from?.[0]?.email?.toLowerCase() ?? "") }));
}

export async function writeReply(company: Company, address: CompanyAddress, e: JEmail, box: Mailbox, instruction?: string): Promise<ReplyAnswer & { model: string }> {
  const provider = providerFor(company.id);
  if (!provider) throw new AiError("No AI provider is set up yet (Settings, AI).");
  const { profile } = getProfile(company.id);
  const ours = new Set(company.addresses.map((a) => a.email.toLowerCase()));
  const thread = await threadContext(box, e, ours);
  const r = await complete(provider, {
    system: systemPrompt({ company: company.name, domain: company.domain, address: address.email, label: address.isPrimary ? "" : address.label, profile, instruction }),
    user: userPrompt(thread, { from: fmt(e.from), to: address.email, date: e.sentAt ?? e.receivedAt, subject: e.subject ?? "", body: bodyText(e), ours: false }),
    schema: REPLY_SCHEMA as unknown as Record<string, unknown>,
  });
  const a = r.data as Partial<ReplyAnswer>;
  const decision = a.decision === "reply" || a.decision === "escalate" || a.decision === "ignore" ? a.decision : "escalate";
  return { decision, reply: String(a.reply ?? "").trim(), reason: String(a.reason ?? "").trim().slice(0, 300), model: r.model };
}

function signed(reply: string, company: Company, signature: string): string {
  const sig = (signature || company.signature || "").trim();
  return sig ? `${reply.trim()}\n\n${sig}` : reply.trim();
}

/** The reply as a JMAP draft in the thread; returns its id. */
export async function saveDraft(box: Mailbox, company: Company, address: CompanyAddress, e: JEmail, text: string, keywords: Record<string, boolean>): Promise<string> {
  const boxes = (await box.call("Mailbox/get", { properties: ["role"] })).list as { id: string; role: string | null }[];
  const drafts = boxes.find((b) => b.role === "drafts")?.id;
  if (!drafts) throw new Error("the mailbox has no Drafts folder");
  const to = (e.replyTo?.length ? e.replyTo : e.from) ?? [];
  const subject = /^re:/i.test(e.subject ?? "") ? e.subject! : `Re: ${e.subject ?? ""}`.trim();
  const res = await box.call("Email/set", { create: { d: {
    mailboxIds: { [drafts]: true },
    keywords: { $draft: true, $seen: true, ...keywords },
    from: [{ name: company.name, email: address.email }],
    to,
    subject,
    ...(e.messageId?.length ? { inReplyTo: e.messageId, references: [...(e.references ?? []), ...e.messageId] } : {}),
    bodyValues: { t: { value: text }, h: { value: textToHtml(text) } },
    textBody: [{ partId: "t", type: "text/plain" }],
    htmlBody: [{ partId: "h", type: "text/html" }],
  } } });
  return (res.created as Record<string, { id: string }>).d.id;
}

/** Sends a saved draft from the address's identity, after delaySeconds (0 for now). */
export async function sendDraft(box: Mailbox, draftId: string, fromEmail: string, rcpts: string[], delaySeconds: number): Promise<void> {
  const ids = (await box.call("Identity/get", {})).list as { id: string; email: string }[];
  const identity = ids.find((i) => i.email.toLowerCase() === fromEmail.toLowerCase());
  if (!identity) throw new Error(`no sending identity for ${fromEmail}`);
  const boxes = (await box.call("Mailbox/get", { properties: ["role"] })).list as { id: string; role: string | null }[];
  const drafts = boxes.find((b) => b.role === "drafts")?.id;
  const sent = boxes.find((b) => b.role === "sent")?.id;
  await box.call("EmailSubmission/set", {
    create: { s: {
      identityId: identity.id, emailId: draftId,
      ...(delaySeconds > 0 ? { envelope: { mailFrom: { email: fromEmail, parameters: { HOLDFOR: String(delaySeconds) } }, rcptTo: rcpts.map((email) => ({ email })) } } : {}),
    } },
    onSuccessUpdateEmail: { "#s": { ...(drafts ? { [`mailboxIds/${drafts}`]: null } : {}), ...(sent ? { [`mailboxIds/${sent}`]: true } : {}), "keywords/$draft": null } },
  });
}

async function handle(job: Job): Promise<void> {
  const hit = companyForAddress(job.rcpt);
  if (!hit || hit.address.aiMode === "off") return;
  const { company, address } = hit;
  // Each message once per company, even when it was sent to two of its addresses.
  const exists = db.prepare("SELECT 1 FROM ai_runs WHERE company_id = ? AND message_id = ?").get(company.id, job.messageId);
  if (exists) return;
  const runId = log(company.id, { address: address.email, messageId: job.messageId, mode: address.aiMode, status: "working" });
  const box = new Mailbox(company.email);
  try {
    const e = await findEmail(box, job.messageId);
    if (!e) { update(runId, { status: "error", reason: "the message was not found in the mailbox" }); return; }
    update(runId, { email_id: e.id, thread_id: e.threadId, sender: e.from?.[0]?.email ?? null, subject: e.subject ?? null });

    const ourDomains = new Set([...listCompanies().map((c) => c.domain), config.mailDomain]);
    const boxes = (await box.call("Mailbox/get", { properties: ["role"] })).list as { id: string; role: string | null }[];
    const skip = skipReason(e, ourDomains, boxes.find((b) => b.role === "junk")?.id);
    if (skip) { update(runId, { status: "skipped", reason: skip }); return; }

    const answer = await writeReply(company, address, e, box);
    if (answer.decision === "ignore" || !answer.reply) {
      update(runId, { status: "skipped", reason: answer.reason || "no answer needed" });
      return;
    }
    const { profile } = getProfile(company.id);
    const text = signed(answer.reply, company, profile.signature);
    const sender = e.from?.[0]?.email?.toLowerCase() ?? "";
    const sentToday = (db.prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE company_id = ? AND lower(sender) = ? AND status = 'sent' AND created_at > ?")
      .get(company.id, sender, now() - 86_400_000) as { n: number }).n;

    let mode: "draft" | "send" = address.aiMode === "send" ? "send" : "draft";
    let why = answer.reason;
    if (mode === "send" && answer.decision === "escalate") { mode = "draft"; why = `needs a person: ${answer.reason}`; }
    if (mode === "send" && sentToday >= profile.maxAutoPerSenderPerDay) { mode = "draft"; why = `already answered this sender ${sentToday} times today`; }

    const draftId = await saveDraft(box, company, address, e, text, { $ai: true });
    if (mode === "draft") {
      await box.call("Email/set", { update: { [e.id]: { "keywords/$ai_draft": true } } });
      update(runId, { status: answer.decision === "escalate" ? "needs_person" : "drafted", reason: why, draft_id: draftId, mode });
      return;
    }
    const rcpts = ((e.replyTo?.length ? e.replyTo : e.from) ?? []).map((a) => a.email);
    await sendDraft(box, draftId, address.email, rcpts, profile.sendDelayMinutes * 60);
    await box.call("Email/set", { update: { [e.id]: { "keywords/$answered": true, "keywords/$ai_replied": true } } });
    update(runId, { status: "sent", reason: why, draft_id: draftId, mode });
  } catch (err) {
    update(runId, { status: "error", reason: (err as Error).message.slice(0, 300) });
  }
}

/** For the composer's "Write with AI": a reply to one message, not saved anywhere. */
export async function suggestReply(companyId: string, emailId: string, fromAddress: string | undefined, instruction: string | undefined): Promise<{ text: string; decision: string; reason: string; model: string }> {
  const company = getCompany(companyId);
  const box = new Mailbox(company.email);
  const res = await box.call("Email/get", { ids: [emailId], properties: EMAIL_PROPS, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 60000 });
  const e = (res.list as JEmail[])[0];
  if (!e) throw new AiError("That message is gone.");
  const to = new Set([...(e.to ?? []), ...(e.cc ?? [])].map((a) => a.email.toLowerCase()));
  const address = company.addresses.find((a) => a.email === fromAddress?.toLowerCase())
    ?? company.addresses.find((a) => to.has(a.email)) ?? company.addresses.find((a) => a.isPrimary)!;
  const a = await writeReply(company, address, e, box, instruction?.slice(0, 2000));
  const { profile } = getProfile(company.id);
  return { text: signed(a.reply || "", company, profile.signature), decision: a.decision, reason: a.reason, model: a.model };
}

export function listRuns(companyId?: string, limit = 100): Record<string, unknown>[] {
  return (companyId
    ? db.prepare("SELECT * FROM ai_runs WHERE company_id = ? ORDER BY created_at DESC LIMIT ?").all(companyId, limit)
    : db.prepare("SELECT * FROM ai_runs ORDER BY created_at DESC LIMIT ?").all(limit)) as Record<string, unknown>[];
}
