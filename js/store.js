// The only piece of the app that talks to GitHub or localStorage. Views call
// store.mutate() to change data and store.onChange() to know when to re-render;
// nothing else touches persistence directly.
import { GitHubStore } from "./github-client.js";
import { buildSeedState, migrateState } from "./seed.js";

const CONFIG_KEY = "ledger.config";
const CACHE_KEY = "ledger.cache.state";
const SAVE_DEBOUNCE_MS = 1200;

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

class Store {
  constructor() {
    this.state = null;
    this.status = "unconfigured"; // unconfigured | loading | synced | saving | offline | conflict | error
    this.error = null;
    this.listeners = new Set();
    this.saveTimer = null;
    this.dirty = false;
    this.gh = null;
    this.leetcode = null; // { status: 'idle'|'loading'|'ready'|'error', data, error }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    this.listeners.forEach((fn) => fn());
  }

  isConfigured() {
    const cfg = loadConfig();
    return !!(cfg.owner && cfg.repo && cfg.token && cfg.path);
  }

  configure(cfg) {
    saveConfig(cfg);
    this.gh = new GitHubStore(cfg);
  }

  disconnect() {
    clearConfig();
    localStorage.removeItem(CACHE_KEY);
    this.gh = null;
    this.state = null;
    this.status = "unconfigured";
    this._emit();
  }

  async init() {
    const cfg = loadConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token || !cfg.path) {
      this.status = "unconfigured";
      this._emit();
      return;
    }
    this.gh = new GitHubStore(cfg);
    this.status = "loading";
    this._emit();
    try {
      const { exists, state } = await this.gh.fetchState();
      if (exists) {
        this.state = migrateState(state);
      } else {
        this.state = buildSeedState();
        await this.gh.saveState(this.state, "Ledger: initialize prep-data/state.json");
      }
      this._cacheLocally();
      this.status = "synced";
      this.error = null;
    } catch (err) {
      const cached = this._readCache();
      if (cached) {
        this.state = migrateState(cached);
        this.status = "offline";
      } else {
        this.status = "error";
      }
      this.error = err.message || String(err);
    }
    this._emit();
    this.loadLeetCodeStats(); // independent of whether the main state load succeeded
  }

  _cacheLocally() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.state));
    } catch (_) {
      /* storage full or unavailable — sync still works, just no offline fallback */
    }
  }

  _readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /** Apply a synchronous mutation to state, re-render immediately, and
   * schedule a debounced save to GitHub. */
  mutate(fn, message) {
    fn(this.state);
    this.dirty = true;
    this._cacheLocally();
    this._emit();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(message), SAVE_DEBOUNCE_MS);
  }

  async flush(message) {
    if (!this.dirty || !this.gh) return;
    this.status = "saving";
    this._emit();
    try {
      await this.gh.saveState(this.state, message);
      this.dirty = false;
      this.status = "synced";
      this.error = null;
    } catch (err) {
      this.status = err.code === "conflict" ? "conflict" : "offline";
      this.error = err.message || String(err);
    }
    this._emit();
  }

  async resolveConflictKeepMine() {
    try {
      await this.gh.fetchState(); // refresh sha, discard the fetched body — ours wins
      this.dirty = true;
      await this.flush("Ledger: resolve sync conflict, keep local changes");
    } catch (err) {
      this.status = "error";
      this.error = err.message || String(err);
      this._emit();
    }
  }

  async resolveConflictTakeTheirs() {
    try {
      const { state } = await this.gh.fetchState();
      this.state = migrateState(state);
      this.dirty = false;
      this._cacheLocally();
      this.status = "synced";
      this.error = null;
    } catch (err) {
      this.status = "error";
      this.error = err.message || String(err);
    }
    this._emit();
  }

  /** Best-effort load of the read-only prep-data/leetcode-stats.json a
   * GitHub Action writes daily. Never blocks the main state load and never
   * throws — a missing or stale file just means the LeetCode tab shows its
   * empty state instead of breaking the rest of the app. */
  async loadLeetCodeStats() {
    if (!this.gh) return;
    this.leetcode = { status: "loading", data: null, error: null };
    this._emit();
    try {
      const data = await this.gh.fetchPublicFile("prep-data/leetcode-stats.json");
      this.leetcode = data
        ? { status: "ready", data, error: null }
        : { status: "empty", data: null, error: null };
    } catch (err) {
      this.leetcode = { status: "error", data: null, error: err.message || String(err) };
    }
    this._emit();
  }

  /** Saves a PNG (as a data URL) as a brand-new file in the repo — used by
   * the whiteboard. Binary assets are stored outside state.json so the main
   * sync document stays small; only a path reference lives in state. */
  async saveWhiteboardImage(path, dataUrl, message) {
    if (!this.gh) throw new Error("Not connected.");
    const base64 = dataUrl.split(",")[1];
    await this.gh.createBinaryFile(path, base64, message);
  }
}

export const store = new Store();
