// Caches the app shell only — never the GitHub API. Data always goes over the
// network so you're never looking at stale sync state without knowing it.
//
// Two strategies, deliberately:
//
// * Shell (HTML/CSS/JS/icons): stale-while-revalidate. Instant loads, and a new
//   version lands on the next visit.
// * Generated data (the pattern model and problem catalog): network-first,
//   falling back to cache when offline. These are rebuilt by a workflow, and
//   under stale-while-revalidate a retrain took two reloads to appear — the
//   first load kept serving the old model, so predictions and the catalog
//   silently disagreed with what had just been published.
const CACHE = "ledger-shell-v2";
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
];

/** Generated artifacts, rebuilt by the training workflow rather than shipped
 * with the shell. Kept fresh over the network whenever one is reachable. */
function isGeneratedData(pathname) {
  return pathname.includes("/data/") || pathname.includes("/model/");
}

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

  if (isGeneratedData(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

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
