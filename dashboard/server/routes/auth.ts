// Sign in, sign out, who am I, change my password.
import type { FastifyInstance } from "fastify";
import { assertReady, config, hosts } from "../config.ts";
import { cookieOf, devices, login, loginAllowed, logout, requireOwner, revokeDevice, setCookie, setPassword, signInDevice, verifyOwnerPassword, bearerOf } from "../auth.ts";
import { listCompanies } from "../companies.ts";
import { forgetPush, listPush, registerPush } from "../push.ts";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    const ip = req.ip;
    if (!loginAllowed(ip)) return reply.code(429).send({ error: "Too many tries. Wait a quarter of an hour." });
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const res = login(String(email ?? ""), String(password ?? ""), ip, String(req.headers["user-agent"] ?? ""));
    if (!res) return reply.code(401).send({ error: "That email and password do not match." });
    setCookie(reply, res.token);
    return { owner: res.owner };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    logout(cookieOf(req) ?? bearerOf(req));
    setCookie(reply, "", 0);
    return { ok: true };
  });

  // The phone app (mobile/): the same password, a token of its own that it
  // keeps in the device's secure storage and sends as a bearer token.
  app.post("/api/auth/device", async (req, reply) => {
    const ip = req.ip;
    if (!loginAllowed(ip)) return reply.code(429).send({ error: "Too many tries. Wait a quarter of an hour." });
    const { email, password, device } = (req.body ?? {}) as { email?: string; password?: string; device?: string };
    const res = signInDevice(String(email ?? ""), String(password ?? ""), String(device ?? ""), ip, String(req.headers["user-agent"] ?? ""));
    if (!res) return reply.code(401).send({ error: "That email and password do not match." });
    return { token: res.token, owner: res.owner };
  });

  app.get("/api/auth/devices", { preHandler: requireOwner }, async (req) =>
    devices(req.owner!.id, cookieOf(req) ?? bearerOf(req)));

  app.delete("/api/auth/devices/:id", { preHandler: requireOwner }, async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    if (!revokeDevice(req.owner!.id, id)) return reply.code(404).send({ error: "No such device." });
    return { ok: true };
  });

  // Where to reach a phone with a notification when mail arrives (push.ts).
  app.post("/api/push/register", { preHandler: requireOwner }, async (req, reply) => {
    const body = (req.body ?? {}) as { token: unknown; platform?: unknown; label?: unknown };
    try {
      return registerPush(req.owner!.id, { ...body, session: cookieOf(req) ?? bearerOf(req) });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/api/push/devices", { preHandler: requireOwner }, async (req) => listPush(req.owner!.id));

  app.delete("/api/push/register", { preHandler: requireOwner }, async (req) => {
    forgetPush(req.owner!.id, (req.query as { token?: string }).token);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireOwner }, async (req) => ({
    owner: req.owner,
    companies: listCompanies().map((c) => ({ id: c.id, name: c.name, domain: c.domain, email: c.email, color: c.color, signature: c.signature,
      addresses: c.addresses.map((a) => ({ id: a.id, email: a.email, local: a.local, label: a.label, isPrimary: a.isPrimary, aiMode: a.aiMode, displayName: a.displayName })) })),
    mailDomain: config.mailDomain,
    hosts,
    setupMissing: assertReady(),
  }));

  app.post("/api/me/password", { preHandler: requireOwner }, async (req, reply) => {
    const { current, next } = (req.body ?? {}) as { current?: string; next?: string };
    if (!verifyOwnerPassword(req.owner!.id, String(current ?? ""))) return reply.code(400).send({ error: "The current password is not right." });
    try {
      setPassword(req.owner!.id, String(next ?? ""));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    setCookie(reply, "", 0);
    return { ok: true, signedOut: true };
  });
}
