// Caches the app shell only — never the GitHub API. Data always goes over
// the network so you're never looking at stale sync state without knowing it.
const CACHE = "ledger-shell-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icon.svg",
  "./js/app.js",
  "./js/store.js",
  "./js/views.js",
  "./js/logic.js",
  "./js/seed.js",
  "./js/github-client.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let GitHub API calls pass straight through
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
