// Passwords, session tokens, the webhook signature, and the encryption of the
// AI keys at rest. Node's crypto only.
import crypto from "node:crypto";
import { config } from "./config.ts";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt$N$r$p$salt$hash, all base64url. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize("NFKC"), salt, 32, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = crypto.scryptSync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, got);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("base64url");

/** A password for a mailbox nobody types (the dashboard impersonates it). */
export function mailboxPassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Stalwart's webhook header: base64 HMAC-SHA256 of the raw body. */
export function verifyWebhook(body: Buffer, signature: string | undefined): boolean {
  if (!signature || !config.webhookSecret) return false;
  const expected = crypto.createHmac("sha256", config.webhookSecret).update(body).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// AI keys: AES-256-GCM under a key derived from DASHBOARD_SECRET. The database
// alone does not reveal them; the database plus the .env does.
function aesKey(): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", config.secret, "xooteq-mail", "ai-keys", 32));
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1") throw new Error("unknown key format");
  const d = crypto.createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

/** The last four characters, for showing which key is stored without showing it. */
export const keyHint = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : "…");
