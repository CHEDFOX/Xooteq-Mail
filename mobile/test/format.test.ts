// The parts of the app that are only logic: reading addresses a person typed,
// turning a message into text, and quoting it in a reply.
//   node --experimental-strip-types --test test/format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyText, initials, parseAddresses, quote, stripHtml, withoutQuote } from "../src/lib/format.ts";
import type { Email } from "../src/lib/types.ts";

test("addresses are read however they were typed", () => {
  assert.deepEqual(parseAddresses("ada@example.com"), [{ email: "ada@example.com" }]);
  assert.deepEqual(parseAddresses('"Ada Lovelace" <ada@example.com>, grace@example.com'), [
    { name: "Ada Lovelace", email: "ada@example.com" },
    { email: "grace@example.com" },
  ]);
  // Nonsense is left out rather than sent.
  assert.deepEqual(parseAddresses("not an address; ada@example.com"), [{ email: "ada@example.com" }]);
  assert.deepEqual(parseAddresses("   "), []);
});

test("HTML becomes readable text, and nothing runs", () => {
  const html = "<style>p{color:red}</style><p>Hello <b>there</b></p><script>alert(1)</script><p>Line&nbsp;two &amp; three</p>";
  const text = stripHtml(html);
  assert.equal(text, "Hello there\nLine two & three");
  assert.ok(!text.includes("alert"));
  assert.ok(!text.includes("<"));
});

const email = (over: Partial<Email> = {}): Email => ({
  id: "e1", threadId: "t1", mailboxIds: { inbox: true }, keywords: {},
  from: [{ name: "Ada Lovelace", email: "ada@example.com" }],
  subject: "Hello", receivedAt: "2026-03-04T10:00:00.000Z",
  bodyValues: { t: { value: "First line\nSecond line" } },
  textBody: [{ partId: "t", type: "text/plain" }],
  ...over,
});

test("a message's text is its plain part, or its HTML read as text", () => {
  assert.equal(bodyText(email()), "First line\nSecond line");
  const onlyHtml = email({
    textBody: [], htmlBody: [{ partId: "h", type: "text/html" }],
    bodyValues: { h: { value: "<p>Hi <i>you</i></p>" } },
  });
  assert.equal(bodyText(onlyHtml), "Hi you");
});

test("a reply quotes what it answers, as mail has always done", () => {
  const q = quote(email());
  assert.match(q, /Ada Lovelace wrote:/);
  assert.match(q, /^> First line$/m);
  assert.match(q, /^> Second line$/m);
  // And the quote can be cut back off, for a preview.
  assert.equal(withoutQuote(`Thanks!${q}`), "Thanks!");
});

test("initials for the avatar, whatever the name looks like", () => {
  assert.equal(initials("Ada Lovelace"), "AL");
  assert.equal(initials("ada"), "AD");
  assert.equal(initials("Ada C. Lovelace"), "AL");
  assert.equal(initials(""), "?");
});
