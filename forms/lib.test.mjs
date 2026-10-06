import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBody, renderEmail, fill, isEmail, checkOrigin, RateLimit } from "./lib.mjs";

test("reads a form however it was sent", () => {
  assert.deepEqual(parseBody("application/x-www-form-urlencoded", Buffer.from("name=Priya&message=Hi+there%21")), { name: "Priya", message: "Hi there!" });
  assert.deepEqual(parseBody("application/json; charset=utf-8", Buffer.from('{"name":"Priya","n":3,"tags":["a"]}')), { name: "Priya", n: "3", tags: '["a"]' });
  const b = "xyz";
  const mp = `--${b}\r\nContent-Disposition: form-data; name="name"\r\n\r\nPriya Ünal\r\n--${b}\r\nContent-Disposition: form-data; name="cv"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF\r\n--${b}--\r\n`;
  assert.deepEqual(parseBody(`multipart/form-data; boundary=${b}`, Buffer.from(mp, "utf8")), { name: "Priya Ünal" });
  assert.deepEqual(parseBody("application/json", Buffer.from("not json")), {});
});

test("fills a subject from the fields, safely", () => {
  assert.equal(fill("Message from {name} about {topic}", { name: "Priya\nX" }), "Message from Priya X about ");
  assert.equal(isEmail("a@b.co"), true);
  assert.equal(isEmail("nope"), false);
});

test("renders the email with every field escaped", () => {
  const { text, html } = renderEmail({ name: "tailzu" }, { fields: { name: "<b>Priya</b>", message: "line one\nline two" }, page: "https://tailzu.space/contact", at: "2026-10-06T12:00:00.000Z", ip: "1.2.3.4" }, "priya@example.com");
  assert.match(text, /Name: <b>Priya<\/b>\nMessage:\n  line one\n  line two/);
  assert.match(html, /&lt;b&gt;Priya&lt;\/b&gt;/);
  assert.match(html, /Reply to this email to answer priya@example.com/);
});

test("lets a site's own pages post, and nobody else's", () => {
  const site = { origins: ["https://tailzu.space", "*.xooteq.online"] };
  assert.equal(checkOrigin(site, "https://tailzu.space", null), true);
  assert.equal(checkOrigin(site, null, "https://tailzu.space/contact?x=1"), true);
  assert.equal(checkOrigin(site, "https://app.xooteq.online", null), true);
  assert.equal(checkOrigin(site, "https://evil.example", null), false);
  assert.equal(checkOrigin(site, null, null), false);
  assert.equal(checkOrigin({ origins: [] }, null, null), true);
});

test("slows one address down and caps a site's day", () => {
  let t = 0;
  const rl = new RateLimit(() => t);
  const site = { name: "s", limits: { perMinute: 2, perDay: 3 } };
  assert.equal(rl.check(site, "1.1.1.1"), null);
  assert.equal(rl.check(site, "1.1.1.1"), null);
  assert.equal(rl.check(site, "1.1.1.1"), "per-minute");
  t += 61_000;
  assert.equal(rl.check(site, "1.1.1.1"), null);
  assert.equal(rl.check(site, "2.2.2.2"), "per-day");
});
