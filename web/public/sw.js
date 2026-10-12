/*
 * Sentinel Quiz service worker (registered by the boot script in app/layout.tsx, production only).
 *
 * Deliberately small:
 * - every page load falls back to a branded offline page instead of the browser's error screen;
 * - the offline reader (/read/offline) works without a network: its navigation is cached network
 *   first, and the hashed /_next/static assets it needs are cached cache first (they are immutable).
 *
 * It never caches API responses or other app pages (they carry a per-request CSP nonce and private
 * data). The downloaded chapters live in the `sentinel-reader-v1` cache, written by the page itself
 * (features/reading/lib/offline-store.ts): this worker never touches it and never deletes it.
 *
 * Bump VERSION whenever offline.html (or anything in PRECACHE) changes. To retire the worker,
 * replace this file with one that calls self.registration.unregister() on activate.
 */
const VERSION = "v2";
const CACHE = `sentinel-offline-${VERSION}`;
const SHELL_CACHE = "sentinel-reader-shell-v1";
/** Offline chapters (owned by the page; listed here only so cleanup never deletes it). */
const READER_DATA_CACHE = "sentinel-reader-v1";
const OFFLINE_URL = "/offline.html";
const OFFLINE_READER_PATH = "/read/offline";
const PRECACHE = [OFFLINE_URL];
const KEEP = new Set([CACHE, SHELL_CACHE, READER_DATA_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

/** Old caches of this app: other offline/shell versions. Reader data (`sentinel-reader-v*`) is never removed. */
function isObsolete(key) {
  if (KEEP.has(key) || !key.startsWith("sentinel-")) {
    return false;
  }
  if (key.startsWith("sentinel-reader-") && !key.startsWith("sentinel-reader-shell-")) {
    return false;
  }
  return true;
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isObsolete).map((key) => caches.delete(key)));
      // Start the page request in parallel with the worker boot (no navigation latency added).
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

function isOfflineReader(url) {
  return url.pathname === OFFLINE_READER_PATH || url.pathname === `${OFFLINE_READER_PATH}/`;
}

/** Network first for /read/offline: refresh the cached copy, serve it when the network fails. */
async function offlineReaderNavigation(event) {
  const { request } = event;
  const shell = await caches.open(SHELL_CACHE);
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(request));
    if (response && response.ok && response.type === "basic") {
      await shell.put(OFFLINE_READER_PATH, response.clone());
    }
    return response;
  } catch {
    return (await shell.match(OFFLINE_READER_PATH)) || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

// Hashed assets change on every deploy; keep the newest ones only so the shell cache stays bounded.
const MAX_STATIC_ENTRIES = 400;

/** Drop the oldest cached build assets (Cache.keys() is in insertion order) above the cap. */
async function trimStaticAssets(shell) {
  const keys = (await shell.keys()).filter((request) => new URL(request.url).pathname.startsWith("/_next/static/"));
  const excess = keys.length - MAX_STATIC_ENTRIES;
  for (let index = 0; index < excess; index += 1) {
    await shell.delete(keys[index]);
  }
}

/** Cache first for hashed build assets (immutable): the offline reader needs its JS and CSS. */
async function staticAsset(event) {
  const { request } = event;
  const shell = await caches.open(SHELL_CACHE);
  const cached = await shell.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    await shell.put(request, response.clone());
    event.waitUntil(trimStaticAssets(shell));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticAsset(event));
    return;
  }
  // Only top-level page loads below; everything else (API, SSE, RSC payloads) goes to the network.
  if (request.mode !== "navigate") {
    return;
  }
  if (isOfflineReader(url)) {
    event.respondWith(offlineReaderNavigation(event));
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
