// Contact forms: what a form may say, and the sites.json the forms service
// reads. The rows are put in the database directly, so neither Postal nor
// Stalwart is needed: node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xm-forms-"));
process.env.DATA_DIR = dir;
process.env.DASHBOARD_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.MAIL_DOMAIN = "mail.xooteq.online";
process.env.VPS_IP = "203.0.113.7";
process.env.FORMS_SITES_FILE = path.join(dir, "forms", "sites.json");

const { db, now } = await import("../server/db.ts");
const { seal } = await import("../server/crypto.ts");
const { config } = await import("../server/config.ts");
const forms = await import("../server/forms.ts");
const { InputError } = await import("../server/companies.ts");

function company(id: string, domain: string): number {
  db.prepare("INSERT INTO companies (id, name, domain, local, account_id, color, position, created_at) VALUES (?, ?, ?, 'hello', 'a1', '#E8A23C', 0, ?)")
    .run(id, id === "tailzu" ? "Tailzu" : id, domain, now());
  db.prepare("INSERT INTO addresses (company_id, local, label, is_primary, created_at) VALUES (?, 'hello', '', 1, ?)").run(id, now());
  const r = db.prepare("INSERT INTO addresses (company_id, local, label, is_primary, display_name, created_at) VALUES (?, 'contact', 'Contact', 0, 'Support', ?)")
    .run(id, now());
  return Number(r.lastInsertRowid);
}

function form(companyId: string, addressId: number, over: Record<string, unknown> = {}): number {
  const row = {
    name: "Contact page", key: "tailzu_abc123xyz", app_id: "tailzu", app_name: "Tailzu",
    subject: "Message from {name}", origins: JSON.stringify(["https://tailzu.space"]), redirect: "",
    autoreply: null as string | null, per_minute: 5, per_day: 200, enabled: 1, ...over,
  };
  const r = db.prepare(
    `INSERT INTO forms (company_id, address_id, name, key, app_id, app_name, key_enc, key_hint, subject, origins,
       redirect, autoreply, per_minute, per_day, admin_token, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '…f00d', ?, ?, ?, ?, ?, ?, 'token-123', ?, ?, ?)`,
  ).run(companyId, addressId, row.name, row.key, row.app_id, row.app_name, seal("postal-api-key"), row.subject,
    row.origins, row.redirect, row.autoreply, row.per_minute, row.per_day, row.enabled, now(), now());
  return Number(r.lastInsertRowid);
}

const read = () => JSON.parse(fs.readFileSync(config.formsSitesFile, "utf8")) as { sites: Record<string, Record<string, unknown>> };

test("a site address is read as an origin, with or without the scheme", () => {
  assert.deepEqual(forms.cleanOrigins("tailzu.space, https://www.tailzu.space/"), ["https://tailzu.space", "https://www.tailzu.space"]);
  assert.deepEqual(forms.cleanOrigins(["https://tailzu.space", "https://tailzu.space"]), ["https://tailzu.space"]);
  assert.equal(forms.cleanOrigin("*.tailzu.space"), "*.tailzu.space");
  assert.equal(forms.cleanOrigin("http://localhost:5173"), "http://localhost:5173");
  assert.deepEqual(forms.cleanOrigins(""), []);
  assert.throws(() => forms.cleanOrigin("not a site"), InputError);
  assert.throws(() => forms.cleanOrigin("*.space"), InputError);
});

test("the service's sites.json is written from the forms, and keeps hand-written sites", () => {
  const addressId = company("tailzu", "tailzu.space");
  fs.mkdirSync(path.dirname(config.formsSitesFile), { recursive: true });
  fs.writeFileSync(config.formsSitesFile, JSON.stringify({
    sites: {
      byHand: { key: "k_byhand", to: ["someone@example.com"], from: "A <a@b.test>", postal_key: "x" },
      stale: { key: "k_old", to: ["old@example.com"], from: "Old <o@b.test>", postal_key: "x", managed_by: "xooteq-mail" },
    },
  }));

  const id = form("tailzu", addressId);
  forms.writeSites();
  const { sites } = read();

  // The site put there by hand stays; a form the dashboard no longer has is gone.
  assert.ok(sites.byHand, "the hand-written site is kept");
  assert.equal(sites.stale, undefined, "a managed site with no form behind it is dropped");

  const site = sites[`tailzu-${id}`];
  assert.ok(site, "the form has an entry of its own");
  assert.equal(site.key, "tailzu_abc123xyz");
  assert.deepEqual(site.to, ["contact@tailzu.space"]);
  // The address's own sender name, and its address, so a reply to the sender works too.
  assert.equal(site.from, "Support <contact@tailzu.space>");
  assert.equal(site.postal_key, "postal-api-key", "the key is unsealed for the service");
  assert.deepEqual(site.origins, ["https://tailzu.space"]);
  assert.deepEqual(site.limits, { perMinute: 5, perDay: 200 });
  assert.equal(site.admin_token, "token-123");
  assert.equal(site.managed_by, "xooteq-mail");
  assert.equal(site.redirect, undefined, "no redirect means the service shows its own page");
  assert.equal(site.autoreply, undefined);
});

