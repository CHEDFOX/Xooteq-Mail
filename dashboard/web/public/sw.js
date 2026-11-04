// Xooteq Mail on a phone: the service worker keeps the app's own files, so the
// app opens at once from the home screen and says something sensible when there
// is no connection.
//
// It never keeps mail. Anything under /api or /hooks goes straight to the
// network and is not stored, so a lost or borrowed phone holds no messages in
// this cache — only the app's shell, which is the same for everyone.
//
// A new version installs quietly and waits; the page offers "a new version is
// ready" and sends skip-waiting when the person agrees (web/src/pwa.ts).
const VERSION = "xm-1";
const SHELL = `xm-shell-${VERSION}`;
const FILES = `xm-files-${VERSION}`;
/** The page itself, under one name: every route is served the same index.html. */
const PAGE = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([PAGE, "/manifest.webmanifest", "/favicon.svg"])).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("xm-") && name !== SHELL && name !== FILES) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});

/** The built files are named by their content, so a name never means anything else. */
async function fromCacheFirst(request) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

/** A page: what the server says, or the shell we kept, or a word about being offline. */
async function page(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(PAGE, res.clone());
    return res;
  } catch {
    return (await cache.match(PAGE)) ?? new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>Offline</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;" +
      "font:17px/1.5 system-ui,sans-serif;background:#F1F2EF;color:#141517\">" +
      "<div style=text-align:center;padding:32px><h1 style=font-size:20px;font-weight:600>No connection</h1>" +
      "<p style=color:#80848C>Xooteq Mail opens again as soon as you are back online.</p></div>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

/** Icons and the like: shown at once, refreshed in the background. */
async function fresh(request) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(request);
  const live = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => hit);
  return hit ?? live;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Mail, the API and the webhook: never this file's business.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/hooks/")) return;

  if (request.mode === "navigate") return event.respondWith(page(request));
  if (url.pathname.startsWith("/assets/")) return event.respondWith(fromCacheFirst(request));
  if (/\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) return event.respondWith(fresh(request));
});
