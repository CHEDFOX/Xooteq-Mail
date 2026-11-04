// Turning what the server says into what a person reads: names, times, and the
// plain text behind a message's HTML.
import type { Email, EmailAddress } from "./types";

export const displayName = (a?: EmailAddress | null) => (a ? (a.name?.trim() || a.email.split("@")[0]!) : "Unknown");
export const firstName = (a?: EmailAddress | null) => displayName(a).split(/[\s,]+/)[0]!;

export function initials(s: string): string {
  const parts = s.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** List time: 14:05 today, Tue this week, 3 Oct this year, 3 Oct 2025 before. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (startOfDay(d) === startOfDay(now)) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (startOfDay(now) - startOfDay(d) < 6 * DAY) return d.toLocaleDateString([], { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: "numeric", month: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function longTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    weekday: "short", day: "numeric", month: "short",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function relative(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
}

export const bytes = (n?: number) =>
  !n ? "" : n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;

/** HTML as readable text: the app shows mail as text, so nothing can run. */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    // A removed tag can leave a space hanging at either end of a line.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A message's text: its plain part if it has one, else its HTML read as text. */
export function bodyText(e: Email): string {
  const values = e.bodyValues ?? {};
  const text = (e.textBody ?? []).map((p) => (p.partId ? values[p.partId]?.value ?? "" : "")).join("\n").trim();
  if (text) return text;
  const html = (e.htmlBody ?? []).map((p) => (p.partId ? values[p.partId]?.value ?? "" : "")).join("\n");
  return html ? stripHtml(html) : (e.preview ?? "");
}

/** What is left once the quoted history is cut off, for a reply's preview. */
export function withoutQuote(text: string): string {
  const cut = text.search(/^(>|On .+ wrote:|-{2,} ?Original Message|_{10,})/m);
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}

/** The quoted history under a reply, the way mail has always done it. */
export function quote(e: Email): string {
  const who = displayName(e.from?.[0]);
  const when = longTime(e.receivedAt);
  return `\n\nOn ${when}, ${who} wrote:\n` + bodyText(e).split("\n").map((l) => `> ${l}`).join("\n");
}

export const addressList = (list?: EmailAddress[] | null) => (list ?? []).map((a) => displayName(a)).join(", ");

/** "support@tailzu.space" → "support@", for the chips that filter by address. */
export const localOf = (email: string) => `${email.split("@")[0]}@`;

/** Reads what a person typed into a To field: names and addresses, any separator. */
export function parseAddresses(text: string): EmailAddress[] {
  return text
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.*?)<([^>]+)>$/.exec(part);
      return m ? { name: m[1]!.trim().replace(/^"|"$/g, ""), email: m[2]!.trim() } : { email: part };
    })
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
}
