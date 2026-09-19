import { store } from "./store.js";
import * as views from "./views.js";
import { computePlantState, dueProblems, allAttempts, patternStats, systemDesignUnlock, backlogProblems, progressSummary } from "./logic.js";
import { plantSvg } from "./plant.js";
import { navIcon } from "./icons.js";
import { renderAnalyze } from "./analyze-view.js";
import { renderBank } from "./bank-view.js";
import { installShortcuts, toggleHelp } from "./shortcuts.js";
import { renderProgress } from "./progress-view.js";
import { recommendSession } from "./logic.js";

// The nav reads like a table of contents, not a junk drawer: Home is the
// cover page; everything else lives in one of a few named chapters, each
// with its own index card explaining what's inside and when to reach for
// it. Landing on a chapter's own tab shows that index by default — a
// specific page inside it is always one more click, never the first click.
const STANDALONE = {
  dashboard: { label: "Home", icon: "home", render: views.renderDashboard },
  settings: { label: "Settings", icon: "settings", render: views.renderSettings },
};

const SECTIONS = {
  practice: {
    label: "Practice",
    icon: "practice",
    blurb: "Ways to get reps in outside the guided Dashboard flow.",
    pages: [
      { id: "queue", label: "Review Queue", icon: "queue", render: views.renderQueue, blurb: "Everything due, not just what fits today's time budget.", stat: (state) => { const n = dueProblems(state).length; return n ? `${n} due now` : "All caught up"; } },
      { id: "bank", label: "Problem Bank", icon: "bank", render: renderBank, blurb: "Browse ~2,500 pattern-labelled problems and stock up. Saved problems wait in your bank — they never show up as overdue.", stat: (state) => { const n = backlogProblems(state).length; return n ? `${n} waiting in your bank` : "Nothing saved yet"; } },
      { id: "whiteboard", label: "Whiteboard", icon: "whiteboard", render: views.renderWhiteboard, blurb: "A freeform scratchpad for sketching outside an active session.", stat: (state) => `${state.whiteboards.length} board${state.whiteboards.length === 1 ? "" : "s"} saved` },
      { id: "log", label: "Log Manually", icon: "log", render: views.renderLog, blurb: "Record something you already solved elsewhere — LeetCode, paper, a real interview.", stat: (state) => `${state.problems.length} problems logged` },
    ],
  },
  learn: {
    label: "Learn",
    icon: "learn",
    blurb: "Build understanding, not just volume.",
    pages: [
      { id: "topics", label: "Topics", icon: "topics", render: views.renderTopics, blurb: "One dedicated page per pattern — plain-language hook, concept, invariant, pitfalls, animated worked examples.", stat: (state) => `${state.patterns.length} patterns to explore` },
      { id: "patterns", label: "Patterns", icon: "patterns", render: views.renderPatterns, blurb: "Your mastery table, weakest first — what the next two weeks should focus on.", stat: (state) => { const ranked = patternStats(state).filter((s) => s.attempts > 0).sort((a, b) => (a.solvedCleanRate ?? 1) - (b.solvedCleanRate ?? 1)); return ranked.length ? `Weakest: ${ranked[0].pattern.name}` : "No attempts logged yet"; } },
      { id: "quiz", label: "Quiz", icon: "quiz", render: views.renderQuiz, blurb: "Open-ended pattern-recall drilling, the same mechanic used in every Reflect step.", stat: (state) => state.quiz.totalAsked ? `${Math.round((state.quiz.totalCorrect / state.quiz.totalAsked) * 100)}% lifetime accuracy` : "No questions answered yet" },
      { id: "analyze", label: "Analyze", icon: "analyze", render: renderAnalyze, blurb: "Paste a problem you don't recognize and see which patterns it resembles — and exactly which words and bounds say so.", stat: () => "Runs in your browser" },
    ],
  },
  track: {
    label: "Track",
    icon: "track",
    blurb: "Where the record of your work lives.",
    pages: [
      { id: "progress", label: "Progress", icon: "progress", render: renderProgress, blurb: "Whether you're actually improving — clean solves and time-to-insight over the last two months, and which patterns moved.", stat: (state) => { const s = progressSummary(state); return s.hasEnoughData ? (s.cleanRateDelta > 0.03 ? "Trending up" : s.cleanRateDelta < -0.03 ? "Trending down" : "Holding steady") : "Needs more data"; } },
      { id: "journal", label: "Journal", icon: "journal", render: views.renderJournal, blurb: "Every soul statement and mock interview, plus freeform weekly retros.", stat: (state) => `${allAttempts(state).filter((a) => a.soulStatement).length} soul statements` },
      { id: "leetcode", label: "LeetCode", icon: "leetcode", render: views.renderLeetCode, blurb: "Solved counts, activity, and recent submissions from your real profile.", stat: (state, store) => store.leetcode?.data?.solvedByDifficulty ? `${store.leetcode.data.solvedByDifficulty.All ?? 0} solved on LeetCode` : "Not synced yet" },
      { id: "systemDesign", label: "System Design", icon: "systemDesign", render: views.renderSystemDesign, blurb: "A separate track, unlocked once coding fundamentals are solid.", stat: (state) => systemDesignUnlock(state).unlocked ? "Unlocked" : "Locked" },
    ],
  },
};

