// Offline support for the app itself. GitHub API calls are never touched, so
// you are never looking at stale sync state without knowing it.
//
// Network-first for everything same-origin, with the cache as an offline
// fallback rather than a speed layer.
//
// It used to be stale-while-revalidate for the app shell, which is the usual
// advice — but it is wrong for an app built from ES modules that import each
// other. After a deploy the outgoing service worker kept serving some modules
// from cache while newly-fetched ones arrived alongside them, so a new module
// would import an old one and throw on a missing export. That isn't a slightly
// stale UI, it's a white screen, and it happened on a real deploy of this app:
// a fresh bank-view.js loaded against a cached catalog.js and died on
// "problemFromCatalog is not a function".
//
// The shell must therefore update atomically, and the simplest way to
// guarantee that is to prefer the network whenever there is one. The app
// already needs the network to sync, so this costs little; the cache still
// makes it fully usable offline.
const CACHE = "ledger-shell-v4";
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
  "./js/icons.js",
  "./js/plant.js",
  "./js/diagrams.js",
  "./js/diagram-data.js",
  "./js/topics-content.js",
  "./js/whiteboard.js",
  "./js/codemirror-loader.js",
  "./js/featurize.js",
  "./js/pattern-model.js",
  "./js/catalog.js",
  "./js/analyze-view.js",
  "./js/bank-view.js",
];

self.addEventListener("install", (event) => {
  // One missing file must not abort the whole precache, so each is added
  // individually and failures are tolerated.
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((path) => c.add(path).catch(() => {})))
    )
  );
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
    fetch(event.request)
      .then((res) => {
        // Only a genuinely good response is worth keeping: caching an error
        // page would serve it back the next time the network is gone.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // A navigation with nothing cached for that exact URL still has to
        // render something, so fall back to the app shell.
        if (event.request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
