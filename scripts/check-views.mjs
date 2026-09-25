// Calls every render function, against an empty log and a populated one.
//
//   node scripts/check-views.mjs
//
// Why this exists, when check-modules.mjs loads every module and
// check-references.mjs finds unimported names: neither of them executes a
// render body. A view can import everything it needs and still throw the first
// time it is opened — reading `.length` off something absent, indexing a table
// with a key that isn't there, formatting a date that is null.
//
// That is the failure that actually reaches people, because a view nobody opens
// during a test run is first opened by the user. It happened twice while
// splitting views.js: `OUTCOME_GLYPH` unimported in two files, and `showDay`
// unimported in the heatmap wiring. Every module loaded, every unit test
// passed, and the Journal and the heatmap threw on click.
//
// Both states are run because both are real. The empty one is everybody's
// first hour and is the one more likely to be wrong, since it is the path the
// author sees least.

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "js");

function installDomStub() {
  const storage = new Map();
  const make = () => {
    const el = {
      innerHTML: "", textContent: "", value: "", hidden: false, className: "",
      tabIndex: 0, dataset: {}, offsetHeight: 0, offsetWidth: 0, isConnected: true,
      style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      appendChild() {}, replaceWith() {}, replaceChildren() {}, insertAdjacentHTML() {},
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      focus() {}, blur() {}, click() {}, remove() {}, scrollIntoView() {},
      setSelectionRange() {}, closest: () => null,
      getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0 }),
      childElementCount: 0,
      // The whiteboard draws on a real canvas. Enough of a 2D context to get
      // through setup; nothing here checks what was drawn.
      width: 800, height: 600,
      getContext: () => new Proxy({}, {
        get: (_, key) => (key === "canvas" ? el : () => ({ width: 0 })),
      }),
      toDataURL: () => "data:image/png;base64,",
    };
    el.querySelector = () => make();
    el.querySelectorAll = () => [];
    el.children = [];
    return el;
  };

  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };
  globalThis.document = {
    readyState: "complete",
    documentElement: make(),
    body: make(),
    getElementById: () => make(),
    querySelector: () => make(),
    querySelectorAll: () => [],
    createElement: () => make(),
    createElementNS: () => make(),
    addEventListener() {},
    // CodeMirror is fetched by appending a <link> and a <script>, from a render
    // body, and neither ever resolves here. An unhandled rejection from that is
    // noise about the stub, not a finding about the view.
    head: make(),
  };
  // A page has these directly, not only on `window`. interview.js reads
  // location.hash at import time, which is exactly the kind of top-level work
  // this check exists to exercise.
  globalThis.location = { href: "http://localhost/", origin: "http://localhost",
    pathname: "/index.html", hash: "", hostname: "localhost" };
  globalThis.EventSource = class { close() {} };
  globalThis.prompt = () => null;
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    location: { href: "http://localhost/", origin: "http://localhost" },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    confirm: () => false,
    open: () => null,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { serviceWorker: { register: async () => {}, getRegistrations: async () => [] },
      clipboard: { writeText: async () => {} } },
  });
  globalThis.caches = { keys: async () => [], open: async () => ({ match: async () => null }) };
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.CSS = { escape: (s) => String(s) };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.devicePixelRatio = 1;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.URL.createObjectURL = () => "blob:stub";
  globalThis.URL.revokeObjectURL = () => {};
  return make;
}

const make = installDomStub();

// The editor loader's promises never settle against a stub, and a lazy import
// that fails says nothing about whether the view rendered.
process.on("unhandledRejection", () => {});

const { buildSeedState } = await import(pathToFileURL(join(JS_DIR, "seed.js")));
const { demoState } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "demo-state.mjs")));
const logic = await import(pathToFileURL(join(JS_DIR, "logic.js")));

/** The shared populated log, plus the one thing it cannot carry: a day clock,
 *  which is started relative to now rather than stored. */
function populated() {
  const state = demoState();
  logic.startDayTimer(state, Date.now() - 20 * 60000);
  return state;
}

/** A fake store, enough for a render: the views only read `state` and call
 *  `mutate` from handlers, which nothing here fires. */
function fakeStore(state) {
  return {
    state, status: "synced", error: null, dirty: false, blocked: false,
    recovered: false, lastSyncedAt: Date.now(),
    leetcode: { status: "empty", data: null, error: null },
    gh: { fetchBinaryFile: async () => "" },
    mutate(fn) { fn(this.state); },
    flush() {}, onChange() { return () => {}; },
    fetchStatement: async () => null,
    requestStatements: async () => {},
    peekRemoteState: async () => null,
  };
}

const actions = {
  switchTab() {}, rerender() {}, openProblem() {}, openTopic() {}, openJournal() {},
  startProblem() {}, refreshLeetCode() {},
};

// Views that need a selection made first, and how to make it.
const PREPARE = {
  renderProblemDetail: async (state) => {
    const { showProblem } = await import(pathToFileURL(join(JS_DIR, "detail-view.js")));
    showProblem(state.problems[0].id);
  },
  renderDayDetail: async (state) => {
    const { showDay } = await import(pathToFileURL(join(JS_DIR, "detail-view.js")));
    showDay(logic.todayISO());
  },
  renderTopicDetail: async (state) => {
    const { showTopic } = await import(pathToFileURL(join(JS_DIR, "ui.js")));
    showTopic(state.patterns[0].id);
  },
  renderWorkspace: async (state) => {
    const { startSession } = await import(pathToFileURL(join(JS_DIR, "session-view.js")));
    startSession(state.problems[0]);
  },
};

// Needs a live session *and* a reflect state that only the workspace's submit
// button builds. Covered by the unit suite instead of faked badly here.
const SKIP = new Set(["renderReflect", "renderSessionSummary", "renderSetup", "renderConflict"]);

const files = readdirSync(JS_DIR).filter((f) => f.endsWith(".js"));
const failures = [];
let ran = 0;

for (const file of files) {
  const mod = await import(pathToFileURL(join(JS_DIR, file)));
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function" || !/^render[A-Z]/.test(name) || SKIP.has(name)) continue;
    for (const [label, build] of [["an empty log", buildSeedState], ["a populated log", populated]]) {
      const state = build();
      try {
        await PREPARE[name]?.(state);
        fn(make(), fakeStore(state), actions);
        ran += 1;
      } catch (err) {
        failures.push(`${file} ${name}() threw on ${label}: ${err.message}`);
      }
    }
  }
}

if (failures.length) {
  for (const f of failures) console.error(f);
  console.error("\nA view that throws is a blank page with one line in a console nobody is watching.");
  process.exit(1);
}
console.log(`${ran} view renders completed without throwing`);
// Exit rather than return: a render kicks off the editor loader, whose promise
// never settles against a stub, and Node would wait for it forever.
process.exit(0);
