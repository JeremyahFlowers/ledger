// Imports every browser module under a minimal DOM stub.
//
//   node scripts/check-modules.mjs
//
// Why this exists: `node --check` only parses. The failure that actually ships
// is a missing export, which resolves at load time — and in a browser that is a
// blank page with one line in a console nobody is watching. It happened: a
// deploy served a fresh bank-view.js against a cached catalog.js and died on
// "problemFromCatalog is not a function". Parsing was clean the whole time.
//
// The stub is deliberately dumb. It exists so a module can reach top-level
// globals without exploding, not to emulate a browser — anything that needs
// real DOM behaviour is covered by the unit suite or by testing in a browser.

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "js");

function installDomStub() {
  const store = new Map();
  const element = {
    innerHTML: "", textContent: "", value: "", hidden: false, className: "",
    dataset: {}, offsetHeight: 0,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, replaceWith() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, focus() {},
    setSelectionRange() {}, remove() {}, closest: () => null,
    querySelector: () => element, querySelectorAll: () => [],
  };

  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.document = {
    readyState: "complete",
    documentElement: { dataset: {}, ...element },
    body: element,
    getElementById: () => element,
    querySelector: () => element,
    querySelectorAll: () => [],
    createElement: () => ({ ...element }),
    addEventListener() {},
  };
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    location: { href: "http://localhost/", origin: "http://localhost" },
  };
  // Recent Node versions ship a real `navigator` as a getter-only property, so
  // it has to be redefined rather than assigned.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { serviceWorker: { register: async () => {}, getRegistrations: async () => [] } },
  });
  globalThis.caches = { keys: async () => [], open: async () => ({ match: async () => null }) };
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.CSS = { escape: (s) => String(s) };
}

installDomStub();

const modules = readdirSync(JS_DIR).filter((f) => f.endsWith(".js")).sort();
const failures = [];

for (const file of modules) {
  try {
    await import(pathToFileURL(join(JS_DIR, file)).href);
  } catch (err) {
    failures.push({ file, message: err.message.split("\n")[0] });
  }
}

if (failures.length) {
  console.error(`\n${failures.length} of ${modules.length} modules failed to load:\n`);
  for (const f of failures) console.error(`  ${f.file}\n    ${f.message}`);
  console.error("\nA module that cannot load is a blank page in the browser.\n");
  process.exit(1);
}

console.log(`all ${modules.length} modules load cleanly`);
