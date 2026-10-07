// Sign in, sign out, who am I, change my password.
import type { FastifyInstance } from "fastify";
import { assertReady, config, hosts } from "../config.ts";
import { cookieOf, login, loginAllowed, logout, requireOwner, setCookie, setPassword, verifyOwnerPassword } from "../auth.ts";
import { listCompanies } from "../companies.ts";

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
    logout(cookieOf(req));
    setCookie(reply, "", 0);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireOwner }, async (req) => ({
    owner: req.owner,
    companies: listCompanies().map((c) => ({ id: c.id, name: c.name, domain: c.domain, email: c.email, color: c.color, signature: c.signature,
      addresses: c.addresses.map((a) => ({ id: a.id, email: a.email, local: a.local, label: a.label, isPrimary: a.isPrimary, aiMode: a.aiMode })) })),
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
