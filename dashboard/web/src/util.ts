import type { EmailAddress } from "./types";

export const displayName = (a?: EmailAddress | null) => (a ? (a.name?.trim() || a.email.split("@")[0]) : "Unknown");
export const firstName = (a?: EmailAddress | null) => displayName(a).split(/[\s,]+/)[0];

export function initials(s: string): string {
  const parts = s.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A stable, pleasant colour for a person, from their address. */
export function personColor(email: string): string {
  let h = 0;
  for (const c of email.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 46%)`;
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
  return d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relative(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** "Today", "Yesterday", "This week", "Earlier this month", then month names. */
export function dayGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This week";
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return "Earlier this month";
  return d.toLocaleDateString([], { month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function parseAddresses(s: string): EmailAddress[] {
  return s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(x);
    return m ? { name: m[1].replace(/^"|"$/g, "").trim() || null, email: m[2].trim() } : { email: x };
  });
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export const cls = (...x: (string | false | null | undefined)[]) => x.filter(Boolean).join(" ");

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";