test("a form that is off is not in the file at all", () => {
  const addressId = company("plutto", "plutto.space");
  const id = form("plutto", addressId, { key: "plutto_k1", enabled: 0 });
  forms.writeSites();
  assert.equal(read().sites[`plutto-${id}`], undefined);
  db.prepare("UPDATE forms SET enabled = 1 WHERE id = ?").run(id);
  forms.writeSites();
  assert.ok(read().sites[`plutto-${id}`]);
});

test("the auto-reply and the redirect reach the file as the service wants them", async () => {
  const addressId = company("okro", "okro.test");
  const id = form("okro", addressId, { key: "okro_k1" });
  await forms.updateForm("okro", id, {
    redirect: "https://okro.test/thanks",
    autoreply: { subject: "We got it, {name}", text: "Thanks for writing." },
  });
  const site = read().sites[`okro-${id}`]!;
  assert.equal(site.redirect, "https://okro.test/thanks");
  assert.deepEqual(site.autoreply, { subject: "We got it, {name}", text: "Thanks for writing.", from: "Support <contact@okro.test>" });
});

test("a form keeps its old settings when a new one is refused", async () => {
  const addressId = company("qu", "qu.test");
  const id = form("qu", addressId, { key: "qu_k1" });
  await assert.rejects(() => forms.updateForm("qu", id, { redirect: "http://qu.test/thanks" }), InputError);
  await assert.rejects(() => forms.updateForm("qu", id, { origins: ["nonsense"] }), InputError);
  await assert.rejects(() => forms.updateForm("qu", id, { autoreply: { subject: "Hi", text: "  " } }), InputError);
  const f = forms.getForm("qu", id);
  assert.equal(f.redirect, "");
  assert.deepEqual(f.origins, ["https://tailzu.space"]);
  assert.equal(f.autoreply, null);
});

test("limits stay inside what the service can hold", async () => {
  const addressId = company("li", "li.test");
  const id = form("li", addressId, { key: "li_k1" });
  assert.deepEqual((await forms.updateForm("li", id, { limits: { perMinute: 12, perDay: 500 } })).limits, { perMinute: 12, perDay: 500 });
  // Too big is capped; nothing sensible falls back to the usual limit.
  const f = await forms.updateForm("li", id, { limits: { perMinute: 0, perDay: 9_999_999 } });
  assert.deepEqual(f.limits, { perMinute: 5, perDay: 20_000 });
});

test("removing a form takes its site with it", () => {
  const addressId = company("rm", "rm.test");
  const id = form("rm", addressId, { key: "rm_k1" });
  forms.writeSites();
  assert.ok(read().sites[`rm-${id}`]);
  forms.deleteForm("rm", id);
  assert.equal(read().sites[`rm-${id}`], undefined);
  assert.throws(() => forms.getForm("rm", id), InputError);
});

test("an unchanged file is left alone, so the service does not reload for nothing", () => {
  const addressId = company("same", "same.test");
  form("same", addressId, { key: "same_k1" });
  forms.writeSites();
  const before = fs.statSync(config.formsSitesFile).ino;
  forms.writeSites();
  // A write puts a new file in place, so the same inode means nothing was written.
  assert.equal(fs.statSync(config.formsSitesFile).ino, before);
  db.prepare("UPDATE forms SET name = 'Renamed', subject = 'New subject' WHERE key = 'same_k1'").run();
  forms.writeSites();
  assert.notEqual(fs.statSync(config.formsSitesFile).ino, before);
});

test("an address that goes takes its forms' endpoints with it", () => {
  const addressId = company("gone", "gone.test");
  const id = form("gone", addressId, { key: "gone_k1" });
  forms.writeSites();
  assert.ok(read().sites[`gone-${id}`]);
  // What removing the address does in the database (the row cascades).
  db.prepare("DELETE FROM addresses WHERE id = ?").run(addressId);
  forms.syncSites();
  assert.equal(read().sites[`gone-${id}`], undefined);
});

test("the form's address is the one a site posts to", () => {
  const addressId = company("ep", "ep.test");
  const id = form("ep", addressId, { key: "ep_k1" });
  assert.equal(forms.getForm("ep", id).endpoint, "https://forms.xooteq.online/s/ep_k1");
  assert.equal(forms.listForms("ep").length, 1);
});
