// The inbox's line to each company's mailbox. The web app speaks JMAP (the
// standard mail protocol Stalwart serves) through here; the server adds the
// impersonated login, so the browser never holds mailbox credentials, and lets
// through only the mail methods an inbox needs.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireOwner } from "../auth.ts";
import { getCompany, InputError, listCompanies } from "../companies.ts";
import { Mailbox, MAIL_USING } from "../stalwart.ts";
import { cancelScheduled, scheduled, sendScheduledNow, suggestReply } from "../ai/engine.ts";

const ALLOWED = new RegExp("^(" + [
  "Core/echo",
  "Mailbox/(get|changes|query|queryChanges|set)",
  "Email/(get|changes|query|queryChanges|set|copy|import|parse)",
  "Thread/(get|changes)",
  "SearchSnippet/get",
  "Identity/(get|changes|set)",
  "EmailSubmission/(get|changes|query|queryChanges|set)",
  "Quota/(get|query)",
  "VacationResponse/get",
].join("|") + ")$");

// Inline is safe only for content a browser cannot run.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/i;

function companyOf(req: FastifyRequest) {
  return getCompany((req.params as { cid: string }).cid);
}

export async function mailRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/api/c/") || req.url === "/api/unread") await requireOwner(req, reply);
  });

  app.get("/api/c/:cid/session", async (req) => {
    const c = companyOf(req);
    const box = new Mailbox(c.email);
    return { accountId: await box.accountId(), email: c.email };
  });

  app.post("/api/c/:cid/jmap", async (req, reply) => {
    const c = companyOf(req);
    const body = req.body as { methodCalls?: unknown };
    const calls = Array.isArray(body?.methodCalls) ? body.methodCalls as [string, Record<string, unknown>, string][] : null;
    if (!calls || calls.length > 32) throw new InputError("Send up to 32 method calls.");
    for (const call of calls) {
      if (!Array.isArray(call) || typeof call[0] !== "string" || !ALLOWED.test(call[0])) {
        return reply.code(403).send({ error: `Not allowed here: ${Array.isArray(call) ? call[0] : "?"}` });
      }
    }
    const box = new Mailbox(c.email);
    return { methodResponses: await box.request(calls, MAIL_USING) };
  });

  app.post("/api/c/:cid/upload", async (req) => {
    const c = companyOf(req);
    const body = req.body;
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? ""));
    if (!bytes.length) throw new InputError("The file is empty.");
    return new Mailbox(c.email).upload(bytes, String(req.headers["content-type"] ?? "application/octet-stream"));
  });

  app.get("/api/c/:cid/blob/:blobId/:name", async (req, reply) => {
    const c = companyOf(req);
    const { blobId, name } = req.params as { blobId: string; name: string };
    const { type = "application/octet-stream", download } = req.query as { type?: string; download?: string };
    const res = await new Mailbox(c.email).download(blobId, name, type);
    if (!res.ok || !res.body) return reply.code(res.status === 404 ? 404 : 502).send({ error: "That file is not available." });
    const inline = !download && INLINE_TYPES.test(type);
    reply.header("content-type", inline ? type : "application/octet-stream");
    reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`);
    reply.header("cache-control", "private, max-age=86400");
    reply.header("content-security-policy", "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    const len = res.headers.get("content-length");
    if (len) reply.header("content-length", len);
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  // Live updates: Stalwart's push stream for the company, passed through.
  app.get("/api/c/:cid/events", async (req, reply) => {
    const c = companyOf(req);
    const ctl = new AbortController();
    req.raw.on("close", () => ctl.abort());
    const upstream = await new Mailbox(c.email).events(ctl.signal);
    if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: "Live updates are not available." });
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const reader = upstream.body.getReader();
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
    } catch {
      /* the browser went away, or the server did */
    } finally {
      clearInterval(ping);
      ctl.abort();
      reply.raw.end();
    }
  });

  // Unread mail per company, for the switcher's badges.
  app.get("/api/unread", async () => {
    const out: Record<string, { inbox: number; drafts: number; aiDrafts: number }> = {};
    await Promise.all(listCompanies().map(async (c) => {
      try {
        const box = new Mailbox(c.email);
        const res = await box.request([
          ["Mailbox/get", { properties: ["role", "unreadThreads", "totalEmails"] }, "m"],
          ["Email/query", { filter: { hasKeyword: "$ai_draft" }, limit: 1, calculateTotal: true }, "a"],
        ]);
        const list = (res[0][1].list ?? []) as { role: string | null; unreadThreads: number; totalEmails: number }[];
        out[c.id] = {
          inbox: list.find((m) => m.role === "inbox")?.unreadThreads ?? 0,
          drafts: list.find((m) => m.role === "drafts")?.totalEmails ?? 0,
          aiDrafts: Number(res[1][1].total ?? 0),
        };
      } catch {
        out[c.id] = { inbox: 0, drafts: 0, aiDrafts: 0 };
      }
    }));
    return out;
  });

  // AI replies waiting to be sent, and stopping or sending one.
  app.get("/api/c/:cid/ai/scheduled", async (req) => scheduled(companyOf(req).id));
  app.post("/api/c/:cid/ai/scheduled/:id/cancel", async (req) => {
    await cancelScheduled(companyOf(req).id, Number((req.params as { id: string }).id));
    return { ok: true };
  });
  app.post("/api/c/:cid/ai/scheduled/:id/send", async (req) => {
    await sendScheduledNow(companyOf(req).id, Number((req.params as { id: string }).id));
    return { ok: true };
  });

  app.post("/api/c/:cid/ai/suggest", async (req) => {
    const c = companyOf(req);
    const { emailId, from, instruction } = (req.body ?? {}) as { emailId?: string; from?: string; instruction?: string };
    if (!emailId) throw new InputError("Which message is this a reply to?");
    return suggestReply(c.id, emailId, from, instruction);
  });
}
