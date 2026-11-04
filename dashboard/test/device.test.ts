// Signing a phone in: a token of its own, listed and revocable, and the push
// registration behind the notifications. node --test, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xm-device-"));
process.env.DASHBOARD_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.MAIL_DOMAIN = "mail.xooteq.online";
process.env.VPS_IP = "203.0.113.7";
process.env.WEB_DIR = path.join(process.env.DATA_DIR, "no-web");

const { createOwner } = await import("../server/auth.ts");
const { buildApp } = await import("../server/app.ts");
const { db } = await import("../server/db.ts");

createOwner("owner@example.com", "a-long-password");
const app = await buildApp({ logger: false });
test.after(() => app.close());

const post = (url: string, payload: unknown, token?: string) => app.inject({
  method: "POST", url, payload: payload as object,
  headers: { "x-xooteq": "1", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});

async function signIn(device = "Pixel 9") {
  const res = await post("/api/auth/device", { email: "owner@example.com", password: "a-long-password", device });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body) as { token: string; owner: { email: string } };
}

test("a device signs in with the same password and gets a token of its own", async () => {
  const out = await signIn("Priya's iPhone");
  assert.equal(out.owner.email, "owner@example.com");
  assert.ok(out.token.length > 20);

  // That token stands in for the cookie everywhere the web app is signed in.
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${out.token}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(JSON.parse(me.body).owner.email, "owner@example.com");

  // The database keeps the hash, never the token itself.
  const rows = db.prepare("SELECT token_hash, kind, label FROM sessions WHERE kind = 'device'").all() as { token_hash: string; label: string }[];
  assert.ok(rows.some((r) => r.label === "Priya's iPhone"));
  assert.ok(!rows.some((r) => r.token_hash === out.token));
});

test("a wrong password gets nothing, and nonsense tokens get nowhere", async () => {
  const bad = await post("/api/auth/device", { email: "owner@example.com", password: "not-the-password", device: "x" });
  assert.equal(bad.statusCode, 401);
  const nobody = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer made-up" } });
  assert.equal(nobody.statusCode, 401);
  const nothing = await app.inject({ method: "GET", url: "/api/me" });
  assert.equal(nothing.statusCode, 401);
});

test("the devices signed in are listed, and one can be signed out from another", async () => {
  const phone = await signIn("A phone");
  const laptop = await signIn("A laptop");

  const list = await app.inject({ method: "GET", url: "/api/auth/devices", headers: { authorization: `Bearer ${laptop.token}` } });
  const devices = JSON.parse(list.body) as { id: string; label: string; current: boolean }[];
  const mine = devices.find((d) => d.current);
  assert.equal(mine?.label, "A laptop", "the device asking knows itself");
  const other = devices.find((d) => d.label === "A phone");
  assert.ok(other && !other.current);

  const gone = await app.inject({
    method: "DELETE", url: `/api/auth/devices/${other!.id}`,
    headers: { "x-xooteq": "1", authorization: `Bearer ${laptop.token}` },
  });
  assert.equal(gone.statusCode, 200);
  // The phone is signed out at once; the laptop is untouched.
  const after = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${phone.token}` } });
  assert.equal(after.statusCode, 401);
  const still = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${laptop.token}` } });
  assert.equal(still.statusCode, 200);
});

test("a phone registers where to reach it, and only a real push token", async () => {
  const phone = await signIn("Push phone");
  const ok = await post("/api/push/register", { token: "ExponentPushToken[abc123-xyz_456]", platform: "ios", label: "Push phone" }, phone.token);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(JSON.parse(ok.body).platform, "ios");

  const junk = await post("/api/push/register", { token: "not-a-token" }, phone.token);
  assert.equal(junk.statusCode, 400);

  // Registering the same phone again moves it rather than doubling it.
  await post("/api/push/register", { token: "ExponentPushToken[abc123-xyz_456]", platform: "ios", label: "Renamed" }, phone.token);
  const list = JSON.parse((await app.inject({ method: "GET", url: "/api/push/devices", headers: { authorization: `Bearer ${phone.token}` } })).body) as { label: string }[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.label, "Renamed");

  const off = await app.inject({
    method: "DELETE", url: "/api/push/register?token=" + encodeURIComponent("ExponentPushToken[abc123-xyz_456]"),
    headers: { "x-xooteq": "1", authorization: `Bearer ${phone.token}` },
  });
  assert.equal(off.statusCode, 200);
  assert.equal(JSON.parse((await app.inject({ method: "GET", url: "/api/push/devices", headers: { authorization: `Bearer ${phone.token}` } })).body).length, 0);
});

test("signing out takes the token with it", async () => {
  const phone = await signIn("Leaving");
  assert.equal((await post("/api/auth/logout", {}, phone.token)).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${phone.token}` } })).statusCode, 401);
});
