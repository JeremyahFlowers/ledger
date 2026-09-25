// The only piece of the app that talks to GitHub or localStorage. Views call
// store.mutate() to change data and store.onChange() to know when to re-render;
// nothing else touches persistence directly.
import { GitHubStore } from "./github-client.js";
import { storageKey } from "./channel.js";
import { buildSeedState, migrateState } from "./seed.js";
import { syncFootprint, formatBytes, compareStates, inspectImport } from "./logic.js";

const CONFIG_KEY = storageKey("ledger.config");
const CACHE_KEY = storageKey("ledger.cache.state");
// Whether the cached copy holds changes that never reached GitHub.
//
// `dirty` lives in memory, so closing the tab forgot it. That made the whole
// offline story a lie: work on a train, the save fails, the work goes to the
// cache, you close the tab — and on the next open init() fetched the remote,
// adopted it, and overwrote the cache with it. The cached copy was read only
// when the fetch *failed*. An hour of practice, discarded without a word, by
// the app working correctly.
const PENDING_KEY = storageKey("ledger.cache.unsynced");
const SAVE_DEBOUNCE_MS = 1200;

// Retry schedule for a save that failed for a reason that might pass —
// offline, a flaky connection, GitHub having a moment. Backs off so a long
// outage doesn't mean a request every second for an hour, and stops rather
// than retrying forever, because a failure that survives four minutes is not
// going to be fixed by a fifth attempt.
//
// Why this exists: a failed save left the work in localStorage and the status
// at "offline" until the next mutation happened to trigger a flush. Close the
// tab in between and the only copy of that session was on that device.
const RETRY_DELAYS_MS = [5000, 15000, 45000, 120000];

