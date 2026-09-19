// Global search: one place to reach anything by name.
//
// Where this fits: opened with `/` from anywhere, or the topbar button. It
// searches three things at once because they're three ways of asking the same
// question — the problems you're tracking, the ~2,500 in the catalog, and the
// patterns themselves.
//
// The ordering is the whole design. A title you typed exactly should not sit
// below a catalog problem that happens to contain the word, and something you
// are actively practising should outrank something you have never opened. So
// results are scored by how well the text matches *and* by how close the thing
// already is to you, and the two are combined rather than one sorting the
// other.

import { esc } from "./views.js";
import { loadCatalog, PATTERN_CONFIDENCE, slugify, problemUrl } from "./catalog.js";
import { patternIcon, navIcon } from "./icons.js";
import { isBacklog } from "./logic.js";

const MAX_PER_GROUP = 6;
const MIN_QUERY = 2;
// Typing is faster than rendering 2,500 rows; this keeps keystrokes smooth
// without a perceptible lag before results appear.
const DEBOUNCE_MS = 120;

const OVERLAY_ID = "global-search";

let deps = null;          // { store, actions }
let catalog = null;       // lazily loaded, then kept
let activeIndex = 0;
let results = [];

export function installSearch(dependencies) {
  deps = dependencies;
}

export function isSearchOpen() {
  return !!document.getElementById(OVERLAY_ID);
}

export function closeSearch() {
  const el = document.getElementById(OVERLAY_ID);
  if (!el) return;
  const restore = el._restoreFocus;
  el.remove();
  if (restore && document.contains(restore)) restore.focus();
}

export function openSearch() {
  if (isSearchOpen() || !deps?.store?.state) return;
  const previouslyFocused = document.activeElement;

  const el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.className = "search-overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Search");
  el.innerHTML = `
    <div class="search-panel">
      <input class="search-input" id="search-input" type="search" autocomplete="off"
             placeholder="Search problems, patterns, topics…"
             aria-label="Search" aria-controls="search-results" aria-expanded="true" />
      <div id="search-results" class="search-results" role="listbox"></div>
      <div class="search-footer muted small">
        <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>`;
  el._restoreFocus = previouslyFocused;
  document.body.appendChild(el);

  el.addEventListener("mousedown", (e) => { if (e.target === el) closeSearch(); });

  const input = el.querySelector("#search-input");
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), DEBOUNCE_MS);
  });
  input.addEventListener("keydown", onKeyDown);
  input.focus();

  // The catalog is the big one and may not be loaded yet; fetch it in the
  // background so typing works immediately against everything else.
  if (!catalog) {
    loadCatalog()
      .then((c) => { catalog = c; if (isSearchOpen()) runSearch(input.value); })
      .catch(() => { /* searching your own problems and patterns still works */ });
  }

  runSearch("");
}

function onKeyDown(event) {
  if (event.key === "Escape") { event.preventDefault(); closeSearch(); return; }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!results.length) return;
    activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    paintActive();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const hit = results[activeIndex];
    if (hit) choose(hit);
  }
}

/**
 * Score a candidate against the query. Exported because the ranking is the
 * substance of this module — everything else is presentation — and it is worth
 * pinning independently of a DOM.
 *
 * Returns null for no match so callers can filter in one pass. Higher is
 * better; the bands are deliberately far apart so a weaker kind of match never
 * outranks a stronger one on the strength of a tie-breaker.
 */
export function score(text, query) {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return 1;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 500;

  // Everything below used to be a regex built per candidate, which meant
  // compiling a pattern ~2,500 times per keystroke — the entire reason typing
  // felt choppy. indexOf answers the same question, and the word-boundary test
  // is just "what character precedes the hit", so no pattern is needed at all.
  // Dropping the regex also drops the escaping it required, and with it the
  // possibility of a query like "*.+?" being read as syntax.
  const at = haystack.indexOf(needle);
  if (at === -1) return null;
  // A word-start match ("two" in "Add Two Numbers") reads as intentional in a
  // way that a match inside a word does not.
  return at === 0 || !isWordChar(haystack[at - 1]) ? 250 : 100;
}

function isWordChar(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_";
}

