import { store } from "./store.js";
import * as views from "./views.js";

const TABS = [
  { id: "dashboard", label: "Dashboard", render: views.renderDashboard },
  { id: "log", label: "Log Session", render: views.renderLog },
  { id: "queue", label: "Review Queue", render: views.renderQueue },
  { id: "patterns", label: "Patterns", render: views.renderPatterns },
  { id: "mock", label: "Mock Interview", render: views.renderMock },
  { id: "journal", label: "Journal", render: views.renderJournal },
  { id: "systemDesign", label: "System Design", render: views.renderSystemDesign },
  { id: "settings", label: "Settings", render: views.renderSettings },
];

let activeTab = localStorage.getItem("ledger.activeTab") || "dashboard";

const nav = document.getElementById("tab-nav");
const root = document.getElementById("view-root");
const statusEl = document.getElementById("sync-status");

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

function renderNav() {
  const show = store.state != null;
  nav.hidden = !show;
  if (!show) return;
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

function renderAll() {
  renderNav();
  renderStatus();

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