const PAGE_TO_SECTION = {};
for (const [sectionId, section] of Object.entries(SECTIONS)) {
  for (const page of section.pages) PAGE_TO_SECTION[page.id] = sectionId;
}
// The per-pattern Topics detail page isn't a registered page (there's one
// per pattern, decided at runtime) — it belongs to Learn for nav-highlight
// purposes, and app.js dispatches its render directly (see renderAll).
PAGE_TO_SECTION.topicDetail = "learn";

// Entered only via a Dashboard/Workspace button, never from the tab bar —
// rendering one of these swaps the full nav for a minimal exit bar so the
// session stays the focus.
const SESSION_TABS = {
  workspace: { render: views.renderWorkspace, label: "Session" },
  reflect: { render: views.renderReflect, label: "Reflect" },
  warmup: { render: views.renderWarmup, label: "Warmup" },
  sessionSummary: { render: views.renderSessionSummary, label: "Session complete" },
};

let activeTab = localStorage.getItem("ledger.activeTab") || "dashboard";

const nav = document.getElementById("tab-nav");
const root = document.getElementById("view-root");
const statusEl = document.getElementById("sync-status");
const plantEl = document.getElementById("plant-indicator");
const announcer = document.getElementById("view-announcer");

/** Human-readable name of whatever is on screen, for the live region. */
function currentViewName() {
  if (SESSION_TABS[activeTab]) return SESSION_TABS[activeTab].label;
  if (STANDALONE[activeTab]) return STANDALONE[activeTab].label;
  if (SECTIONS[activeTab]) return `${SECTIONS[activeTab].label} overview`;
  if (activeTab === "topicDetail") return "Pattern detail";
  const owner = PAGE_TO_SECTION[activeTab];
  const page = owner && SECTIONS[owner].pages.find((p) => p.id === activeTab);
  return page ? `${SECTIONS[owner].label}, ${page.label}` : "Ledger";
}

let lastAnnounced = null;
function announceView() {
  if (!announcer) return;
  const name = currentViewName();
  if (name === lastAnnounced) return; // re-renders are not navigations
  lastAnnounced = name;
  announcer.textContent = name;
}

const actions = {
  switchTab(id) {
    activeTab = id;
    localStorage.setItem("ledger.activeTab", id);
    renderAll();
  },
  rerender() {
    renderAll();
  },
};

function exitSession() {
  if (views.hasActiveSession()) {
    if (!confirm("Leave without saving this session?")) return;
    views.abandonSession();
  }
  actions.switchTab("dashboard");
}

