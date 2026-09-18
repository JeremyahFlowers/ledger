import { store } from "./store.js";
import * as views from "./views.js";
import { computePlantState } from "./logic.js";
import { plantSvg } from "./plant.js";

// Dashboard is the only real entry point into the guided path (session /
// reflect / warmup are reached only by button, never listed here — see
// SESSION_TABS below). Everything after it is the library: reference and
// analysis tools for browsing on your own terms.
const TABS = [
  { id: "dashboard", label: "Dashboard", render: views.renderDashboard },
  { id: "queue", label: "Review Queue", render: views.renderQueue },
  { id: "patterns", label: "Patterns", render: views.renderPatterns },
  { id: "topics", label: "Topics", render: views.renderTopics },
  { id: "quiz", label: "Quiz", render: views.renderQuiz },
  { id: "whiteboard", label: "Whiteboard", render: views.renderWhiteboard },
  { id: "journal", label: "Journal", render: views.renderJournal },
  { id: "leetcode", label: "LeetCode", render: views.renderLeetCode },
  { id: "systemDesign", label: "System Design", render: views.renderSystemDesign },
  { id: "log", label: "Log Manually", render: views.renderLog },
  { id: "settings", label: "Settings", render: views.renderSettings },
];

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

function renderNav() {
  const show = store.state != null;
  nav.hidden = !show;
  if (!show) return;

  if (SESSION_TABS[activeTab]) {
    nav.innerHTML = `
      <button class="tab session-exit" id="nav-exit">✕ Exit</button>
      <span class="session-nav-label">${SESSION_TABS[activeTab].label}</span>`;
    nav.querySelector("#nav-exit").addEventListener("click", exitSession);
    return;
  }

  nav.innerHTML = TABS.map(
    (t) => `<button class="tab ${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
  ).join("");
  nav.querySelectorAll("button").forEach((btn) => {
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
  if (SESSION_TABS[activeTab]) {
    SESSION_TABS[activeTab].render(root, store, actions);
    return;
  }
  const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
  tab.render(root, store, actions);
}

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
