// Notifications to the phone app (mobile/). Each phone registers the push token
// Expo gives it against its own device session; when Stalwart tells us mail has
// arrived (routes/hooks.ts), every registered phone is told which company and
// which address it came to.
//
// Expo's push service does the talking to Apple and Google, so the server needs
// no certificates of its own. A token Expo reports as dead is forgotten.
import { db, now } from "./db.ts";
import { sha256 } from "./crypto.ts";
import { companyForAddress } from "./companies.ts";

const EXPO_PUSH = process.env.EXPO_PUSH_URL || "https://exp.host/--/api/v2/push/send";
/** An Expo token looks like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]. */
const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export type PushDevice = { id: number; platform: string; label: string; lastSeen: number };

/** The phone says where to reach it; one row per token, moved to whoever signs in. */
export function registerPush(ownerId: number, input: { token: unknown; platform?: unknown; label?: unknown; session?: string }): PushDevice {
  const token = String(input.token ?? "").trim();
  if (!TOKEN_RE.test(token)) throw new Error("That is not an Expo push token.");
  const platform = String(input.platform ?? "").toLowerCase() === "android" ? "android" : "ios";
  const label = String(input.label ?? "").trim().slice(0, 60);
  db.prepare(`INSERT INTO push_devices (owner_id, token, platform, label, session_hash, created_at, last_seen)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(token) DO UPDATE SET owner_id = excluded.owner_id, platform = excluded.platform,
                label = excluded.label, session_hash = excluded.session_hash, last_seen = excluded.last_seen`)
    .run(ownerId, token, platform, label, input.session ? sha256(input.session) : null, now(), now());
  const row = db.prepare("SELECT id, platform, label, last_seen FROM push_devices WHERE token = ?").get(token) as
    { id: number; platform: string; label: string; last_seen: number };
  return { id: row.id, platform: row.platform, label: row.label, lastSeen: row.last_seen };
}

/** The phone is signing out, or turning notifications off. */
export function forgetPush(ownerId: number, token: unknown): void {
  db.prepare("DELETE FROM push_devices WHERE owner_id = ? AND token = ?").run(ownerId, String(token ?? ""));
}

export function listPush(ownerId: number): PushDevice[] {
  return (db.prepare("SELECT id, platform, label, last_seen FROM push_devices WHERE owner_id = ? ORDER BY last_seen DESC").all(ownerId) as
    { id: number; platform: string; label: string; last_seen: number }[])
    .map((r) => ({ id: r.id, platform: r.platform, label: r.label, lastSeen: r.last_seen }));
}

type Message = { to: string; title: string; body: string; data?: Record<string, unknown>; sound?: string; badge?: number };

/** Hands the messages to Expo, and forgets the tokens it says are gone. */
async function send(messages: Message[]): Promise<number> {
  if (!messages.length) return 0;
  let sent = 0;
  // Expo takes up to a hundred at a time.
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(15_000),
      });
      const out = await res.json().catch(() => null) as { data?: { status: string; details?: { error?: string } }[] } | null;
      (out?.data ?? []).forEach((r, n) => {
        if (r.status === "ok") { sent++; return; }
        if (r.details?.error === "DeviceNotRegistered") {
          db.prepare("DELETE FROM push_devices WHERE token = ?").run(batch[n]!.to);
        }
      });
    } catch (e) {
      console.warn(`[push] not sent: ${(e as Error).message}`);
    }
  }
  return sent;
}

/** Stalwart's webhook, as a notification on every phone signed in here. */
export async function notifyNewMail(body: unknown): Promise<number> {
  const events = (body as { events?: { type?: string; data?: { to?: string[]; messageId?: string } }[] })?.events ?? [];
  // Every owner sees every company here, so every signed-in phone hears about
  // mail to any of them — the same mail the app would show them anyway.
  const tokens = (db.prepare("SELECT token FROM push_devices").all() as { token: string }[]).map((r) => r.token);
  if (!tokens.length) return 0;

  const messages: Message[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "message-ingest.ham") continue;
    for (const rcpt of ev.data?.to ?? []) {
      const address = rcpt.toLowerCase();
      if (seen.has(address)) continue;
      seen.add(address);
      const hit = companyForAddress(address);
      if (!hit) continue;
      for (const token of tokens) {
        messages.push({
          to: token,
          title: hit.company.name,
          // Stalwart's webhook names the recipient, not the sender, so the
          // notification says where it landed; the app shows the rest.
          body: `New mail for ${address}`,
          sound: "default",
          data: { kind: "mail", companyId: hit.company.id, address },
        });
      }
    }
  }
  return send(messages);
}
