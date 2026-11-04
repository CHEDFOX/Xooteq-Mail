// Xooteq Mail as an app on a device: the manifest and the icons it is kept by,
// the service worker's rules, and how the server hands all of it out. No
// network and no browser: node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "web", "public");

// A web root like the built one: the real manifest, icons and service worker,
// with a stand-in for the page and one hashed asset.
const web = fs.mkdtempSync(path.join(os.tmpdir(), "xm-web-"));
fs.cpSync(publicDir, web, { recursive: true });
fs.writeFileSync(path.join(web, "index.html"), "<!doctype html><title>Xooteq Mail</title><div id=root></div>");
fs.mkdirSync(path.join(web, "assets"));
fs.writeFileSync(path.join(web, "assets", "index-abc123.js"), "export const x = 1;\n");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xm-pwa-"));
process.env.DASHBOARD_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.MAIL_DOMAIN = "mail.xooteq.online";
process.env.VPS_IP = "203.0.113.7";
process.env.WEB_DIR = web;

const { buildApp } = await import("../server/app.ts");
const app = await buildApp({ logger: false });
test.after(() => app.close());

type Manifest = {
  name: string; start_url: string; scope: string; display: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8")) as Manifest;
const sw = fs.readFileSync(path.join(publicDir, "sw.js"), "utf8");

test("the manifest says what a device needs to keep the app", () => {
  assert.equal(manifest.name, "Xooteq Mail");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  // Chrome asks for 192 and 512, and for one it may mask to its own shape.
  const sizes = manifest.icons.map((i) => `${i.sizes} ${i.purpose}`);
  assert.ok(sizes.includes("192x192 any"), sizes.join(", "));
  assert.ok(sizes.includes("512x512 any"), sizes.join(", "));
  assert.ok(sizes.includes("512x512 maskable"), sizes.join(", "));
});

test("every icon the manifest names is there, square and the size it claims", () => {
  for (const icon of [...manifest.icons, { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]) {
    const file = path.join(publicDir, icon.src.replace(/^\//, ""));
    assert.ok(fs.existsSync(file), `${icon.src} is missing (python3 tools/make-icons.py)`);
    const png = fs.readFileSync(file);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${icon.src} is not a PNG`);
    // The size sits in the IHDR chunk, right after the 8-byte signature.
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} is ${width}x${height}`);
  }
});

test("the service worker keeps the app's shell and never touches mail", () => {
  // Whatever else it does, it must leave the API alone: no message, no address
  // and no attachment may end up in a cache on the device.
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /url\.pathname\.startsWith\("\/hooks\/"\)/);
  assert.doesNotMatch(sw, /cache\w*\.put\([^)]*api/i);
  // Only GET, and only this origin.
  assert.match(sw, /request\.method !== "GET"/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  // A new version waits to be let in rather than taking over mid-sentence.
  assert.match(sw, /skip-waiting/);
  assert.doesNotMatch(sw, /install[\s\S]{0,400}skipWaiting\(\)/);
});

test("the server hands out the manifest, the worker and the icons", async () => {
  const m = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
  assert.equal(m.statusCode, 200);
  assert.match(m.headers["content-type"] as string, /manifest\+json|application\/json/);
  assert.equal(JSON.parse(m.body).name, "Xooteq Mail");

  const worker = await app.inject({ method: "GET", url: "/sw.js" });
  assert.equal(worker.statusCode, 200);
  assert.match(worker.headers["content-type"] as string, /javascript/);
  // A stale worker would pin the app to an old version: it is never cached.
  assert.equal(worker.headers["cache-control"], "no-cache");

  const icon = await app.inject({ method: "GET", url: "/icon-512.png" });
  assert.equal(icon.statusCode, 200);
  assert.match(icon.headers["content-type"] as string, /image\/png/);

  // The built files are named by their content, so they are kept for a year.
  const asset = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers["cache-control"] as string, /immutable/);
});

test("a link straight into the app opens the app", async () => {
  // Opening the home-screen app lands on a route like this one; it must be the
  // page, not a 404, for the app to start at all.
  const deep = await app.inject({ method: "GET", url: "/mail/tailzu/inbox" });
  assert.equal(deep.statusCode, 200);
  assert.match(deep.body, /id=root/);
  assert.equal(deep.headers["cache-control"], "no-cache");

  // The API underneath still answers as an API.
  const api = await app.inject({ method: "GET", url: "/api/me" });
  assert.equal(api.statusCode, 401);
});