function navLabel(icon, label) {
  return `<span class="nav-icon-label">${navIcon(icon, { size: 16 })}<span>${label}</span></span>`;
}

function renderNav() {
  const show = store.state != null;
  nav.hidden = !show;
  if (!show) return;

  if (SESSION_TABS[activeTab]) {
    nav.innerHTML = `
      <div class="nav-row">
        <button class="tab session-exit" id="nav-exit">✕ Exit</button>
        <span class="session-nav-label">${SESSION_TABS[activeTab].label}</span>
      </div>`;
    nav.querySelector("#nav-exit").addEventListener("click", exitSession);
    return;
  }

  const currentSectionId = SECTIONS[activeTab] ? activeTab : PAGE_TO_SECTION[activeTab] || null;

  const primaryItems = [
    { id: "dashboard", ...STANDALONE.dashboard },
    ...Object.entries(SECTIONS).map(([id, s]) => ({ id, ...s })),
    { id: "settings", ...STANDALONE.settings },
  ];
  // aria-current marks the active entry for assistive technology; the "active"
  // class only conveys it visually.
  const current = (isActive) => (isActive ? ' aria-current="page"' : "");
  let html = `<div class="nav-row nav-row-primary">${primaryItems.map((t) => {
    const isActive = t.id === activeTab || t.id === currentSectionId;
    return `
    <button class="tab ${isActive ? "active" : ""}"${current(isActive)} data-tab="${t.id}">${navLabel(t.icon, t.label)}</button>`;
  }).join("")}</div>`;

  if (currentSectionId) {
    const section = SECTIONS[currentSectionId];
    html += `<div class="nav-row nav-row-secondary">
      <span class="nav-chapter-label">${section.label}:</span>
      <button class="tab tab-sub ${activeTab === currentSectionId ? "active" : ""}"${current(activeTab === currentSectionId)} data-tab="${currentSectionId}">Overview</button>
      ${section.pages.map((p) => `<button class="tab tab-sub ${activeTab === p.id ? "active" : ""}"${current(activeTab === p.id)} data-tab="${p.id}">${navLabel(p.icon, p.label)}</button>`).join("")}
    </div>`;
  }

  nav.innerHTML = html;
  nav.querySelectorAll("button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => actions.switchTab(btn.dataset.tab));
  });
}

/** A section's own tab shows this by default — a table of contents for that
 * chapter, each entry explaining what it's for and when to reach for it,
 * rather than dropping straight into whichever page happened to be first. */
function renderSectionIndex(root, section, actions) {
  root.innerHTML = `
    <div class="card index-intro"><h2>${section.label}</h2><p class="muted">${section.blurb}</p></div>
    <div class="index-grid">
      ${section.pages.map((p) => `
        <button type="button" class="card index-card" data-tab="${p.id}">
          <div class="row gap-sm" style="align-items:center"><span class="topic-index-icon">${navIcon(p.icon, { size: 20 })}</span><h3 style="margin:0">${p.label}</h3></div>
          <p class="muted small">${p.blurb}</p>
          ${p.stat && store.state ? `<span class="index-card-stat">${p.stat(store.state, store)}</span>` : ""}
        </button>`).join("")}
    </div>`;
  root.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => actions.switchTab(btn.dataset.tab));
  });
}

const STATUS_MAP = {
  unconfigured: ["Not connected", "warn"],
  loading: ["Syncing…", "info"],
  saving: ["Saving…", "info"],
  synced: ["Synced", "good"],
  offline: ["Offline — showing cached data", "warn"],
  conflict: ["Sync conflict", "bad"],
  error: ["Sync error", "bad"],
};

function renderStatus() {
  const [text, cls] = STATUS_MAP[store.status] || ["", ""];
  statusEl.textContent = text;
  statusEl.className = `status status-${cls}`;
  statusEl.title = store.error || "";
}