function runSearch(rawQuery) {
  const query = rawQuery.trim();
  const state = deps.store.state;
  results = [];

  // Patterns first: they're few, and "what was sliding window again" is a
  // question this app should answer instantly.
  for (const pattern of state.patterns) {
    const s = score(pattern.name, query);
    if (s == null) continue;
    results.push({ kind: "pattern", score: s + 40, id: pattern.id, title: pattern.name,
      subtitle: pattern.description });
  }

  // Your own problems outrank the catalog — you've already chosen these.
  for (const problem of state.problems) {
    const s = score(`${problem.name} ${problem.number ?? ""}`, query);
    if (s == null) continue;
    results.push({
      kind: "mine", score: s + 25, id: problem.id, title: problem.name,
      subtitle: `${problem.difficulty}${isBacklog(problem) ? " · in your bank" : " · in your review rotation"}`,
      problem,
    });
  }

  if (catalog && query.length >= MIN_QUERY) {
    const owned = new Set(state.problems.map((p) => p.catalogSlug || slugify(p.name)));
    for (const entry of catalog.problems) {
      if (owned.has(entry.slug)) continue; // already shown as one of yours
      const s = score(`${entry.title} ${entry.number ?? ""}`, query);
      if (s == null) continue;
      results.push({ kind: "catalog", score: s, id: entry.slug, title: entry.title,
        subtitle: `${entry.difficulty} · ${topPatternOf(entry)}`, entry });
    }
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  results = capPerGroup(results);
  activeIndex = 0;
  paint(query);
}

function topPatternOf(entry) {
  const top = Object.entries(entry.patterns)
    .filter(([, w]) => w >= PATTERN_CONFIDENCE)
    .sort((a, b) => b[1] - a[1])[0];
  return top ? top[0].replace(/[-_]/g, " ") : "unlabelled";
}

/** Keep every kind represented — an exact catalog match shouldn't be buried
 * under six of your own near-misses, and vice versa. */
function capPerGroup(list) {
  const counts = { pattern: 0, mine: 0, catalog: 0 };
  return list.filter((r) => ++counts[r.kind] <= MAX_PER_GROUP);
}

const KIND_LABEL = { pattern: "Pattern", mine: "Your problems", catalog: "Catalog" };
const KIND_ICON = { pattern: "topics", mine: "queue", catalog: "bank" };

function paint(query) {
  const host = document.getElementById("search-results");
  if (!host) return;

  if (!results.length) {
    host.innerHTML = `<p class="search-empty muted small">${query.length < MIN_QUERY
      ? "Type at least two characters to search the catalog."
      : `Nothing matches “${esc(query)}”.`}</p>`;
    return;
  }

  let lastKind = null;
  host.innerHTML = results.map((r, i) => {
    const header = r.kind !== lastKind
      ? `<p class="search-group">${navIcon(KIND_ICON[r.kind], { size: 13 })} ${KIND_LABEL[r.kind]}</p>` : "";
    lastKind = r.kind;
    const icon = r.kind === "pattern"
      ? `<span class="pattern-icon">${patternIcon(r.id, { size: 15 })}</span>` : "";
    return `${header}
      <button type="button" class="search-hit ${i === activeIndex ? "active" : ""}"
              role="option" aria-selected="${i === activeIndex}" data-index="${i}">
        ${icon}
        <span class="search-hit-text">
          <span class="search-hit-title">${esc(r.title)}</span>
          <span class="muted small">${esc(r.subtitle)}</span>
        </span>
      </button>`;
  }).join("");

  host.querySelectorAll("[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => choose(results[Number(btn.dataset.index)]));
  });
}

function paintActive() {
  const host = document.getElementById("search-results");
  if (!host) return;
  host.querySelectorAll(".search-hit").forEach((el, i) => {
    const active = i === activeIndex;
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", String(active));
    if (active) el.scrollIntoView({ block: "nearest" });
  });
}

function choose(hit) {
  closeSearch();
  if (hit.kind === "pattern") {
    deps.actions.openTopic(hit.id);
    return;
  }
  if (hit.kind === "mine") {
    deps.actions.startProblem(hit.problem);
    return;
  }
  // A catalog problem isn't yours yet, so the useful move is to read it.
  const url = problemUrl({ catalogSlug: hit.entry.slug, name: hit.entry.title, number: hit.entry.number });
  if (url) window.open(url, "_blank", "noopener");
}
