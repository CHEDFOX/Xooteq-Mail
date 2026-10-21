// Everything the dashboard reads from its environment, checked once at start.
// docker-compose.yml passes these from the platform's .env.
import path from "node:path";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set (the platform's .env, see workspace-setup.sh)`);
}

/** mail.xooteq.online -> xooteq.online: the domain the platform's own names hang off. */
const parentDomain = (d: string) => (d.split(".").length > 2 ? d.split(".").slice(1).join(".") : d);

const mailDomain = env("MAIL_DOMAIN", "mail.example.com");

export const config = {
  port: Number(env("PORT", "5200")),
  /** Stalwart's HTTP listener: JMAP for mail and for its own settings. */
  stalwartUrl: env("STALWART_URL", "http://127.0.0.1:8080").replace(/\/+$/, ""),
  /** The admin login engine.py bootstrap made; it can impersonate any account. */
  stalwartAdminUser: env("STALWART_ADMIN_USER", ""),
  stalwartAdminSecret: env("STALWART_ADMIN_SECRET", ""),
  /** Stalwart signs the new-mail webhook with this (engine.py configure). */
  webhookSecret: env("WEBHOOK_SECRET", ""),
  /** Session signing and the key that encrypts stored AI keys. Never rotate casually. */
  secret: env("DASHBOARD_SECRET", ""),
  publicUrl: env("DASHBOARD_URL", `https://${mailDomain}`).replace(/\/+$/, ""),
  /** The platform domain: mx.<it> receives, smtp.<it> sends, spf.<it> lists the IP. */
  mailDomain,
  vpsIp: env("VPS_IP", ""),
  dataDir: env("DATA_DIR", path.resolve("data")),
  /** postal-bridge, Postal's side of the dashboard (Sending), on the private network. */
  postalBridgeUrl: env("POSTAL_BRIDGE_URL", "http://postal-bridge:5010").replace(/\/+$/, ""),
  postalBridgeSecret: env("POSTAL_BRIDGE_SECRET", ""),
  /** The contact-form service (forms/): the sites file the dashboard writes and
   *  it re-reads, where it answers on the private network, and the address the
   *  sites' forms post to (forms.<company domain>, the one nginx serves). */
  formsSitesFile: env("FORMS_SITES_FILE", ""),
  formsUrl: env("FORMS_URL", "http://forms:5100").replace(/\/+$/, ""),
  formsPublicUrl: env("FORMS_PUBLIC_URL", `https://forms.${parentDomain(mailDomain)}`).replace(/\/+$/, ""),
  /** Built web app (vite build); absent in development, where vite serves it. */
  webDir: env("WEB_DIR", path.resolve("web/dist")),
  /** Cookies get Secure unless explicitly running on plain http (development). */
  secureCookies: env("DASHBOARD_URL", `https://${mailDomain}`).startsWith("https://"),
};

export function assertReady(): string[] {
  const missing: string[] = [];
  if (!config.stalwartAdminUser || !config.stalwartAdminSecret) missing.push("STALWART_ADMIN_USER / STALWART_ADMIN_SECRET");
  if (config.secret.length < 32) missing.push("DASHBOARD_SECRET (32+ characters)");
  if (!config.webhookSecret) missing.push("WEBHOOK_SECRET");
  return missing;
}

/** The hosts mail apps and DNS records point at. */
export const hosts = {
  mx: `mx.${mailDomain}`,
  smtp: `smtp.${mailDomain}`,
  imap: `mx.${mailDomain}`,
  spfInclude: `spf.${mailDomain}`,
};