const PLANT_STAGE_ORDER = ["seed", "sprout", "seedling", "young", "budding", "flowering", "tree"];
const PLANT_STAGE_KEY = "ledger.plant.lastStage";

// The plant lives in the topbar too, not just the Dashboard, on purpose —
// visible on every screen, the same way well-being should be a constant
// backdrop to studying rather than something you check in on separately.
function renderPlantIndicator() {
  if (!store.state) {
    plantEl.innerHTML = "";
    return;
  }
  const plant = computePlantState(store.state);
  plantEl.innerHTML = plantSvg(plant.stage, plant.vitality, { size: 30, decorative: true });
  plantEl.title = `${plant.stageLabel} — ${plant.vitality}`;

  const lastStage = localStorage.getItem(PLANT_STAGE_KEY);
  if (lastStage && PLANT_STAGE_ORDER.indexOf(plant.stage) > PLANT_STAGE_ORDER.indexOf(lastStage)) {
    views.toast(`Your plant grew into a ${plant.stageLabel}.`);
  }
  localStorage.setItem(PLANT_STAGE_KEY, plant.stage);
}
plantEl.addEventListener("click", () => actions.switchTab("dashboard"));

function renderAll() {
  renderNav();
  renderStatus();
  renderPlantIndicator();
  announceView();

  if (store.status === "unconfigured") {
    views.renderSetup(root, store);
    return;
  }
  if ((store.status === "loading") && !store.state) {
    root.innerHTML = `<p class="muted">Loading your prep log from GitHub…</p>`;
    return;
  }
  if (store.status === "error" && !store.state) {
    root.innerHTML = `<div class="card banner banner-bad"><p>Couldn't reach GitHub and no cached copy exists on this device yet.</p><p class="muted small">${store.error || ""}</p></div>`;
    return;
  }
  if (store.status === "conflict") {
    views.renderConflict(root, store, renderAll);
    return;
  }
  renderView();
  // Navigation buttons are markup any view can emit, so they're bound here
  // rather than in each view that happens to have one.
  views.wireNavigationTargets(root, actions);
}

function renderView() {
  if (SESSION_TABS[activeTab]) return SESSION_TABS[activeTab].render(root, store, actions);
  if (activeTab === "topicDetail") return views.renderTopicDetail(root, store, actions);
  if (STANDALONE[activeTab]) return STANDALONE[activeTab].render(root, store, actions);
  if (SECTIONS[activeTab]) return renderSectionIndex(root, SECTIONS[activeTab], actions);

  const owner = PAGE_TO_SECTION[activeTab];
  const page = owner && SECTIONS[owner].pages.find((p) => p.id === activeTab);
  if (page) return page.render(root, store, actions);

  return STANDALONE.dashboard.render(root, store, actions); // unknown/stale tab id
}

/** `s` from anywhere outside a session starts whatever the Dashboard is
 * recommending — the one action this app exists for shouldn't need navigating
 * to first. Returns false when there's genuinely nothing to start, so the
 * keypress falls through instead of appearing to do nothing. */
function startRecommendedSession() {
  if (!store.state || views.hasActiveSession()) return false;
  const rec = recommendSession(store.state);
  if (!rec || !rec.problem) return false;
  views.startSession(rec.problem);
  actions.switchTab("workspace");
  views.toast(`Started: ${rec.problem.name}`);
  return true;
}

document.getElementById("shortcut-hint")?.addEventListener("click", toggleHelp);

installShortcuts({
  switchTab: actions.switchTab,
  inSession: views.hasActiveSession,
  exitSession,
  startRecommended: startRecommendedSession,
  isReady: () => store.state != null,
});

const savedTheme = localStorage.getItem("ledger.theme");
if (savedTheme && savedTheme !== "system") document.documentElement.dataset.theme = savedTheme;

store.onChange(renderAll);
store.init();
renderAll();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline shell caching is a nicety, not a requirement */
    });
  });
}
