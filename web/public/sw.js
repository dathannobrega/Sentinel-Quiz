/*
 * Sentinel Quiz service worker (registered by the boot script in app/layout.tsx, production only).
 *
 * Deliberately minimal: it exists so the installed app opens a branded offline page instead of the
 * browser's error screen. It never caches API responses or app pages (they carry a per-request CSP
 * nonce and private data); hashed /_next/static assets already live in the HTTP cache (immutable).
 *
 * Bump VERSION whenever offline.html (or anything in PRECACHE) changes. To retire the worker,
 * replace this file with one that calls self.registration.unregister() on activate.
 */
const VERSION = "v1";
const CACHE = `sentinel-offline-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("sentinel-") && key !== CACHE).map((key) => caches.delete(key)));
      // Start the page request in parallel with the worker boot (no navigation latency added).
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only top-level page loads; everything else (API, SSE, assets) goes straight to the network.
  if (request.mode !== "navigate" || request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(request));
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })()
  );
});