// Failures that will not be fixed by waiting. Retrying a bad token or a log
// that is too large just produces the same error on a timer.
const PERMANENT_FAILURES = new Set(["conflict", "too_large", "no_workflow_scope"]);

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
    // When the last successful exchange with GitHub happened. Shown in
    // Settings: "Synced" alone says the last attempt worked, not whether it
    // was a minute ago or before you shut the laptop on Friday.
    this.lastSyncedAt = null;
    this.retryTimer = null;
    this.retryAttempt = 0;
    // Set when a reopen found work that had never reached GitHub. Read once
    // by the UI, which says so, and cleared.
    this.recovered = false;
    // Set when the remote file could not be parsed. Blocks saving, because a
    // save would overwrite the damaged file that is the only evidence left.
    this.blocked = false;
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
    localStorage.removeItem(PENDING_KEY);
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
      if (exists) this._checkRemote(state);
      if (!exists) {
        this.state = buildSeedState();
        await this.gh.saveState(this.state, "Ledger: initialize prep-data/state.json");
        this._cacheLocally();
      } else if (this._hasPendingWork() && this._readCache()) {
        this._recoverPendingWork(migrateState(state));
        return;                       // _recoverPendingWork emits and flushes
      } else {
        this.state = migrateState(state);
        this._cacheLocally();
      }
      this.status = "synced";
      this.lastSyncedAt = Date.now();
      this.error = null;
    } catch (err) {
      const cached = this._readCache();
      if (cached) this.state = migrateState(cached);
      // A file that can't be read is not the same failure as a network that
      // can't be reached, and must not be treated as one: "offline" means
      // keep working, we'll save later, and saving later would write over
      // whatever is actually in that file — which may be the only copy of
      // something recoverable. So this one blocks saving until a person has
      // looked.
      if (err.code === "unreadable_remote") {
        this.status = "error";
        this.blocked = true;
      } else {
        this.status = cached ? "offline" : "error";
      }
      this.error = err.message || String(err);
    }
    this._emit();
    this.loadLeetCodeStats(); // independent of whether the main state load succeeded
  }

  _cacheLocally() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.state));
      // Written together, so the flag can never outlive or lag the copy it
      // describes.
      localStorage.setItem(PENDING_KEY, this.dirty ? "1" : "");
    } catch (_) {
      /* storage full or unavailable — sync still works, just no offline fallback */
    }
  }

  /**
   * Check a state fetched from GitHub before letting it near the renderer.
   *
   * The import path has validated a chosen file since it was written, and the
   * sync path — the one that runs every single time the app opens — trusted
   * whatever came back. migrateState only backfills missing keys, so a
   * truncated write, a hand edit or a bad merge went straight into the views
   * and the first thing the user saw was a blank page.
   *
   * Throws rather than returning a flag, so no caller can adopt it by
   * forgetting to check.
   */
  _checkRemote(state) {
    const found = inspectImport(state);
    if (found.ok) {
      this.blocked = false;
      return state;
    }
    const err = new Error(
      `The log in your repo can't be read: ${found.errors.join(" ")} `
      + `Nothing here has been changed — open ${loadConfig().path} in your repo to see what's in it.`);
    err.code = "unreadable_remote";
    throw err;
  }

  /** Did this browser close with work that never reached GitHub? */
  _hasPendingWork() {
    try {
      return localStorage.getItem(PENDING_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  /**
   * Reconcile a cache that closed with unsaved changes against the remote.
   *
   * Two outcomes, and which one depends on whether the *remote* has attempts
   * this device has never seen:
   *
   *  - It doesn't. This device is simply ahead, so its copy is adopted and
   *    pushed. Nothing is lost and nothing needs deciding.
   *  - It does. Both sides have real work, which is the conflict screen's
   *    entire job — it can fetch both and say what each choice discards.
   *
   * The comparison is over attempts, which means an unsynced journal note on
   * one side and a newer one on the other will be resolved in this device's
   * favour without asking. That is deliberate: attempts are the substantive
   * record, and routing every ordinary offline edit through a conflict screen
   * would train people to click past it, which is how the real conflicts get
   * lost too.
   */
  _recoverPendingWork(remote) {
    const cached = migrateState(this._readCache());
    const diff = compareStates(cached, remote);

    this.state = cached;
    if (diff.attemptsOnlyThere > 0 && diff.attemptsOnlyHere > 0) {
      this.status = "conflict";
      this.error = "This device has work that never reached GitHub, and GitHub has work "
        + "this device hasn't seen. Nothing is lost yet — pick which to keep.";
      this.dirty = true;
      this._cacheLocally();
      this._emit();
      this.loadLeetCodeStats();
      return;
    }

    // Strictly ahead: push it, and say so rather than letting a silent save
    // be the only evidence that anything was at stake.
    this.dirty = true;
    this._cacheLocally();
    this.recovered = true;
    this._emit();
    this.flush("Ledger: upload work saved while offline");
    this.loadLeetCodeStats();
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
    // A new change restarts the backoff: it is a fresh attempt at fresh work,
    // not a continuation of whatever was failing before.
    this.retryAttempt = 0;
    this.saveTimer = setTimeout(() => this.flush(message), SAVE_DEBOUNCE_MS);
  }

  async flush(message) {
    if (!this.dirty || !this.gh) return;

    // Set when the file in the repo could not be parsed. Saving would replace
    // it, and whatever is wrong with it is the only remaining evidence of
    // what it held.
    if (this.blocked) {
      this.status = "error";
      this._emit();
      return;
    }

    // Checked here rather than left to the API. Crossing the limit fails the
    // save and every save after it, and a raw "422 too large" gives no way to
    // work out what to do about it. The work stays in localStorage either way;
    // the difference is whether the user is told something they can act on.
    const footprint = syncFootprint(this.state);
    if (footprint.over) {
      this._cancelRetry();      // retrying cannot make the file smaller
      this.status = "error";
      this.error = `Your prep log is ${formatBytes(footprint.total)}, past GitHub's `
        + `${formatBytes(footprint.limit)} limit for a single file, so it can't be saved. `
        + `See Settings for what's taking the room.`;
      this._emit();
      return;
    }

    this.status = "saving";
    this._emit();
    try {
      await this.gh.saveState(this.state, message);
      this.dirty = false;
      this.status = "synced";
      this.lastSyncedAt = Date.now();
      this.error = null;
      this._cancelRetry();
    } catch (err) {
      this.status = err.code === "conflict" ? "conflict" : "offline";
      this.error = err.message || String(err);
      if (!PERMANENT_FAILURES.has(err.code)) this._scheduleRetry(message);
    }
    this._emit();
  }

  /** Queue another attempt, backing off, until the schedule runs out. */
  _scheduleRetry(message) {
    clearTimeout(this.retryTimer);
    const delay = RETRY_DELAYS_MS[this.retryAttempt];
    if (delay === undefined) {
      // Out of attempts. Null rather than a stale id, so "is a retry pending"
      // is answerable by looking.
      this.retryTimer = null;
      return;
    }
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      // Still worth trying? A later mutate may have already saved it, and a
      // conflict needs the user rather than another attempt.
      if (this.dirty && this.status !== "conflict") this.flush(message);
    }, delay);
  }

  _cancelRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  /** Try again now, as the browser reports the network back. The backoff is
   * reset first: coming back online is new information, not another failure. */
  retryNow(message = "Ledger: retry save") {
    this._cancelRetry();
    if (this.dirty) this.flush(message);
  }

  /**
   * Read the server's version without touching local state.
   *
   * Used by the conflict screen to say what each option would discard. It
   * deliberately doesn't adopt the result or refresh the stored sha — looking
   * must not change which resolution the user then gets.
   */
  async peekRemoteState() {
    if (!this.gh) throw new Error("Not connected.");
    const { exists, state } = await this.gh.fetchState();
    return exists ? state : null;
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
      this.state = migrateState(this._checkRemote(state));
      this.dirty = false;
      this._cacheLocally();
      this.status = "synced";
      this.lastSyncedAt = Date.now();
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

  /**
   * Reads a problem statement the LeetCode sync Action fetched, or null.
   *
   * Statements live as one file per problem rather than inside state.json,
   * which has to stay under the Contents API's 1 MB limit — see
   * scripts/fetch_leetcode_statements.py in the data repo. Never throws: a
   * statement that hasn't been fetched yet just means the workspace offers its
   * paste box, which is a normal state and not an error.
   */
  async fetchStatement(slug) {
    if (!this.gh || !slug) return null;
    try {
      const record = await this.gh.fetchPublicFile(`prep-data/statements/${slug}.json`);
      return record?.statement || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Re-read the remote and adopt it.
   *
   * The only way to pick up a change made on another device was to reload the
   * page, and there was no way to retry after a failed push without making
   * another change first. Refuses while there are unsaved local changes rather
   * than choosing for the user which side to keep — that decision belongs to
   * the conflict screen, which can show what each option discards.
   */
  async refreshFromRemote() {
    if (!this.gh) throw new Error("Not connected.");
    if (this.dirty) {
      const err = new Error("You have unsaved changes — they'd be lost. Let them sync first.");
      err.code = "dirty";
      throw err;
    }
    this.status = "loading";
    this._emit();
    try {
      const { exists, state } = await this.gh.fetchState();
      if (exists && state) this.state = migrateState(this._checkRemote(state));
      this.status = "synced";
      this.lastSyncedAt = Date.now();
      this.error = null;
      this._cacheLocally();
    } catch (err) {
      this.status = "offline";
      this.error = err.message || String(err);
      throw err;
    } finally {
      this._emit();
    }
  }

  /** The workflow file in the data repo that fetches problem statements. */
  static STATEMENTS_WORKFLOW = "leetcode-sync.yml";

  /** Ask the data repo to fetch statements now rather than on its schedule. */
  async requestStatements() {
    if (!this.gh) throw new Error("Not connected.");
    return this.gh.dispatchWorkflow(Store.STATEMENTS_WORKFLOW);
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
