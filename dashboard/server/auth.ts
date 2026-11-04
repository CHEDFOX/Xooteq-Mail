// Logins to the dashboard (owners), and their sessions. A session is a random
// token the database keeps only the hash of: in an httpOnly cookie for the web
// app, or carried by the phone app as a bearer token (mobile/). A device's
// session is named, lasts a year while it is used, and is revoked on its own.
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.ts";
import { db, now } from "./db.ts";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto.ts";

export const COOKIE = "xm_session";
const TTL = 30 * 86_400_000;
/** A phone is not asked to sign in every month; using it keeps it signed in. */
const DEVICE_TTL = 365 * 86_400_000;

export type Device = { id: string; label: string; createdAt: number; lastSeen: number; current: boolean };

export type Owner = { id: number; email: string; name: string };

export function hasOwner(): boolean {
  return !!db.prepare("SELECT 1 FROM owners LIMIT 1").get();
}

export function createOwner(email: string, password: string, name = ""): Owner {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("That is not an email address.");
  if (password.length < 10) throw new Error("Use a password of at least 10 characters.");
  const r = db.prepare("INSERT INTO owners (email, name, pw_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET pw_hash = excluded.pw_hash")
    .run(e, name, hashPassword(password), now());
  return { id: Number(r.lastInsertRowid), email: e, name };
}

export function setPassword(ownerId: number, password: string): void {
  if (password.length < 10) throw new Error("Use a password of at least 10 characters.");
  db.prepare("UPDATE owners SET pw_hash = ? WHERE id = ?").run(hashPassword(password), ownerId);
  db.prepare("DELETE FROM sessions WHERE owner_id = ?").run(ownerId);
}

// Ten wrong passwords per address per quarter hour, then a pause.
const attempts = new Map<string, { n: number; until: number }>();
export function loginAllowed(ip: string): boolean {
  const a = attempts.get(ip);
  return !a || a.n < 10 || a.until < now();
}
function failed(ip: string) {
  const a = attempts.get(ip);
  if (!a || a.until < now()) attempts.set(ip, { n: 1, until: now() + 15 * 60_000 });
  else a.n++;
}

export function login(email: string, password: string, ip: string, agent: string): { token: string; owner: Owner } | null {
  const row = db.prepare("SELECT id, email, name, pw_hash FROM owners WHERE email = ?").get(String(email).trim().toLowerCase()) as (Owner & { pw_hash: string }) | undefined;
  // Hash even when the address is unknown, so timing does not tell which addresses exist.
  const ok = row ? verifyPassword(String(password), row.pw_hash) : (verifyPassword(String(password), hashPassword("x")), false);
  if (!row || !ok) { failed(ip); return null; }
  attempts.delete(ip);
  const token = randomToken();
  db.prepare("INSERT INTO sessions (token_hash, owner_id, created_at, expires_at, last_seen, ip, agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(sha256(token), row.id, now(), now() + TTL, now(), ip, agent.slice(0, 200));
  return { token, owner: { id: row.id, email: row.email, name: row.name } };
}

export function logout(token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** The token a phone app sends: Authorization: Bearer <token>. */
export function bearerOf(req: FastifyRequest): string | undefined {
  const raw = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1]!.trim() : undefined;
}

export function cookieOf(req: FastifyRequest): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setCookie(reply: FastifyReply, token: string, maxAgeMs = TTL): void {
  reply.header("set-cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${config.secureCookies ? "; Secure" : ""}`);
}

/** The owner behind the request's cookie or bearer token, sliding the session
 *  forward once a day so an app in daily use never asks for the password again. */
export function ownerOf(req: FastifyRequest): Owner | null {
  const token = cookieOf(req) ?? bearerOf(req);
  if (!token) return null;
  const hash = sha256(token);
  const s = db.prepare(`SELECT o.id, o.email, o.name, s.expires_at, s.last_seen, s.kind FROM sessions s JOIN owners o ON o.id = s.owner_id WHERE s.token_hash = ?`)
    .get(hash) as (Owner & { expires_at: number; last_seen: number; kind: string }) | undefined;
  if (!s || s.expires_at < now()) return null;
  if (now() - s.last_seen > 86_400_000) {
    db.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?")
      .run(now(), now() + (s.kind === "device" ? DEVICE_TTL : TTL), hash);
  }
  return { id: s.id, email: s.email, name: s.name };
}

/** Signs a device in: the same password, a token of its own that it keeps. */
export function signInDevice(email: string, password: string, label: string, ip: string, agent: string): { token: string; owner: Owner } | null {
  const res = login(email, password, ip, agent);
  if (!res) return null;
  db.prepare("UPDATE sessions SET kind = 'device', label = ?, expires_at = ? WHERE token_hash = ?")
    .run(String(label ?? "").trim().slice(0, 60) || "A device", now() + DEVICE_TTL, sha256(res.token));
  return res;
}

/** The devices signed in to this account, newest first. */
export function devices(ownerId: number, current?: string): Device[] {
  const rows = db.prepare(`SELECT token_hash, label, created_at, last_seen FROM sessions
    WHERE owner_id = ? AND kind = 'device' AND expires_at > ? ORDER BY last_seen DESC`)
    .all(ownerId, now()) as { token_hash: string; label: string; created_at: number; last_seen: number }[];
  const here = current ? sha256(current) : "";
  // The hash is the handle: it names the session without being able to sign in.
  return rows.map((r) => ({ id: r.token_hash, label: r.label, createdAt: r.created_at, lastSeen: r.last_seen, current: r.token_hash === here }));
}

/** Signs one device out, wherever it is. */
export function revokeDevice(ownerId: number, id: string): boolean {
  const r = db.prepare("DELETE FROM sessions WHERE owner_id = ? AND token_hash = ? AND kind = 'device'").run(ownerId, id);
  return Number(r.changes) > 0;
}

export function verifyOwnerPassword(ownerId: number, password: string): boolean {
  const row = db.prepare("SELECT pw_hash FROM owners WHERE id = ?").get(ownerId) as { pw_hash: string } | undefined;
  return !!row && verifyPassword(password, row.pw_hash);
}

/** Use in a route's preHandler: 401 unless a dashboard login is behind the request. */
export async function requireOwner(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const owner = ownerOf(req);
  if (!owner) {
    reply.code(401).send({ error: "Sign in again." });
    return;
  }
  req.owner = owner;
}
