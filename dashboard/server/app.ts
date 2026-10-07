// The HTTP server: the web app, its API, and the webhook from Stalwart.
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.ts";
import type { Owner } from "./auth.ts";
import { InputError } from "./companies.ts";
import { StalwartError } from "./stalwart.ts";
import { AiError } from "./ai/providers.ts";
import { authRoutes } from "./routes/auth.ts";
import { mailRoutes } from "./routes/mail.ts";
import { adminRoutes } from "./routes/admin.ts";
import { aiRoutes } from "./routes/ai.ts";
import { hookRoutes } from "./routes/hooks.ts";

declare module "fastify" {
  interface FastifyRequest {
    owner?: Owner;
    rawBody?: Buffer;
  }
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 4 * 1024 * 1024 });

  // JSON with the raw bytes kept (the webhook's signature is over them).
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {});
    } catch {
      const err = new Error("The request body is not valid JSON.") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  // Anything else (attachments on their way up) arrives as bytes.
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    if (!reply.getHeader("content-security-policy")) {
      reply.header("content-security-policy", [
        "default-src 'self'",
        "script-src 'self'",
        // Messages carry inline styles; their remote images load only when asked.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https: http:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'self' about: blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "));
    }
    return payload;
  });

  // Every state-changing API call carries this header, which a cross-site form
  // cannot add: with SameSite cookies, that closes cross-site request forgery.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-xooteq"] !== "1") {
      reply.code(403).send({ error: "Missing request header." });
    }
  });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof InputError || err instanceof AiError) {
      reply.code(err instanceof AiError && err.status && err.status >= 500 ? 502 : 400).send({ error: err.message });
      return;
    }
    if (err instanceof StalwartError) {
      req.log.warn({ detail: err.detail }, `stalwart: ${err.message}`);
      reply.code(err.status === 401 ? 502 : err.status && err.status >= 400 && err.status < 500 ? 400 : 502).send({ error: err.message });
      return;
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      reply.code(status).send({ error: err.message });
      return;
    }
    req.log.error(err);
    reply.code(500).send({ error: "Something went wrong on the server." });
  });

  app.get("/healthz", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(mailRoutes);
  await app.register(adminRoutes);
  await app.register(aiRoutes);
  await app.register(hookRoutes);

  // The web app: hashed assets cached for a year, index.html never.
  const web = config.webDir;
  if (fs.existsSync(path.join(web, "index.html"))) {
    await app.register(fastifyStatic, {
      root: web,
      prefix: "/",
      index: false,
      wildcard: false,
      // @fastify/static 10 hands this Fastify's reply (older versions: the raw response).
      setHeaders: (res, file) => {
        const value = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
        const r = res as unknown as { header?: (k: string, v: string) => void; setHeader?: (k: string, v: string) => void };
        if (typeof r.header === "function") r.header("cache-control", value);
        else r.setHeader?.("cache-control", value);
      },
    });
    const index = fs.readFileSync(path.join(web, "index.html"));
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/hooks/") && !req.url.startsWith("/assets/")) {
        reply.header("cache-control", "no-cache").type("text/html; charset=utf-8").send(index);
        return;
      }
      reply.code(404).send({ error: "Not found." });
    });
  }
  return app;
}
