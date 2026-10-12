// An app's Users tab. The parts that need no database always run; the rest run
// against a real Postgres when XM_TEST_PG names one (postgresql://user@host:port),
// with two databases on it: "sb", shaped like a Supabase project's auth schema,
// and "plain", an app's own members table: test/users-fixture.sql makes both.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xm-users-"));
process.env.DASHBOARD_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.MAIL_DOMAIN = "mail.example.online";
process.env.DASHBOARD_URL = "http://localhost";

const { connectionOptions, hintOf, guessMapping } = await import("../server/appUsers.ts");
const { db } = await import("../server/db.ts");
const { buildApp } = await import("../server/app.ts");
const { createOwner, login, COOKIE } = await import("../server/auth.ts");

test("sslmode is read the libpq way: require encrypts, verify-* verifies, local hosts are plain", () => {
  const ssl = (u: string) => connectionOptions(u).ssl;
  assert.deepEqual(ssl("postgresql://u:p@db.abc.supabase.co:5432/postgres"), { rejectUnauthorized: false });
  assert.deepEqual(ssl("postgresql://u:p@db.abc.supabase.co:5432/postgres?sslmode=require"), { rejectUnauthorized: false });
  assert.deepEqual(ssl("postgresql://u:p@db.example.com/x?sslmode=verify-full"), { rejectUnauthorized: true });
  assert.equal(ssl("postgresql://u:p@db.example.com/x?sslmode=disable"), false);
  assert.equal(ssl("postgresql://u:p@localhost:5432/x"), false);
  assert.equal(ssl("postgresql://u:p@10.0.0.4/x"), false);
  assert.equal(ssl("postgres://u:p@supabase-db/x"), false);
  // pg must not see sslmode itself: it would read "require" as verify-full.
  assert.doesNotMatch(String(connectionOptions("postgresql://u:p@h.example.com/x?sslmode=require").connectionString), /sslmode/);
  assert.throws(() => connectionOptions("mysql://u:p@h/x"), /Only Postgres/);
  assert.throws(() => connectionOptions("not a url"), /isn't a connection string/);
});

test("the hint names the database without its password", () => {
  assert.equal(hintOf("postgresql://postgres.abcd:s3cret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"),
    "postgres.abcd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres");
});

test("column names are guessed for each field", () => {
  assert.deepEqual(guessMapping("public", "members", ["member_id", "full_name", "email_address", "mobile", "joined_at", "last_seen_at"]),
    { schema: "public", table: "members", name: "full_name", email: "email_address", phone: "mobile", created: "joined_at", lastUsed: "last_seen_at" });
  const g = guessMapping("public", "users", ["id", "name", "email", "phone_number", "created_at", "updated_at"]);
  assert.equal(g.name, "name"); assert.equal(g.phone, "phone_number"); assert.equal(g.lastUsed, "updated_at");
});

const PG = process.env.XM_TEST_PG;
const url = (dbName: string, user?: string) => {
  const u = new URL(PG!);
  if (user) { u.username = user; u.password = ""; }
  u.pathname = `/${dbName}`;
  return u.toString();
};

test("against a real Postgres", { skip: !PG && "XM_TEST_PG not set" }, async (t) => {
  const app = await buildApp({ logger: false });
  createOwner("owner@example.online", "correct horse battery staple");
  const session = login("owner@example.online", "correct horse battery staple", "127.0.0.1", "test")!;
  const call = async (method: "GET" | "POST" | "PUT" | "DELETE", p: string, body?: unknown) => {
    const r = await app.inject({ method, url: p, headers: { cookie: `${COOKIE}=${session.token}`, "x-xooteq": "1" }, ...(body ? { payload: body as object } : {}) });
    return { status: r.statusCode, body: r.json() as any };
  };
  const at = "/api/sending/apps/tailzu/users";

  await t.test("nothing is connected at first, and the list says so", async () => {
    assert.deepEqual((await call("GET", `${at}/source`)).body, { connected: false });
    const r = await call("GET", at);
    assert.equal(r.status, 404);
    assert.match(r.body.error, /no database connected/);
  });

  await t.test("a Supabase project is recognised and its own tables listed, not the platform's", async () => {
    const r = await call("POST", `${at}/inspect`, { url: url("sb") });
    assert.equal(r.status, 200);
    assert.equal(r.body.supabase, true);
    const names = r.body.tables.map((x: { schema: string; table: string }) => `${x.schema}.${x.table}`);
    assert.ok(names.includes("public.profiles"));
    assert.ok(!names.some((n: string) => n.startsWith("storage.") || n.startsWith("auth.")));
  });

  await t.test("connecting reads auth.users: name, email or phone, created, last used", async () => {
    const c = await call("PUT", `${at}/source`, { url: url("sb"), kind: "supabase" });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.connected, true);
    assert.equal(c.body.users, 119);                 // one of the 120 is deleted
    assert.doesNotMatch(JSON.stringify(c.body), /postgresql:\/\//);
    const row = db.prepare("SELECT url_enc FROM app_user_sources WHERE app_id = 'tailzu'").get() as { url_enc: string };
    assert.doesNotMatch(row.url_enc, /postgres/);     // sealed at rest

    const r = await call("GET", at);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 119);
    assert.equal(r.body.counts.total, 119);
    assert.equal(r.body.counts.new30, 28);           // created 1..29 days ago (the 30th is just past the edge), minus the deleted 13th
    assert.equal(r.body.users.length, 50);
    assert.equal(r.body.totalPages, 3);
    const first = r.body.users[0];
    assert.equal(first.email, "user1@example.com");  // newest account first
    assert.equal(first.name, "Person 1");
    assert.equal(first.provider, "email");
    const byEmail = (e: string) => r.body.users.find((u: { email: string }) => u.email === e);
    assert.equal(byEmail("user3@example.com").name, "Name 3");
    assert.equal(byEmail("user4@example.com").name, null);
    assert.equal(byEmail("user3@example.com").provider, "google");
    assert.equal(r.body.users.find((u: { email: string }) => u.email === "user17@example.com").provider, "anonymous");
    const phoneOnly = r.body.users.find((u: { phone: string }) => u.phone === "919876500005");
    assert.equal(phoneOnly.email, null);
    assert.equal(phoneOnly.provider, "phone");
    assert.equal(r.body.users.find((u: { email: string }) => u.email === "user7@example.com").lastUsedAt, null);
    // A session refreshed an hour ago counts as using the app, though the last sign-in was two days ago.
    const u2 = Date.parse(byEmail("user2@example.com").lastUsedAt);
    assert.ok(Date.now() - u2 < 2 * 3600_000, `user2 last used ${new Date(u2).toISOString()}`);
    assert.ok(!r.body.users.some((u: { email: string }) => u.email === "user13@example.com"));
  });

  await t.test("search, sort and pages", async () => {
    const s = await call("GET", `${at}?q=user2`);
    assert.ok(s.body.users.length > 0);
    assert.ok(s.body.users.every((u: { email: string }) => u.email.includes("user2")));
    const p = await call("GET", `${at}?q=%2B91987650001`);   // "+91987650001", as a person would type it
    assert.deepEqual(p.body.users.map((u: { phone: string }) => u.phone).sort(), ["919876500010", "919876500015"]);
    const lit = await call("GET", `${at}?q=${encodeURIComponent("%")}`);
    assert.equal(lit.body.total, 0);                  // % is a character, not a wildcard
    const used = await call("GET", `${at}?sort=used`);
    const seen = used.body.users.map((u: { lastUsedAt: string | null }) => (u.lastUsedAt ? Date.parse(u.lastUsedAt) : -Infinity));
    assert.deepEqual(seen, [...seen].sort((a: number, b: number) => b - a));   // most recent first, never-used last
    assert.ok(used.body.users.slice(0, 12).some((u: { email: string }) => u.email === "user2@example.com"));
    // By what the row shows first: the name, else the email, else the phone.
    const named = await call("GET", `${at}?sort=name`);
    const keys = named.body.users.map((u: { name: string | null; email: string | null; phone: string | null }) => (u.name ?? u.email ?? u.phone ?? "").toLowerCase());
    assert.deepEqual(keys, [...keys].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
    const last = await call("GET", `${at}?page=3`);
    assert.equal(last.body.page, 3);
    assert.equal(last.body.users.length, 19);
    assert.equal((await call("GET", `${at}?page=99`)).body.page, 3);
  });

  await t.test("a login that can read only some columns still works", async () => {
    const c = await call("PUT", `${at}/source`, { url: url("sb", "reader"), kind: "supabase" });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const r = await call("GET", at);
    assert.equal(r.body.total, 120);                  // no deleted_at to read, so nothing is hidden
    assert.equal(r.body.users[0].provider, null);
    assert.equal(r.body.users[0].name, "Person 1");
  });

  await t.test("any table, mapped once: epoch-millisecond dates and all", async () => {
    const i = await call("POST", `${at}/inspect`, { url: url("plain") });
    assert.equal(i.body.supabase, false);
    const members = i.body.tables[0];
    assert.equal(members.table, "members");           // the likely table first
    assert.deepEqual(members.guess, { schema: "public", table: "members", name: "full_name", email: "email_address", phone: "mobile", created: "joined_at", lastUsed: "last_seen_at" });
    const c = await call("PUT", `${at}/source`, { url: url("plain", "plainreader"), kind: "table", mapping: members.guess });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal((await call("GET", `${at}/source`)).body.mapping.table, "members");
    const r = await call("GET", at);
    assert.equal(r.body.total, 30);
    const m1 = r.body.users[0];
    assert.equal(m1.name, "Member 1");
    assert.equal(m1.phone, "+44 7700 900001");
    // Epoch milliseconds read as dates: member n joined 3n days before the fixture was made.
    const m2 = r.body.users[1];
    assert.equal(m2.name, "Member 2");
    const gap = Date.parse(m1.createdAt) - Date.parse(m2.createdAt);
    assert.ok(Math.abs(gap - 3 * 86_400_000) < 2_000, `member 1 ${m1.createdAt}, member 2 ${m2.createdAt}`);
    assert.ok(Date.now() - Date.parse(m1.createdAt) >= 3 * 86_400_000 - 2_000);
  });

  await t.test("the saved connection can be re-mapped without pasting it again", async () => {
    const i = await call("POST", `${at}/inspect`, {});
    assert.equal(i.status, 200);
    const c = await call("PUT", `${at}/source`, { kind: "table", mapping: { schema: "public", table: "members", email: "email_address" } });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal((await call("GET", at)).body.users[0].name, null);
  });

  await t.test("a wrong mapping, a crafted table name, a dead host: each says what is wrong", async () => {
    const bad = await call("PUT", `${at}/source`, { kind: "table", mapping: { schema: "public", table: "members", email: "nope" } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /no column "nope"/);
    const crafted = await call("PUT", `${at}/source`, { kind: "table", mapping: { schema: "public", table: 'members"; drop table members; --', email: "email_address" } });
    assert.equal(crafted.status, 400);
    assert.match(crafted.body.error, /isn't there/);
    const none = await call("PUT", `${at}/source`, { kind: "table", mapping: { schema: "public", table: "members", name: "full_name" } });
    assert.match(none.body.error, /email or a phone/);
    const dead = await call("POST", `${at}/inspect`, { url: "postgresql://u:p@127.0.0.1:1/x" });
    assert.equal(dead.status, 400);
    assert.match(dead.body.error, /Nothing is listening/);
    // The failed attempts left the working connection in place.
    assert.equal((await call("GET", at)).body.total, 30);
  });

  await t.test("deleting the connection, and an app id that isn't one", async () => {
    assert.equal((await call("DELETE", `${at}/source`)).status, 200);
    assert.deepEqual((await call("GET", `${at}/source`)).body, { connected: false });
    assert.equal((await call("GET", "/api/sending/apps/NOT_OK/users/source")).status, 404);
  });

  await t.test("a company has its own Users tab, apart from an app with the same id", async () => {
    db.prepare(`INSERT INTO companies (id, name, domain, local, account_id, color, created_at)
      VALUES ('tailzu', 'Tailzu', 'tailzu.space', 'hello', 'acc1', '#119977', 0)`).run();
    const co = "/api/companies/tailzu/users";
    assert.deepEqual((await call("GET", `${co}/source`)).body, { connected: false });
    const c = await call("PUT", `${co}/source`, { url: url("sb"), kind: "supabase" });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal((await call("GET", co)).body.total, 119);
    assert.deepEqual((await call("GET", `${at}/source`)).body, { connected: false });   // the Sending app "tailzu" is untouched
    const none = await call("GET", "/api/companies/nobody/users/source");
    assert.equal(none.status, 400);
    assert.match(none.body.error, /No such company/);
  });

  await app.close();
});
