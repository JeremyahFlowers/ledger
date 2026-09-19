import {
  todayISO, applyOutcome, activateProblem, dueProblems, planToday, allAttempts, patternStats, progressSummary, PLANT_STAGES, compareStates,
  updateStreak, systemDesignUnlock, uid, MISTAKE_TAGS, MOCK_CHECKLIST, daysBetween,
  activityByDate, patternTrend, pickQuizProblem, quizOptions, addDaysISO, recommendSession,
  computePlantState,
} from "./logic.js";
import { TOPICS } from "./topics-content.js";
import { loadCodeMirror, CODE_MODES } from "./codemirror-loader.js";
import { createWhiteboard } from "./whiteboard.js";
import { plantSvg } from "./plant.js";
import { patternIcon, navIcon } from "./icons.js";
import { problemUrl } from "./catalog.js";

/**
 * The diagram renderer and its worked examples, fetched on first use.
 *
 * Together they're the heaviest thing in the bundle — about 70 KB of the 394 KB
 * the app loads — and they are needed on exactly one screen. Loading them
 * eagerly meant everyone paid for them to open the Dashboard and start a
 * session. Memoized, so moving between topic pages fetches nothing.
 */
let diagramModules = null;
function loadDiagramModules() {
  if (!diagramModules) {
    diagramModules = Promise.all([
      import("./diagrams.js"),
      import("./diagram-data.js"),
    ]).then(([renderers, data]) => ({
      mounters: {
        array: renderers.arrayDiagram,
        stack: renderers.stackDiagram,
        grid: renderers.gridDiagram,
        graph: renderers.graphDiagram,
      },
      specs: data.DIAGRAM_SPECS,
    })).catch((err) => {
      diagramModules = null; // a failed load shouldn't be permanent
      throw err;
    });
  }
  return diagramModules;
}

const VITALITY_LABEL = { thriving: "Thriving", steady: "Steady", stressed: "Stressed", wilting: "Wilting" };

function plantCardHtml(plant) {
  const { signals } = plant;
  const issues = [];
  if (signals.overdueCount > 0) issues.push(`${signals.overdueCount} problem${signals.overdueCount === 1 ? "" : "s"} overdue 7+ days — reviews are slipping`);
  if (signals.overloaded) issues.push(`Today's volume is past a healthy single sitting`);
  if (signals.daysSinceActive >= 3) issues.push(`${signals.daysSinceActive} days since last practice`);
  return `
    <div class="card plant-card">
      ${plantSvg(plant.stage, plant.vitality, { size: 130 })}
      <div class="plant-info">
        <div class="plant-stage-row">
          <span class="plant-stage-name">${esc(plant.stageLabel)}</span>
          <span class="plant-vitality-label ${plant.vitality}">${VITALITY_LABEL[plant.vitality]}</span>
        </div>
        <p class="muted small">${plant.nextStageLabel ? `${plant.daysToNextStage} more practice day${plant.daysToNextStage === 1 ? "" : "s"} to ${esc(plant.nextStageLabel)}` : "Fully grown"} · ${plant.totalDaysPracticed} days practiced, ever</p>
        <ul class="plant-signals">
          <li>${signals.activeDaysInWindow}/${signals.windowDays} days active in the last two weeks</li>
          <li>${signals.recallRate != null ? `${pct(signals.recallRate)} pattern-recall accuracy recently` : "Answer a few pattern-recall questions to start tracking this"}</li>
          ${issues.map((i) => `<li>${esc(i)}</li>`).join("")}
        </ul>
        ${growthPathHtml(plant)}
      </div>
    </div>`;
}

/**
 * The whole growth path, with where you are marked.
 *
 * Stages are reached by practising on distinct days, which means the later ones
 * are months away — and a reward you can't see isn't motivating. Showing the
 * road makes the slow axis legible, and it's the honest one: stage is the only
 * thing here that a single heavy weekend cannot move.
 */
function growthPathHtml(plant) {
  const reachedIndex = PLANT_STAGES.findIndex((s) => s.key === plant.stage);
  return `
    <ol class="growth-path" aria-label="Growth stages, currently ${esc(plant.stageLabel)}">
      ${PLANT_STAGES.map((stage, i) => {
        const state = i < reachedIndex ? "past" : i === reachedIndex ? "current" : "future";
        return `
        <li class="growth-step ${state}" title="${esc(stage.label)}${state === "future" ? ` — ${stage.min} practice days` : ""}">
          ${plantSvg(stage.key, state === "future" ? "stressed" : plant.vitality, { size: 26, decorative: true })}
          <span class="growth-step-label">${esc(stage.label)}</span>
        </li>`;
      }).join("")}
    </ol>`;
}

// Cross-tab handoff: "Log a rep" buttons elsewhere set this, renderLog reads
// and clears it. A single module-level slot is enough for a single-user app.
export const nav = { prefillProblemId: null };

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/**
 * Escaped text with markdown-style `inline code` marked up.
 *
 * The topic content is written as prose with backticks around identifiers —
 * "Using `if` to shrink when the window needs a `while`" — and rendering it
 * through esc() alone put literal backticks on screen. Escaping happens first
 * and the only markup introduced afterwards is <code>, so this cannot be used
 * to inject anything: by the time the replacement runs there are no angle
 * brackets left to close.
 */
export function richText(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function pct(x) {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}
function mins(x) {
  return x == null ? "—" : `${Math.round(x)} min`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}
function overdueLabel(iso) {
  if (!iso) return "new";
  const diff = daysBetween(iso, todayISO());
  if (diff === 0) return "due today";
  if (diff > 0) return `${diff}d overdue`;
  return `due in ${-diff}d`;
}
function patternName(state, id) {
  return state.patterns.find((p) => p.id === id)?.name || id;
}
/** GitHub-style activity heatmap. `counts` maps "YYYY-MM-DD" -> a number;
 * `unixDayCounts`, if given, is LeetCode's format (unix-day-in-seconds keys)
 * instead, so the same renderer works for both Ledger's own activity and the
 * LeetCode submission calendar. */
function heatmapSvg(counts, { weeks = 20 } = {}) {
  const cell = 11, gap = 3;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = weeks * 7;
  const start = new Date(today);
  start.setDate(start.getDate() - days + 1);
  // align start to a Sunday so weeks form clean columns
  start.setDate(start.getDate() - start.getDay());
  const max = Math.max(1, ...Object.values(counts));
  let rects = "";
  let d = new Date(start);
  let col = 0;
  while (d <= today) {
    for (let row = 0; row < 7; row++) {
      if (d > today) break;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const n = counts[iso] || 0;
      const alpha = n === 0 ? 0 : 0.25 + 0.75 * Math.min(1, n / max);
      rects += `<rect x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" rx="2"
        fill="var(--accent)" fill-opacity="${n === 0 ? 0.08 : alpha.toFixed(2)}"><title>${iso}: ${n}</title></rect>`;
      d.setDate(d.getDate() + 1);
    }
    col++;
  }
  const width = col * (cell + gap);
  const height = 7 * (cell + gap);
  // role="img" with one summary, because the alternative is a screen reader
  // reading out every cell — a 20-week heatmap is 140 of them, almost all
  // "0 on a date you did nothing", which is worse than no chart at all.
  const activeDays = Object.values(counts).filter((n) => n > 0).length;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const label = activeDays
    ? `Activity heatmap: ${total} across ${activeDays} active day${activeDays === 1 ? "" : "s"} in the last ${weeks} weeks.`
    : `Activity heatmap: nothing recorded in the last ${weeks} weeks.`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMin meet" class="heatmap" role="img" aria-label="${esc(label)}">${rects}</svg>`;
}

/** Converts LeetCode's unix-day-seconds submissionCalendar keys into
 * YYYY-MM-DD so heatmapSvg can treat it the same as Ledger's own data. */
function leetcodeCalendarToDateCounts(calendar) {
  const out = {};
  for (const [unixSec, count] of Object.entries(calendar || {})) {
    const d = new Date(Number(unixSec) * 1000);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    out[iso] = (out[iso] || 0) + count;
  }
  return out;
}

/**
 * An empty section that says what goes here and how to fill it.
 *
 * "Nothing saved yet" is true and useless — it tells you a place is empty
 * without telling you what would put something in it, which on a first run is
 * most of the app. Every empty state gets a line explaining what the thing is
 * for and, where there's an obvious next step, a button that takes it.
 *
 * `action` is `{ tab, label }`; wireNavigationTargets() binds it.
 */
function emptyState(icon, headline, explanation, action = null) {
  return `
    <div class="empty-state">
      <span class="empty-state-icon">${navIcon(icon, { size: 22 })}</span>
      <p class="empty-state-headline">${esc(headline)}</p>
      <p class="muted small">${esc(explanation)}</p>
      ${action ? `<button class="btn btn-ghost btn-sm" data-goto="${esc(action.tab)}">${esc(action.label)}</button>` : ""}
    </div>`;
}

/**
 * Binds every `data-goto="<tab>"` control in the rendered view.
 *
 * Called once centrally from app.js after each render, so any view can emit a
 * navigation button as plain markup and it simply works — no per-view wiring,
 * and no second mechanism to remember. Safe on a view with none.
 */
export function wireNavigationTargets(root, actions) {
  root.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => actions.switchTab(btn.dataset.goto));
  });
}

/**
 * One sentence on the dashboard connecting today's work to the trajectory.
 *
 * The streak card answers "did I show up"; without this, nothing on the page
 * answers "is any of it working" — you had to go looking for that, which means
 * mostly not seeing it. Silent until there's genuinely a trend, because a
 * number invented from two attempts would be worse than no number.
 */
function trendLineHtml(state) {
  const summary = progressSummary(state);
  if (!summary.hasEnoughData || summary.cleanRateDelta == null) return "";

  const points = Math.round(summary.cleanRateDelta * 100);
  const faster = summary.insightDelta != null && summary.insightDelta <= -1
    ? `, and you're reaching the approach ${Math.abs(summary.insightDelta).toFixed(0)} min faster`
    : "";
  const direction = Math.abs(points) < 3 ? "steady" : points > 0 ? "up" : "down";
  const phrase = direction === "steady"
    ? "Clean-solve rate holding steady"
    : `Clean-solve rate ${direction} ${Math.abs(points)} pts`;

  return `
    <p class="trend-line ${direction}" style="margin:0.6rem 0 0">
      <span class="trend-arrow" aria-hidden="true">${direction === "up" ? "&#8599;" : direction === "down" ? "&#8600;" : "&#8594;"}</span>
      ${esc(phrase)}${esc(faster)} over ${summary.activeWeeks} active week${summary.activeWeeks === 1 ? "" : "s"}.
      <button type="button" class="link-button" data-goto="progress">See progress</button>
    </p>`;
}

function sparklineSvg(points, { width = 80, height = 22 } = {}) {
  if (!points.length) return "";
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((v, i) => `${(i * step).toFixed(1)},${(height - v * height).toFixed(1)}`).join(" ");
  // Purely illustrative — it always sits beside the same figure in text, so
  // announcing it a second time as a shape adds nothing.
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="sparkline" aria-hidden="true"><polyline points="${coords}" /></svg>`;
}

/** A small circular progress ring — the recurring visual for "how much of
 * X" (budget used, mastery, unlock progress, accuracy) so those numbers
 * read as a shape before they read as digits. */
function ringSvg(fraction, { size = 44, stroke = 5, color = "var(--accent)", label = "" } = {}) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction ?? 0));
  return `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - f)}"
        transform="rotate(-90 ${c} ${c})"/>
      ${label ? `<text x="${c}" y="${c + 4}" text-anchor="middle" class="ring-label" style="font-size:${label.length >= 4 ? size / 4.2 : size / 3.4}px">${esc(label)}</text>` : ""}
    </svg>`;
}

const OUTCOME_GLYPH = {
  "solved-clean": { symbol: "✓", cls: "outcome-good", title: "Solved clean" },
  "solved-struggled": { symbol: "~", cls: "outcome-warn", title: "Solved, struggled" },
  failed: { symbol: "✕", cls: "outcome-bad", title: "Didn't solve" },
};
/** A small colored glyph standing in for an outcome — lets a list of past
 * attempts be scanned by shape/color before reading a single word. */
function outcomeIcon(outcome) {
  const g = OUTCOME_GLYPH[outcome];
  if (!g) return "";
  return `<span class="outcome-icon ${g.cls}" title="${esc(g.title)}">${g.symbol}</span>`;
}

/** A compact 7-day habit strip — today on the right, filled dots for days
 * with any logged activity. Cheap, glanceable "did I actually show up this
 * week" that a streak number alone doesn't convey. */
function weekStripSvg(state) {
  const activity = activityByDate(state);
  const today = todayISO();
  const cell = 12, gap = 4;
  let rects = "";
  let activeCount = 0;
  for (let i = 6; i >= 0; i--) {
    const d = addDaysISO(today, -i);
    const on = !!activity[d];
    if (on) activeCount += 1;
    const x = (6 - i) * (cell + gap);
    rects += `<rect x="${x}" y="0" width="${cell}" height="${cell}" rx="3" fill="${on ? "var(--accent)" : "var(--surface-alt)"}"><title>${d}${on ? " — practiced" : ""}</title></rect>`;
  }
  const width = 7 * (cell + gap) - gap;
  return `<svg viewBox="0 0 ${width} ${cell}" width="${width}" height="${cell}" class="week-strip" role="img"
    aria-label="Practised on ${activeCount} of the last 7 days.">${rects}</svg>`;
}

export function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- Setup / connect ----------

export function renderSetup(root, store) {
  root.innerHTML = `
    <div class="card setup-card">
      <h2>Connect Ledger to GitHub</h2>
      <p class="muted">Your practice log lives as a JSON file in a private GitHub repo you own. Every save
      is a real commit — full history, free, no server, works from any device with this page open.</p>
      <ol class="setup-steps">
        <li>Create a new <strong>private</strong> repo on GitHub (or reuse this <code>leetcode</code> repo
          once it's pushed) — this is where your data and this app will both live.</li>
        <li>Push this repo, then in <strong>Settings → Pages</strong>, set source to the <code>docs/</code>
          folder on your default branch. That gives you the URL to open on any device.</li>
        <li>Generate a <strong>fine-grained personal access token</strong> at
          github.com/settings/tokens?type=beta, scoped to just this one repo, with
          <strong>Contents: Read and write</strong> permission and nothing else.</li>
        <li>Fill in the fields below on <em>this</em> device. You'll repeat this step (paste the same
          token) on every device you want synced.</li>
      </ol>
      <form id="setup-form" class="form">
        <label class="field"><span class="label">GitHub username / org</span>
          <input class="input" name="owner" required placeholder="e.g. gamingprophs" /></label>
        <label class="field"><span class="label">Repository name</span>
          <input class="input" name="repo" required placeholder="leetcode" /></label>
        <label class="field"><span class="label">Branch</span>
          <input class="input" name="branch" required value="main" /></label>
        <label class="field"><span class="label">Data file path</span>
          <input class="input" name="path" required value="prep-data/state.json" /></label>
        <label class="field"><span class="label">Personal access token</span>
          <input class="input" name="token" type="password" required placeholder="github_pat_…" /></label>
        <button class="btn btn-primary" type="submit">Connect</button>
        <p class="muted small">Stored only in this browser's localStorage. Never sent anywhere but
        api.github.com, directly from your device.</p>
      </form>
    </div>`;
  root.querySelector("#setup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    store.configure({
      owner: f.get("owner").trim(),
      repo: f.get("repo").trim(),
      branch: f.get("branch").trim() || "main",
      path: f.get("path").trim() || "prep-data/state.json",
      token: f.get("token").trim(),
    });
    store.init();
  });
}

export function renderConflict(root, store, rerender) {
  // Both options here permanently discard one side of the user's own practice
  // history, and the screen used to present that choice blind. Fetching the
  // other version read-only first turns it into an informed one — and usually
  // a reassuring one, since most conflicts are a device a few minutes stale
  // rather than real work on both sides.
  const render = (diff, error) => {
    const side = (label, summary) => summary ? `
      <div class="conflict-side">
        <h3 class="small-heading">${label}</h3>
        <p class="small">${summary.attempts} logged attempt${summary.attempts === 1 ? "" : "s"}
        across ${summary.problems} problem${summary.problems === 1 ? "" : "s"}${summary.soulStatements
          ? `, ${summary.soulStatements} with a soul statement` : ""}.</p>
        <p class="muted small">${summary.lastActivity ? `Last activity ${fmtDate(summary.lastActivity)}` : "No activity recorded"}</p>
      </div>` : `
      <div class="conflict-side"><h3 class="small-heading">${label}</h3>
      <p class="muted small">Couldn't be read.</p></div>`;

    root.innerHTML = `
      <div class="card">
        <h2>Sync conflict</h2>
        <p>The file on GitHub changed since this device last loaded it — usually a save from another
        device. Nothing has been overwritten; pick which version to keep.</p>

        ${diff ? verdictHtml(diff) : `<p class="muted small">${error
          ? `Couldn't read the other version to compare (${esc(error)}). Both options below still work, but
             this device can't tell you what they'd discard — export a copy first if it matters.`
          : "Comparing the two versions…"}</p>`}

        ${diff ? `<div class="two-col conflict-compare">
          ${side("On this device", diff.mine)}
          ${side("On GitHub", diff.theirs)}
        </div>` : ""}

        <div class="row gap" style="margin-top:1rem">
          <button class="btn btn-primary" id="keep-mine">Keep this device's version</button>
          <button class="btn btn-ghost" id="take-theirs">Use the version on GitHub</button>
          <button class="btn btn-ghost" id="conflict-export">Download this device's copy first</button>
        </div>
      </div>`;

    root.querySelector("#keep-mine").addEventListener("click", async () => {
      if (!confirmDiscard(diff, "theirs")) return;
      await store.resolveConflictKeepMine();
      rerender();
    });
    root.querySelector("#take-theirs").addEventListener("click", async () => {
      if (!confirmDiscard(diff, "mine")) return;
      await store.resolveConflictTakeTheirs();
      rerender();
    });
    root.querySelector("#conflict-export").addEventListener("click", () => {
      downloadState(store.state);
      toast("Saved a copy of this device's data.");
    });
  };

  render(null, null);
  // Read-only: this never writes, so looking costs nothing even if the user
  // then picks the other side.
  store.peekRemoteState()
    .then((remote) => render(compareStates(store.state, remote), null))
    .catch((err) => render(null, err.message || String(err)));
}

/** The headline: what, if anything, is actually at risk. */
function verdictHtml(diff) {
  if (diff.identical) {
    return `<p class="banner banner-good small">Both versions contain the same logged attempts —
      whichever you pick, nothing is lost.</p>`;
  }
  if (diff.safeChoice === "theirs") {
    return `<p class="banner banner-good small">The GitHub version has
      ${diff.attemptsOnlyThere} attempt${diff.attemptsOnlyThere === 1 ? "" : "s"} this device doesn't,
      and this device has none that it's missing. Using the GitHub version loses nothing.</p>`;
  }
  if (diff.safeChoice === "mine") {
    return `<p class="banner banner-good small">This device has
      ${diff.attemptsOnlyHere} attempt${diff.attemptsOnlyHere === 1 ? "" : "s"} GitHub doesn't,
      and GitHub has none this device is missing. Keeping this device's version loses nothing.</p>`;
  }
  return `<p class="banner banner-warn small">Both versions have work the other doesn't —
    ${diff.attemptsOnlyHere} attempt${diff.attemptsOnlyHere === 1 ? "" : "s"} only here and
    ${diff.attemptsOnlyThere} only on GitHub. Whichever you choose, the other side's attempts go.
    Download a copy first if you'd rather not lose either.</p>`;
}

function confirmDiscard(diff, losing) {
  const count = losing === "mine" ? diff?.attemptsOnlyHere : diff?.attemptsOnlyThere;
  if (!count) return true; // nothing unique on the side being dropped
  const where = losing === "mine" ? "this device" : "GitHub";
  const plural = count === 1 ? { s: "", verb: "exists" } : { s: "s", verb: "exist" };
  return confirm(`This discards ${count} logged attempt${plural.s} that only ${plural.verb} on ${where}. Continue?`);
}

/** Shared by Settings and the conflict screen. */
function downloadState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ledger-export-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function renderDashboard(root, store, actions) {
  const state = store.state;
  const rec = recommendSession(state);
  const plant = computePlantState(state);
  const { plan, overflow, usedMin, budgetMin } = planToday(state);
  const stats = patternStats(state).filter((s) => s.attempts > 0).sort((a, b) => a.solvedCleanRate - b.solvedCleanRate);
  const weakest = stats.slice(0, 2);
  const sd = systemDesignUnlock(state);
  const REC_LABEL = { "first-rep": "Recommended", "deep-dive": "Recommended — repeated weak spot", "stale-nudge": "Recommended — review", due: "Up next", none: "" };

  root.innerHTML = `
    ${plantCardHtml(plant)}
    <div class="card session-cta-card">
      <div class="row space-between session-cta-row">
        <div>
          <h2>${REC_LABEL[rec.type] || "Today's session"}</h2>
          <p class="muted">${esc(rec.message)}</p>
        </div>
        <div class="row gap-sm">
          <button class="btn btn-ghost" id="cta-warmup">5-min warmup</button>
          ${rec.type === "deep-dive" || rec.type === "stale-nudge" ? `<button class="btn btn-ghost" data-tab="topics">Review pattern</button>` : ""}
          ${rec.problem ? `<button class="btn btn-primary" id="cta-start">${rec.type === "deep-dive" ? "Drill it" : "Start session"}</button>` : ""}
        </div>
      </div>
    </div>

    <div class="grid dashboard-grid">
      <div class="card streak-card">
        <div class="row space-between" style="align-items:center; flex-wrap:wrap; gap:1rem">
          <div class="stat-row">
            <div class="stat"><span class="stat-num">${state.streak.current}</span><span class="stat-label">day streak</span></div>
            <div class="stat"><span class="stat-num">${state.streak.longest}</span><span class="stat-label">longest</span></div>
          </div>
          <div class="row gap-sm" style="align-items:center">
            ${ringSvg(budgetMin ? usedMin / budgetMin : 0, { size: 40, stroke: 4 })}
            <span class="stat-label">${usedMin}/${budgetMin} min<br/>planned today</span>
          </div>
        </div>
        <p class="muted small" style="margin:0.6rem 0 0">Last 7 days</p>
        ${weekStripSvg(state)}
        ${trendLineHtml(state)}
      </div>

      <div class="card">
        <h2>Today's plan</h2>
        ${plan.length === 0 ? `<p class="empty">Nothing due right now.</p>` : `
        <ul class="queue-list">
          ${plan.map((p) => queueItemHtml(state, p)).join("")}
        </ul>`}
        ${overflow.length ? `<p class="muted small">${overflow.length} more due but over today's ${budgetMin}-min budget — see Review Queue.</p>` : ""}
      </div>

      <div class="card">
        <h2>Weakest patterns</h2>
        ${weakest.length === 0 ? `<p class="empty">Not enough attempts yet to tell.</p>` : `
        <ul class="pattern-mini-list">
          ${weakest.map((s) => `
            <li>
              <div class="row space-between"><span class="row gap-sm" style="align-items:center"><span class="pattern-icon">${patternIcon(s.pattern.id, { size: 16 })}</span><strong>${esc(s.pattern.name)}</strong></span><span>${pct(s.solvedCleanRate)} clean-solve</span></div>
              <div class="bar"><div class="bar-fill" style="width:${Math.round((s.solvedCleanRate || 0) * 100)}%"></div></div>
            </li>`).join("")}
        </ul>`}
        <div class="row gap-sm">
          <button class="btn btn-ghost" data-tab="patterns">See all patterns</button>
          <button class="btn btn-ghost" data-tab="topics">Browse topics</button>
        </div>
      </div>

      <div class="card">
        <h2>System design track</h2>
        <p class="muted small">${sd.mocksLogged}/${sd.minMocks} mocks logged · ${pct(sd.recentSolvedCleanRate)} clean-solve on recent mocks (need ${pct(sd.minSolvedCleanRate)})</p>
        <span class="badge ${sd.unlocked ? "badge-good" : "badge-warn"}">${sd.unlocked ? "Unlocked" : "Not yet"}</span>
      </div>

      <div class="card">
        <h2>Activity</h2>
        ${heatmapSvg(activityByDate(state))}
        <p class="muted small">Every logged rep, mock, and system design session, last 20 weeks.</p>
      </div>
    </div>`;

  wireTabButtons(root, actions);
  wireStartButtons(root, store, actions);

  const startBtn = root.querySelector("#cta-start");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startSession(rec.problem);
      actions.switchTab("workspace");
    });
  }
  root.querySelector("#cta-warmup").addEventListener("click", () => {
    resetWarmup();
    actions.switchTab("warmup");
  });
}

function queueItemHtml(state, p) {
  return `
    <li class="queue-item">
      <div>
        <div class="row gap-sm">
          <span class="pill pill-icon"><span class="pattern-icon">${patternIcon(p.patternId, { size: 14 })}</span>${esc(patternName(state, p.patternId))}</span>
          <span class="pill pill-muted">${esc(p.difficulty)}</span>
          <span class="pill ${overdueLabel(p.nextReviewDate).includes("overdue") ? "pill-warn" : "pill-muted"}">${overdueLabel(p.nextReviewDate)}</span>
        </div>
        <div class="queue-name">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}${p.number ? ` <span class="muted">#${p.number}</span>` : ""}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-start-problem="${esc(p.id)}">Start</button>
    </li>`;
}

function wireTabButtons(root, actions) {
  root.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => actions.switchTab(btn.dataset.tab));
  });
}
/** Wires every "Start" button rendered by queueItemHtml — the single entry
 * point into a guided session, used from Dashboard, Review Queue, and the
 * Topics practice ladder alike. */
function wireStartButtons(root, store, actions) {
  root.querySelectorAll("[data-start-problem]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const problem = store.state.problems.find((p) => p.id === btn.dataset.startProblem);
      if (!problem) return;
      startSession(problem);
      actions.switchTab("workspace");
    });
  });
}

// ---------- Review Queue ----------

export function renderQueue(root, store, actions) {
  const state = store.state;
  const due = dueProblems(state);
  const today = todayISO();
  const buckets = { today: 0, mild: 0, stale: 0 }; // due today, 1-6d overdue, 7d+ overdue
  due.forEach((p) => {
    const d = p.nextReviewDate ? daysBetween(p.nextReviewDate, today) : 0;
    if (d <= 0) buckets.today++;
    else if (d < 7) buckets.mild++;
    else buckets.stale++;
  });
  const total = due.length || 1;
  root.innerHTML = `
    <div class="card">
      <h2>Review queue</h2>
      <p class="muted">Weakest / most-overdue first. Today's budget is ${state.settings.dailyBudgetMin} min.</p>
      ${due.length > 0 ? `
      <div class="backlog-bar">
        <div class="backlog-seg" style="width:${(buckets.today / total) * 100}%; background:var(--accent)"></div>
        <div class="backlog-seg" style="width:${(buckets.mild / total) * 100}%; background:var(--warn)"></div>
        <div class="backlog-seg" style="width:${(buckets.stale / total) * 100}%; background:var(--bad)"></div>
      </div>
      <div class="backlog-legend">
        <span style="--_c:var(--accent)">${buckets.today} due today</span>
        <span style="--_c:var(--warn)">${buckets.mild} overdue 1–6d</span>
        <span style="--_c:var(--bad)">${buckets.stale} overdue 7d+ — slipping</span>
      </div>` : ""}
      ${due.length === 0 ? `<p class="empty">Queue's clear.</p>` : `
      <ul class="queue-list">${due.map((p) => queueItemHtml(state, p)).join("")}</ul>`}
    </div>`;
  wireStartButtons(root, store, actions);
}

// ---------- Log Session ----------

export function renderLog(root, store, actions) {
  const state = store.state;
  const prefill = nav.prefillProblemId;
  const prefillName = nav.prefillName || "";
  const prefillUrl = nav.prefillUrl || "";
  nav.prefillProblemId = null;
  nav.prefillName = null;
  nav.prefillUrl = null;
  const problemsByPattern = state.patterns.map((pat) => ({
    pat, problems: state.problems.filter((p) => p.patternId === pat.id),
  }));

  root.innerHTML = `
    <div class="card">
      <h2>Log a past rep</h2>
      <p class="muted">For something you already solved elsewhere — a LeetCode submission, a whiteboard
      interview, working through it on paper. For a live guided session with a timer, whiteboard, and
      code editor built in, start from the Dashboard instead.</p>
      <form id="log-form" class="form">
        <div class="field">
          <span class="label">Problem</span>
          <div class="row gap-sm">
            <select class="select" name="problemId" id="problem-select">
              <option value="__new__">+ New problem…</option>
              ${problemsByPattern.map(({ pat, problems }) => problems.length ? `
                <optgroup label="${esc(pat.name)}">
                  ${problems.map((p) => `<option value="${esc(p.id)}" ${p.id === prefill ? "selected" : ""}>${esc(p.name)}${p.number ? ` (#${p.number})` : ""}</option>`).join("")}
                </optgroup>` : "").join("")}
            </select>
          </div>
        </div>

        <fieldset id="new-problem-fields" class="fieldset" hidden>
          <label class="field"><span class="label">Name</span><input class="input" name="newName" value="${esc(prefillName)}" /></label>
          <label class="field"><span class="label">LeetCode #</span><input class="input" name="newNumber" type="number" /></label>
          <label class="field"><span class="label">Difficulty</span>
            <select class="select" name="newDifficulty">
              <option>Easy</option><option selected>Medium</option><option>Hard</option><option>Unrated</option>
            </select></label>
          <label class="field"><span class="label">Pattern</span>
            <select class="select" name="newPatternId">
              ${state.patterns.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
            </select></label>
          <label class="field"><span class="label">Approach (one line)</span><input class="input" name="newApproach" /></label>
          <input type="hidden" name="newUrl" value="${esc(prefillUrl)}" />
        </fieldset>

        <div class="two-col">
          <label class="field"><span class="label">Date</span><input class="input" type="date" name="date" value="${todayISO()}" /></label>
          <label class="field"><span class="label">Outcome</span>
            <select class="select" name="outcome">
              <option value="solved-clean">Solved clean</option>
              <option value="solved-struggled">Solved, struggled</option>
              <option value="failed">Didn't solve</option>
            </select></label>
        </div>

        <div class="two-col">
          <label class="field"><span class="label">Pattern ID'd correctly before coding?</span>
            <select class="select" name="patternGuess">
              <option value="correct">Yes</option>
              <option value="partial">Partially</option>
              <option value="incorrect">No</option>
            </select></label>
          <div></div>
        </div>

        <div class="two-col">
          <label class="field"><span class="label">Time to insight (min)</span><input class="input" type="number" min="0" name="timeToInsightMin" /></label>
          <label class="field"><span class="label">Time to working solution (min)</span><input class="input" type="number" min="0" name="timeToSolveMin" /></label>
        </div>

        <div class="field">
          <span class="label">Mistake tags</span>
          <div class="chip-group">
            ${MISTAKE_TAGS.map((t) => `<label class="chip"><input type="checkbox" name="mistakeTags" value="${t}" />${t.replace(/-/g, " ")}</label>`).join("")}
          </div>
        </div>

        <label class="field"><span class="label">Soul statement <span class="muted small" style="font-weight:400">— optional, but this is the part worth having in six months</span></span>
          <textarea class="textarea" name="soulStatement" rows="4" placeholder="What was your confusion, and what clicked?"></textarea></label>

        <div class="field">
          <div class="row space-between">
            <span class="label">Your code (optional — for reviewing mistakes later)</span>
            <select class="select" id="code-lang" style="max-width:9rem">
              ${Object.entries(CODE_MODES).map(([k, v]) => `<option value="${k}" ${k === "cpp" ? "selected" : ""}>${v.label}</option>`).join("")}
            </select>
          </div>
          <div id="code-editor" class="code-editor-host"></div>
        </div>

        <label class="field checkbox-field"><input type="checkbox" name="isMock" id="is-mock" /> This was a timed mock, not regular review</label>
        <div id="mock-fields" class="two-col" hidden>
          <label class="field"><span class="label">Communication rating (1-5)</span><input class="input" type="number" min="1" max="5" name="communicationRating" /></label>
          <label class="field"><span class="label">Actual duration (min)</span><input class="input" type="number" min="0" name="durationActualMin" /></label>
        </div>

        <button class="btn btn-primary" type="submit">Save rep</button>
      </form>
    </div>`;

  const form = root.querySelector("#log-form");
  const select = root.querySelector("#problem-select");
  const newFields = root.querySelector("#new-problem-fields");
  const mockCheck = root.querySelector("#is-mock");
  const mockFields = root.querySelector("#mock-fields");
  const langSelect = root.querySelector("#code-lang");
  const codeHost = root.querySelector("#code-editor");

  function syncNewFields() {
    newFields.hidden = select.value !== "__new__";
  }
  select.addEventListener("change", syncNewFields);
  syncNewFields();
  mockCheck.addEventListener("change", () => (mockFields.hidden = !mockCheck.checked));

  let cm = null;
  loadCodeMirror().then((CodeMirror) => {
    if (!codeHost.isConnected) return; // tab changed before the CDN load finished
    cm = CodeMirror(codeHost, { mode: CODE_MODES[langSelect.value].mode, lineNumbers: true, viewportMargin: Infinity });
    langSelect.addEventListener("change", () => cm.setOption("mode", CODE_MODES[langSelect.value].mode));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const code = cm ? cm.getValue().trim() : "";
    const codeLang = langSelect.value;
    store.mutate((s) => {
      let problemId = f.get("problemId");
      if (problemId === "__new__") {
        const name = (f.get("newName") || "").trim();
        if (!name) return;
        problemId = uid();
        s.problems.push({
          id: problemId,
          name,
          number: f.get("newNumber") ? Number(f.get("newNumber")) : null,
          difficulty: f.get("newDifficulty"),
          patternId: f.get("newPatternId"),
          approach: f.get("newApproach") || "",
          filePath: "",
          url: f.get("newUrl") || "",
          notes: "",
          box: 0,
          nextReviewDate: todayISO(),
          attempts: [],
        });
      }
      const problem = s.problems.find((p) => p.id === problemId);
      if (!problem) return;
      const outcome = f.get("outcome");
      const attempt = {
        id: uid(),
        date: f.get("date") || todayISO(),
        outcome,
        patternGuess: f.get("patternGuess"),
        timeToInsightMin: f.get("timeToInsightMin") ? Number(f.get("timeToInsightMin")) : null,
        timeToSolveMin: f.get("timeToSolveMin") ? Number(f.get("timeToSolveMin")) : null,
        mistakeTags: f.getAll("mistakeTags"),
        soulStatement: f.get("soulStatement") || "",
        isMock: !!f.get("isMock"),
        code: code || "",
        codeLang: code ? codeLang : "",
      };
      problem.attempts.push(attempt);
      activateProblem(problem); // working it is what moves it out of the bank
      applyOutcome(problem, outcome, s.settings);
      updateStreak(s);
      if (attempt.isMock) {
        s.mocks.push({
          id: uid(),
          date: attempt.date,
          problemId: problem.id,
          outcome,
          communicationRating: f.get("communicationRating") ? Number(f.get("communicationRating")) : null,
          durationActualMin: f.get("durationActualMin") ? Number(f.get("durationActualMin")) : null,
          notes: "",
          checklist: {},
        });
      }
    }, `Ledger: log ${f.get("problemId") === "__new__" ? (f.get("newName") || "new problem") : "rep"}`);
    toast("Saved.");
    actions.switchTab("dashboard");
  });
}

// ---------- Patterns ----------

export function renderPatterns(root, store, actions) {
  const state = store.state;
  const stats = patternStats(state).sort((a, b) => (a.solvedCleanRate ?? 1) - (b.solvedCleanRate ?? 1));
  root.innerHTML = `
    <div class="card">
      <h2>Pattern mastery</h2>
      <p class="muted">Weakest first — this is what "next 2 weeks of focus" should be picked from. Click a
      pattern to open its Topics page.</p>
      <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Mastery</th><th>Pattern</th><th># problems</th><th>Attempts</th><th>Clean-solve rate</th><th>Trend</th><th>ID'd correctly</th><th>Avg time to insight</th><th>Top mistake</th></tr></thead>
        <tbody>
          ${stats.map((s) => `
            <tr class="table-row-link" data-open-topic="${esc(s.pattern.id)}">
              <td>${ringSvg(s.attempts ? s.solvedCleanRate || 0 : 0, { size: 34, stroke: 4, label: s.attempts ? pct(s.solvedCleanRate) : "–" })}</td>
              <td><span class="row gap-sm" style="align-items:center"><span class="pattern-icon">${patternIcon(s.pattern.id, { size: 15 })}</span>${esc(s.pattern.name)}</span></td>
              <td class="num">${s.problemCount}</td>
              <td class="num">${s.attempts}</td>
              <td class="num">${s.attempts ? `<div class="bar bar-inline"><div class="bar-fill" style="width:${Math.round((s.solvedCleanRate || 0) * 100)}%"></div></div>${pct(s.solvedCleanRate)}` : "—"}</td>
              <td>${s.attempts >= 2 ? sparklineSvg(patternTrend(state, s.pattern.id)) : "—"}</td>
              <td class="num">${pct(s.patternGuessRate)}</td>
              <td class="num">${mins(s.avgInsightMin)}</td>
              <td>${s.topMistake ? s.topMistake.replace(/-/g, " ") : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      </div>
    </div>`;

  root.querySelectorAll("[data-open-topic]").forEach((row) => {
    row.addEventListener("click", () => {
      showTopic(row.dataset.openTopic);
      actions.switchTab("topicDetail");
    });
  });
}

// ---------- Session: Workspace + Reflect ----------
//
// The single guided path: Dashboard -> Workspace (statement + timer +
// whiteboard + code editor, all in one place) -> Submit -> Reflect (outcome,
// pattern recall, mistakes, soul statement) -> one save -> back to Dashboard.
// `session` carries state across that whole arc; `reflectState` is Reflect's
// own small slice (the pattern-recall answer), reset each time Workspace
// hands off to it.
//
// Rule for anyone editing this: once the code editor or whiteboard is
// mounted, never call actions.rerender() or reset root.innerHTML — either
// destroys the live widget and loses whatever was typed/drawn. Every
// in-session interaction (mark insight, toggle whiteboard, check a checklist
// item) mutates specific DOM nodes directly instead.

let session = null;
let reflectState = null;

export function startSession(problem, { isMock = false } = {}) {
  session = {
    problem, isMock,
    startedAt: null, insightAt: null, endedAt: null,
    intervalId: null, whiteboardCtl: null, whiteboardShown: false,
    cm: null, codeLang: "cpp", checklist: {},
    capturedCode: "", capturedWhiteboardDataUrl: null,
  };
}

/** Called when the user exits Workspace or Reflect without saving. */
export function abandonSession() {
  if (session?.intervalId) clearInterval(session.intervalId);
  if (session?.whiteboardCtl) session.whiteboardCtl.destroy();
  session = null;
  reflectState = null;
}

export function hasActiveSession() {
  return session != null;
}

function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function renderWorkspace(root, store, actions) {
  if (!session) {
    actions.switchTab("dashboard");
    return;
  }
  const state = store.state;
  const p = session.problem;
  const header = `
    <div class="row gap-sm">
      <span class="pill">${esc(patternName(state, p.patternId))}</span>
      <span class="pill pill-muted">${esc(p.difficulty)}</span>
      ${p.number ? `<span class="pill pill-muted">#${p.number}</span>` : ""}
      ${session.isMock ? `<span class="pill pill-warn">Mock</span>` : ""}
    </div>
    <h2 class="session-problem-title">${esc(p.name)}</h2>`;
  const readUrl = problemUrl(p);

  if (!session.startedAt) {
    root.innerHTML = `
      <div class="card session-card">
        ${header}
        <p class="muted">Read it through first, then start the clock when you actually begin working it —
        that's what "time to insight" measures from.</p>
        ${readUrl ? `
        <ol class="session-steps">
          <li><a class="btn btn-ghost btn-sm" href="${esc(readUrl)}" target="_blank" rel="noopener noreferrer">Open the problem &#8599;</a></li>
          <li>Read it through.</li>
          <li>Start the clock when you begin thinking about a solution.</li>
        </ol>` : `
        <p class="muted small">No link for this one — open it wherever you keep it.</p>`}
        <label class="field checkbox-field">
          <input type="checkbox" id="ws-mock-toggle" ${session.isMock ? "checked" : ""} />
          Verbalized mock — talk through your approach out loud, strict timer
        </label>
        <button class="btn btn-primary" id="ws-start">Start timer</button>
      </div>`;
    root.querySelector("#ws-mock-toggle").addEventListener("change", (e) => {
      session.isMock = e.target.checked;
    });
    root.querySelector("#ws-start").addEventListener("click", () => {
      session.startedAt = Date.now();
      actions.rerender(); // safe: nothing is mounted yet
    });
    return;
  }

  root.innerHTML = `
    <div class="card session-card">
      <div class="row space-between session-cta-row">
        <div>${header}</div>
        <div class="session-clock" id="ws-clock">00:00</div>
      </div>
      <div class="row gap-sm" style="margin: 0.5rem 0">
        <button type="button" class="btn btn-ghost btn-sm" id="ws-mark-insight" ${session.insightAt ? "disabled" : ""}>
          ${session.insightAt ? `Insight at ${Math.round((session.insightAt - session.startedAt) / 60000)} min` : "I've got my approach"}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" id="ws-toggle-board">${session.whiteboardShown ? "Hide whiteboard" : "Show whiteboard"}</button>
        ${readUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(readUrl)}" target="_blank" rel="noopener noreferrer"
          title="Re-read the problem without losing the timer">Problem &#8599;</a>` : ""}
      </div>
      <div id="ws-board-host" ${session.whiteboardShown ? "" : "hidden"}></div>
      <div class="field" style="margin-top:0.6rem">
        <div class="row space-between">
          <span class="label">Your code</span>
          <select class="select" id="ws-code-lang" style="max-width:9rem">
            ${Object.entries(CODE_MODES).map(([k, v]) => `<option value="${k}" ${k === session.codeLang ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </div>
        <div id="ws-code-editor" class="code-editor-host code-editor-tall"></div>
      </div>
      ${session.isMock ? `
      <p class="label" style="margin-top:0.6rem">Verbalization checklist</p>
      <ul class="checklist">
        ${MOCK_CHECKLIST.map((item, i) => `<li><label><input type="checkbox" data-ws-check="${i}" ${session.checklist[i] ? "checked" : ""} /> ${esc(item)}</label></li>`).join("")}
      </ul>` : ""}
      <div class="row gap" style="margin-top:0.75rem">
        <button class="btn btn-primary" id="ws-submit">Submit solution</button>
        <button class="btn btn-ghost" id="ws-exit">Exit without saving</button>
      </div>
    </div>`;

  clearInterval(session.intervalId);
  session.intervalId = setInterval(() => {
    const clock = document.getElementById("ws-clock");
    if (!clock) {
      clearInterval(session.intervalId);
      return;
    }
    clock.textContent = fmtClock(Date.now() - session.startedAt);
  }, 250);

  const boardHost = root.querySelector("#ws-board-host");
  if (session.whiteboardShown && !session.whiteboardCtl) {
    session.whiteboardCtl = createWhiteboard(boardHost);
  }
  root.querySelector("#ws-toggle-board").addEventListener("click", (e) => {
    session.whiteboardShown = !session.whiteboardShown;
    boardHost.hidden = !session.whiteboardShown;
    e.target.textContent = session.whiteboardShown ? "Hide whiteboard" : "Show whiteboard";
    if (session.whiteboardShown && !session.whiteboardCtl) {
      session.whiteboardCtl = createWhiteboard(boardHost);
    }
  });

  const codeHost = root.querySelector("#ws-code-editor");
  const langSelect = root.querySelector("#ws-code-lang");
  loadCodeMirror().then((CodeMirror) => {
    if (!codeHost.isConnected || session?.cm) return; // tab left, or already mounted
    session.cm = CodeMirror(codeHost, {
      value: session.capturedCode,
      mode: CODE_MODES[session.codeLang].mode,
      lineNumbers: true,
      viewportMargin: Infinity,
    });
  });
  langSelect.addEventListener("change", () => {
    session.codeLang = langSelect.value;
    if (session.cm) session.cm.setOption("mode", CODE_MODES[session.codeLang].mode);
  });

  root.querySelector("#ws-mark-insight").addEventListener("click", (e) => {
    if (session.insightAt) return;
    session.insightAt = Date.now();
    e.target.textContent = `Insight at ${Math.round((session.insightAt - session.startedAt) / 60000)} min`;
    e.target.disabled = true;
  });

  root.querySelectorAll("[data-ws-check]").forEach((cb) => {
    cb.addEventListener("change", () => {
      session.checklist[cb.dataset.wsCheck] = cb.checked;
    });
  });

  root.querySelector("#ws-submit").addEventListener("click", () => {
    session.endedAt = Date.now();
    clearInterval(session.intervalId);
    if (session.cm) session.capturedCode = session.cm.getValue().trim();
    if (session.whiteboardCtl && !session.whiteboardCtl.isEmpty()) {
      session.capturedWhiteboardDataUrl = session.whiteboardCtl.toDataUrl();
    }
    reflectState = { patternAnswered: null, options: quizOptions(store.state, p.patternId) };
    actions.switchTab("reflect");
  });

  root.querySelector("#ws-exit").addEventListener("click", () => {
    if (!confirm("Discard this session? Nothing will be saved.")) return;
    abandonSession();
    actions.switchTab("dashboard");
  });
}

function patternRevealHtml(state, problem, correctPatternId) {
  const t = TOPICS[correctPatternId];
  const siblings = state.problems.filter((x) => x.patternId === correctPatternId && x.id !== problem.id).slice(0, 3);
  return `
    ${t ? `<p><strong>Why:</strong> ${esc(t.concept)}</p><p><strong>Invariant:</strong> ${esc(t.invariant)}</p>` : ""}
    ${siblings.length ? `<p class="muted small">Related in this pattern: ${siblings.map((s) => esc(s.name)).join(", ")}</p>` : ""}`;
}

export function renderReflect(root, store, actions) {
  if (!session || !reflectState) {
    actions.switchTab("dashboard");
    return;
  }
  const state = store.state;
  const p = session.problem;
  const insightMin = session.insightAt ? Math.round((session.insightAt - session.startedAt) / 60000) : null;
  const solveMin = session.endedAt ? Math.round((session.endedAt - session.startedAt) / 60000) : null;

  root.innerHTML = `
    <div class="card">
      <h2>${esc(p.name)} — reflect</h2>
      <p class="muted small">${insightMin != null ? `${insightMin} min to insight, ` : ""}${solveMin != null ? `${solveMin} min total` : ""}</p>

      <form id="reflect-form" class="form">
        <label class="field"><span class="label">Outcome</span>
          <select class="select" name="outcome">
            <option value="solved-clean">Solved clean</option>
            <option value="solved-struggled">Solved, struggled</option>
            <option value="failed">Didn't solve</option>
          </select></label>

        <div class="field">
          <span class="label">What was the core pattern here?</span>
          <p class="muted small" style="margin:0 0 0.4rem">Answer before saving, even when you're
          sure. Retrieving it yourself is what moves a pattern into memory — recognizing it in a
          list afterwards doesn't.</p>
          <div class="quiz-options">
            ${reflectState.options.map((optId) => {
              const pat = state.patterns.find((x) => x.id === optId);
              return `<button type="button" class="quiz-option" data-pattern-answer="${esc(optId)}"><span class="pattern-icon">${patternIcon(optId, { size: 15 })}</span>${esc(pat.name)}</button>`;
            }).join("")}
          </div>
          <div id="pattern-reveal" class="pattern-reveal" hidden></div>
        </div>

        <div class="field">
          <span class="label">Mistake tags</span>
          <div class="chip-group">
            ${MISTAKE_TAGS.map((t) => `<label class="chip"><input type="checkbox" name="mistakeTags" value="${t}" />${t.replace(/-/g, " ")}</label>`).join("")}
          </div>
        </div>

        <label class="field"><span class="label">Soul statement <span class="muted small" style="font-weight:400">— optional, but this is the part worth having in six months</span></span>
          <textarea class="textarea" name="soulStatement" rows="4" placeholder="What was your confusion, and what clicked?"></textarea></label>

        ${session.isMock ? `
        <label class="field"><span class="label">Communication rating (1-5)</span>
          <input class="input" type="number" min="1" max="5" name="communicationRating" /></label>` : ""}

        <div class="row gap">
          <button class="btn btn-primary" type="submit" id="reflect-save" disabled>Pick a pattern above first</button>
          <button class="btn btn-ghost" type="button" id="reflect-discard">Discard this session</button>
        </div>
      </form>
    </div>`;

  const form = root.querySelector("#reflect-form");
  const saveBtn = root.querySelector("#reflect-save");
  const revealHost = root.querySelector("#pattern-reveal");

  root.querySelectorAll("[data-pattern-answer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (reflectState.patternAnswered) return;
      const chosen = btn.dataset.patternAnswer;
      reflectState.patternAnswered = chosen;
      const correct = chosen === p.patternId;
      root.querySelectorAll("[data-pattern-answer]").forEach((b) => {
        b.disabled = true;
        if (b.dataset.patternAnswer === p.patternId) b.classList.add("correct");
        else if (b === btn) b.classList.add("incorrect");
      });
      revealHost.innerHTML = `<p class="quiz-feedback">${correct ? "Correct — that's the core pattern." : `The core pattern is <strong>${esc(patternName(state, p.patternId))}</strong>.`}</p>${patternRevealHtml(state, p, p.patternId)}`;
      revealHost.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save & finish";
      // Feeds the same recall-accuracy stat the Quiz/Warmup tabs use, and
      // that the plant's health reads — every real session is itself a
      // pattern-recall rep, not just the dedicated drills.
      store.mutate((s) => {
        s.quiz.totalAsked += 1;
        if (correct) s.quiz.totalCorrect += 1;
        s.quiz.recent.push({ correct });
        if (s.quiz.recent.length > 20) s.quiz.recent.shift();
      }, "Ledger: session pattern-recall answer");
    });
  });

  root.querySelector("#reflect-discard").addEventListener("click", () => {
    if (!confirm("Discard this session? Nothing will be saved.")) return;
    abandonSession();
    actions.switchTab("dashboard");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!reflectState.patternAnswered) return;
    const f = new FormData(form);
    const outcome = f.get("outcome");
    const patternCorrect = reflectState.patternAnswered === p.patternId;
    const isMock = session.isMock;
    const capturedCode = session.capturedCode;
    const capturedCodeLang = session.codeLang;
    const whiteboardDataUrl = session.capturedWhiteboardDataUrl;
    const checklist = { ...session.checklist };
    const date = todayISO();

    const finish = () => {
      store.mutate((s) => {
        const problem = s.problems.find((x) => x.id === p.id);
        if (!problem) return;
        const attempt = {
          id: uid(),
          date,
          outcome,
          patternGuess: patternCorrect ? "correct" : "incorrect",
          timeToInsightMin: insightMin,
          timeToSolveMin: solveMin,
          mistakeTags: f.getAll("mistakeTags"),
          soulStatement: f.get("soulStatement") || "",
          isMock,
          code: capturedCode,
          codeLang: capturedCode ? capturedCodeLang : "",
        };
        problem.attempts.push(attempt);
        activateProblem(problem); // working it is what moves it out of the bank
        applyOutcome(problem, outcome, s.settings);
        updateStreak(s);
        if (isMock) {
          s.mocks.push({
            id: uid(), date, problemId: problem.id, outcome,
            communicationRating: f.get("communicationRating") ? Number(f.get("communicationRating")) : null,
            durationActualMin: solveMin, notes: "", checklist,
          });
        }
      }, `Ledger: session — ${p.name}`);
      abandonSession();
      toast("Saved.");
      actions.switchTab("sessionSummary");
    };

    if (whiteboardDataUrl) {
      const wbId = uid();
      const path = `prep-data/whiteboards/${wbId}.png`;
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      store.saveWhiteboardImage(path, whiteboardDataUrl, "Ledger: save session whiteboard")
        .then(() => {
          store.mutate((s) => {
            s.whiteboards.push({ id: wbId, date, problemId: p.id, path, caption: `${p.name} — session` });
          }, "Ledger: index session whiteboard");
          finish();
        })
        .catch(() => {
          toast("Whiteboard save failed — saving the rest anyway.");
          finish();
        });
    } else {
      finish();
    }
  });
}

/** The checkpoint after every save — deliberately not a silent bounce back
 * to Dashboard. Ending a session is framed as a real, supported choice
 * ("I'm done for today"), not something that only happens when a timer or
 * the queue runs out — the whole point is undercutting the grind-until-
 * burnout default. */
const PLANT_REACTION = {
  thriving: "Your plant's thriving — this rhythm is exactly what sticks long-term.",
  steady: "Your plant's steady. Keep this pace and it'll keep climbing.",
  stressed: "Your plant's looking a little stressed — check the signals above before piling on more today.",
  wilting: "Your plant's wilting. A lighter day, or an actual day off, would help it more than another rep right now.",
};

export function renderSessionSummary(root, store, actions) {
  const state = store.state;
  const today = todayISO();
  const todaysAttempts = allAttempts(state).filter((a) => a.date === today);
  const totalMin = todaysAttempts.reduce((sum, a) => sum + (a.timeToSolveMin || 0), 0);
  const rec = recommendSession(state);
  const plant = computePlantState(state);
  const budgetMin = state.settings.dailyBudgetMin;
  const overBudget = totalMin >= budgetMin;
  const manyReps = todaysAttempts.length >= 3;

  root.innerHTML = `
    <div class="card session-card">
      <h2>Nice work</h2>
      <p class="muted">${todaysAttempts.length} rep${todaysAttempts.length === 1 ? "" : "s"} today${totalMin ? `, ${totalMin} min total` : ""}${budgetMin ? ` (budget: ${budgetMin} min)` : ""}.</p>
      <div class="plant-toast-row" style="margin: 0.75rem 0">
        ${plantSvg(plant.stage, plant.vitality, { size: 56, decorative: true })}
        <p class="muted small">${PLANT_REACTION[plant.vitality]}</p>
      </div>
      ${overBudget ? `<p class="banner banner-warn" style="padding:0.6rem 0.75rem;border-radius:8px">You've hit today's planned budget — a genuinely good place to stop. More isn't automatically better; consistency tomorrow beats a long session today.</p>` : ""}
      ${!overBudget && manyReps ? `<p class="muted small">That's a solid handful of reps — diminishing returns start to kick in past this point in one sitting.</p>` : ""}
      <div class="row gap" style="margin-top:0.75rem">
        ${rec.problem ? `<button class="btn ${overBudget ? "btn-ghost" : "btn-primary"}" id="ss-another">Do another — ${esc(rec.problem.name)}</button>` : ""}
        <button class="btn ${overBudget ? "btn-primary" : "btn-ghost"}" id="ss-done">I'm done for today</button>
      </div>
    </div>`;

  const anotherBtn = root.querySelector("#ss-another");
  if (anotherBtn) {
    anotherBtn.addEventListener("click", () => {
      startSession(rec.problem);
      actions.switchTab("workspace");
    });
  }
  root.querySelector("#ss-done").addEventListener("click", () => actions.switchTab("dashboard"));
}

// ---------- Journal ----------

export function renderJournal(root, store) {
  const state = store.state;
  const entries = allAttempts(state).filter((a) => a.soulStatement).reverse();
  const notes = [...state.journal].reverse();
  const mocks = [...state.mocks].reverse();

  const reflectionCounts = {};
  for (const a of entries) reflectionCounts[a.date] = (reflectionCounts[a.date] || 0) + 1;
  for (const n of notes) reflectionCounts[n.date] = (reflectionCounts[n.date] || 0) + 1;
  const hasReflections = entries.length + notes.length > 0;

  root.innerHTML = `
    ${hasReflections ? `
    <div class="card">
      <h2>Reflection frequency</h2>
      <p class="muted small">Every soul statement and note, by day. Reflecting regularly is what turns grinding into learning.</p>
      ${heatmapSvg(reflectionCounts)}
    </div>` : ""}
    <div class="card">
      <h2>Add a note</h2>
      <form id="journal-form" class="form">
        <div class="two-col">
          <label class="field"><span class="label">Type</span>
            <select class="select" name="type"><option value="weekly-retro">Weekly retro</option><option value="note">Note</option></select></label>
          <label class="field"><span class="label">Date</span><input class="input" type="date" name="date" value="${todayISO()}" /></label>
        </div>
        <label class="field"><span class="label">Text</span><textarea class="textarea" name="text" rows="4"></textarea></label>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
    <div class="card">
      <h2>Notes</h2>
      ${notes.length === 0 ? emptyState("journal", "No notes yet",
        "A weekly retro here is where patterns across sessions become visible — what keeps tripping you up, and what finally clicked.") : `
      <ul class="journal-list">
        ${notes.map((n) => `<li><div class="row space-between"><strong>${esc(n.type.replace(/-/g, " "))}</strong><span class="muted">${fmtDate(n.date)}</span></div><p>${esc(n.text)}</p></li>`).join("")}
      </ul>`}
    </div>
    <div class="card">
      <h2>Mock interviews</h2>
      ${mocks.length === 0 ? emptyState("log", "No mock interviews yet",
        "Toggle \"Verbalized mock\" when starting a session to practice talking through your approach out loud, on a strict timer. It gets logged here.",
        { tab: "queue", label: "Start one from the queue" }) : `
      <ul class="queue-list">
        ${mocks.map((m) => `
          <li class="queue-item">
            <div class="row gap-sm" style="align-items:flex-start">
              ${outcomeIcon(m.outcome)}
              <div>
                <div class="row gap-sm">
                  <span class="pill ${m.outcome === "solved-clean" ? "pill-good" : "pill-muted"}">${esc(m.outcome)}</span>
                  <span class="pill pill-muted">${fmtDate(m.date)}</span>
                </div>
                <div class="queue-name">${esc(state.problems.find((p) => p.id === m.problemId)?.name || "Untitled")}${m.communicationRating ? ` · comms ${m.communicationRating}/5` : ""}${m.durationActualMin != null ? ` · ${m.durationActualMin} min` : ""}</div>
              </div>
            </div>
          </li>`).join("")}
      </ul>`}
    </div>
    <div class="card">
      <h2>Soul statements</h2>
      ${entries.length === 0 ? emptyState("journal", "No soul statements yet",
        "At the end of every session you write one sentence about what actually happened. Months of those become the most useful thing in this app.",
        { tab: "queue", label: "Start a session" }) : `
      <ul class="journal-list">
        ${entries.map((a) => `
          <li>
            <div class="row space-between">
              <span class="row gap-sm" style="align-items:center">${outcomeIcon(a.outcome)}<strong>${esc(a.problemName)}</strong></span>
              <span class="muted">${fmtDate(a.date)} · ${esc(a.outcome)}</span>
            </div>
            <p>${esc(a.soulStatement)}</p>
            ${a.code ? `<button type="button" class="btn btn-ghost btn-sm" data-show-code="${esc(a.id)}">View code from this attempt</button>
            <div class="code-editor-host code-view" id="code-view-${esc(a.id)}" hidden></div>` : ""}
          </li>`).join("")}
      </ul>`}
    </div>`;

  root.querySelectorAll("[data-show-code]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.showCode;
      const host = root.querySelector(`#code-view-${CSS.escape(id)}`);
      const attempt = entries.find((a) => a.id === id);
      if (host.hidden === false) {
        host.hidden = true;
        return;
      }
      host.hidden = false;
      if (host.childElementCount) return; // already mounted once
      const CodeMirror = await loadCodeMirror();
      CodeMirror(host, {
        value: attempt.code,
        mode: CODE_MODES[attempt.codeLang]?.mode || "text/x-c++src",
        lineNumbers: true,
        readOnly: true,
        viewportMargin: Infinity,
      });
    });
  });

  root.querySelector("#journal-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (!(f.get("text") || "").trim()) return;
    store.mutate((s) => {
      s.journal.push({ id: uid(), date: f.get("date") || todayISO(), type: f.get("type"), text: f.get("text") });
    }, "Ledger: journal entry");
    e.target.reset();
    toast("Noted.");
  });
}

// ---------- System Design ----------

export function renderSystemDesign(root, store) {
  const state = store.state;
  const sd = systemDesignUnlock(state);
  const sessions = [...state.systemDesign.sessions].reverse();

  root.innerHTML = `
    <div class="card">
      <h2>System design track</h2>
      <p class="muted">Unlocks once mock interviews show the coding fundamentals are solid — the point
      is to run this alongside coding prep once you're ready, not to defer it forever.</p>
      <div class="row gap" style="align-items:center">
        <div class="row gap-sm" style="align-items:center">${ringSvg(sd.minMocks ? Math.min(1, sd.mocksLogged / sd.minMocks) : 0, { size: 48, label: `${sd.mocksLogged}/${sd.minMocks}` })}<span class="stat-label">mocks logged</span></div>
        <div class="row gap-sm" style="align-items:center">${ringSvg(sd.recentSolvedCleanRate || 0, { size: 48, color: (sd.recentSolvedCleanRate || 0) >= sd.minSolvedCleanRate ? "var(--good)" : "var(--accent)", label: pct(sd.recentSolvedCleanRate) })}<span class="stat-label">recent clean-solve (need ${pct(sd.minSolvedCleanRate)})</span></div>
      </div>
      <span class="badge ${sd.unlocked ? "badge-good" : "badge-warn"}">${sd.unlocked ? "Unlocked" : "Locked"}</span>
      <label class="field checkbox-field" style="margin-top:1rem">
        <input type="checkbox" id="manual-unlock" ${sd.manualUnlock ? "checked" : ""} /> Start anyway, regardless of the numbers
      </label>
    </div>
    ${sd.unlocked ? `
    <div class="card">
      <h2>Log a session</h2>
      <form id="sd-form" class="form">
        <label class="field"><span class="label">Topic</span><input class="input" name="topic" required placeholder="e.g. rate limiter, news feed, URL shortener" /></label>
        <label class="field"><span class="label">Notes</span><textarea class="textarea" name="notes" rows="4"></textarea></label>
        <label class="field"><span class="label">Confidence (1-5)</span><input class="input" type="number" min="1" max="5" name="confidence" /></label>
        <button class="btn btn-primary" type="submit">Save</button>
      </form>
    </div>
    <div class="card">
      <h2>Past sessions</h2>
      ${sessions.length === 0 ? emptyState("systemDesign", "No design sessions logged",
        "Pick a system, talk through it, then record what you covered and how confident you felt. Confidence over time is the signal worth watching here.") : `
      <ul class="journal-list">
        ${sessions.map((s) => `<li><div class="row space-between"><strong>${esc(s.topic)}</strong><span class="muted">${fmtDate(s.date)} · confidence ${s.confidence ?? "—"}/5</span></div><p>${esc(s.notes)}</p></li>`).join("")}
      </ul>`}
    </div>` : ""}`;

  root.querySelector("#manual-unlock").addEventListener("change", (e) => {
    store.mutate((s) => { s.systemDesign.manualUnlock = e.target.checked; }, "Ledger: system design manual unlock toggle");
  });

  const sdForm = root.querySelector("#sd-form");
  if (sdForm) {
    sdForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(sdForm);
      store.mutate((s) => {
        s.systemDesign.sessions.push({
          id: uid(), date: todayISO(), topic: f.get("topic"),
          notes: f.get("notes") || "", confidence: f.get("confidence") ? Number(f.get("confidence")) : null,
        });
        updateStreak(s);
      }, "Ledger: system design session");
      toast("Saved.");
      sdForm.reset();
    });
  }
}

// ---------- Topics ----------

// Diagrams mount immediately on the (now dedicated, one-per-pattern) topic
// page — there's nothing else competing for load time there — and their
// play-button timers are torn down whenever that page re-renders, so
// leaving mid-animation doesn't leave a setInterval ticking against a
// detached diagram forever.
let topicDiagramPlayers = [];
// Bumped on every topic render so a slow diagram import can tell whether the
// page it was loading for is still the one on screen.
let topicRenderToken = 0;

// Cross-view handoff for "click a pattern card" -> dedicated page, the same
// pattern used elsewhere (nav.prefillProblemId, reflectState): a module-level
// slot app.js reads via showTopic()/current, not a routed URL param.
export const topicNav = { patternId: null };
export function showTopic(patternId) {
  topicNav.patternId = patternId;
}

const DIFFICULTY_ORDER = { Easy: 0, Medium: 1, Hard: 2, Unrated: 1.5 };

/** The Topics index — a table of contents, not an accordion: one card per
 * pattern (icon, name, mastery, the plain-language hook) that links to its
 * own dedicated page rather than expanding in place. 23 patterns in one
 * scrolling accordion was exactly the "wall of everything" this whole
 * redesign is against. */
export function renderTopics(root, store, actions) {
  const state = store.state;
  const stats = patternStats(state);
  const statByPattern = Object.fromEntries(stats.map((s) => [s.pattern.id, s]));

  // Reading about a pattern lands better when you're about to practise it, so
  // the index says which ones have work waiting rather than leaving you to
  // cross-reference the queue yourself.
  const dueByPattern = {};
  for (const p of dueProblems(state)) {
    dueByPattern[p.patternId] = (dueByPattern[p.patternId] || 0) + 1;
  }

  root.innerHTML = `
    <div class="card">
      <h2>Topics</h2>
      <p class="muted">Pick a pattern. Each page: what it is in plain terms, how to recognize it, the
      invariant that makes it work, animated worked examples, and your own logged problems as the
      practice ladder — so it stays accurate instead of linking to problems you haven't touched.</p>
    </div>
    <div class="index-grid">
      ${state.patterns.map((pat) => {
        const s = statByPattern[pat.id];
        const t = TOPICS[pat.id];
        return `
        <button type="button" class="card index-card topic-index-card" data-open-topic="${esc(pat.id)}">
          <div class="row gap-sm" style="align-items:center">
            <span class="topic-index-icon">${patternIcon(pat.id, { size: 22 })}</span>
            <h3 style="margin:0">${esc(pat.name)}</h3>
          </div>
          <p class="muted small">${esc(t?.hook || pat.description)}</p>
          <span class="row gap-sm">
            ${s && s.attempts ? `<span class="pill ${pct(s.solvedCleanRate)[0] === "1" ? "pill-good" : "pill-muted"}">${pct(s.solvedCleanRate)} clean-solve</span>` : `<span class="pill pill-muted">not practiced yet</span>`}
            ${dueByPattern[pat.id] ? `<span class="pill pill-warn">${dueByPattern[pat.id]} due</span>` : ""}
          </span>
        </button>`;
      }).join("")}
    </div>`;

  root.querySelectorAll("[data-open-topic]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showTopic(btn.dataset.openTopic);
      actions.switchTab("topicDetail");
    });
  });
}

/** The dedicated per-pattern page — reached only by clicking a Topics card
 * (topicNav.patternId set just before the tab switch), same handoff idiom
 * used for prefilling Log Session and starting a Workspace session. */
export function renderTopicDetail(root, store, actions) {
  topicDiagramPlayers.forEach((p) => p.destroy());
  topicDiagramPlayers = [];
  const state = store.state;
  const pat = state.patterns.find((p) => p.id === topicNav.patternId);
  if (!pat) {
    actions.switchTab("topics");
    return;
  }
  const t = TOPICS[pat.id];
  const problems = state.problems.filter((p) => p.patternId === pat.id)
    .sort((a, b) => (a.difficulty === b.difficulty ? 0 : DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]));
  const resources = state.resources[pat.id] || [];

  root.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" id="topic-back">← Topics</button>
    <div class="card topic-detail-header">
      <div class="row gap-sm" style="align-items:center">
        <span class="topic-index-icon topic-index-icon-lg">${patternIcon(pat.id, { size: 30 })}</span>
        <div>
          <h2 style="margin:0">${esc(pat.name)}</h2>
          <p class="muted small" style="margin:0.15rem 0 0">${esc(pat.description)}</p>
        </div>
      </div>
    </div>
    ${t ? `
    <div class="card">
      <p class="topic-hook">${richText(t.hook)}</p>
      <p><strong>More precisely.</strong> ${richText(t.concept)}</p>
      <p><strong>Recognize it from:</strong> ${t.recognize.map((r) => `<span class="pill pill-muted">${richText(r)}</span>`).join(" ")}</p>
      <p><strong>Invariant.</strong> ${richText(t.invariant)}</p>
      <p><strong>Pitfalls</strong></p>
      <ul class="tight-list">${t.pitfalls.map((p) => `<li>${richText(p)}</li>`).join("")}</ul>
    </div>` : ""}
    <div id="topic-diagrams">
      <div class="card"><div class="skeleton skeleton-line" style="width:40%"></div>
      <div class="skeleton" style="height:7rem;margin-top:0.6rem"></div></div>
    </div>
    <div class="card">
      <h2>Practice ladder</h2>
      <p class="muted small">Your own logged problems, easiest first.</p>
      ${problems.length === 0 ? emptyState("log", "Nothing logged yet",
        "Solved something elsewhere — on paper, in a real interview, straight on LeetCode? Record it here and it joins the same review schedule.") : `
      <ul class="queue-list">${problems.map((p) => queueItemHtml(state, p)).join("")}</ul>`}
    </div>
    <div class="card">
      <h2>Resources</h2>
      ${resources.length === 0 ? `<p class="muted small">No links saved yet.</p>` : `
      <ul class="resource-list">${resources.map((r) => `
        <li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || r.url)}</a>
        <button type="button" class="btn-icon" data-remove-resource="${esc(pat.id)}::${esc(r.id)}" aria-label="Remove">×</button></li>`).join("")}</ul>`}
      <form class="form resource-form" data-add-resource="${esc(pat.id)}">
        <input class="input" name="title" placeholder="Title (optional)" />
        <input class="input" name="url" placeholder="https://youtube.com/watch?v=…" required />
        <button class="btn btn-ghost btn-sm" type="submit">Add link</button>
      </form>
      <a class="btn btn-ghost btn-sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(pat.name + " leetcode pattern explained")}" target="_blank" rel="noopener">Search YouTube for "${esc(pat.name)}"</a>
    </div>`;

  root.querySelector("#topic-back").addEventListener("click", () => actions.switchTab("topics"));

  const diagramHost = root.querySelector("#topic-diagrams");
  if (diagramHost) {
    const renderToken = ++topicRenderToken;
    loadDiagramModules().then(({ mounters, specs: allSpecs }) => {
      // Guard against arriving after the user has already moved on — mounting
      // into a detached node would leak players that never get destroyed.
      if (renderToken !== topicRenderToken || !document.contains(diagramHost)) return;
      diagramHost.innerHTML = "";
      for (const spec of allSpecs[pat.id] || []) {
        const mount = mounters[spec.kind];
        if (!mount) continue;
        const slot = document.createElement("div");
        diagramHost.appendChild(slot);
        topicDiagramPlayers.push(mount(slot, spec));
      }
    }).catch(() => {
      if (renderToken !== topicRenderToken) return;
      diagramHost.innerHTML = `<div class="card"><p class="muted small">The worked examples couldn't
        be loaded. Everything above is unaffected.</p></div>`;
    });
  }

  wireStartButtons(root, store, actions);
  root.querySelectorAll("[data-add-resource]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const patternId = form.dataset.addResource;
      const f = new FormData(form);
      const url = (f.get("url") || "").trim();
      if (!url) return;
      store.mutate((s) => {
        if (!s.resources[patternId]) s.resources[patternId] = [];
        s.resources[patternId].push({ id: uid(), title: (f.get("title") || "").trim(), url, addedAt: todayISO() });
      }, "Ledger: add resource link");
      toast("Added.");
    });
  });
  root.querySelectorAll("[data-remove-resource]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [patternId, resourceId] = btn.dataset.removeResource.split("::");
      store.mutate((s) => {
        s.resources[patternId] = (s.resources[patternId] || []).filter((r) => r.id !== resourceId);
      }, "Ledger: remove resource link");
    });
  });
}

// ---------- Quiz ----------

let quizState = { current: null, options: [], answered: null, recentIds: [] };

export function renderQuiz(root, store, actions) {
  const state = store.state;
  if (!quizState.current) nextQuizQuestion(state);

  const total = state.quiz.totalAsked;
  const correct = state.quiz.totalCorrect;

  if (!quizState.current) {
    root.innerHTML = `
      <div class="card">
        <h2>Pattern-recognition drill</h2>
        ${emptyState("quiz", "Nothing to drill yet",
          "This drill shows a problem you've already solved and asks which pattern it used — the recall step that makes a pattern stick. It needs a few logged attempts to draw from.",
          { tab: "queue", label: "Go to the review queue" })}
      </div>`;
    return;
  }

  const p = quizState.current;
  root.innerHTML = `
    <div class="card">
      <div class="row space-between" style="align-items:center">
        <h2>Pattern-recognition drill</h2>
        <span class="row gap-sm" style="align-items:center">${total ? ringSvg(correct / total, { size: 36, stroke: 4, label: pct(correct / total) }) : ""}<span class="muted small">${correct}/${total} lifetime</span></span>
      </div>
      <p class="muted">If this popped up cold in an interview, what pattern would you reach for?</p>
      <div class="quiz-prompt">
        <div class="queue-name">${esc(p.name)}${p.number ? ` <span class="muted">#${p.number}</span>` : ""}</div>
        <span class="pill pill-muted">${esc(p.difficulty)}</span>
      </div>
      <div class="quiz-options">
        ${quizState.options.map((optId) => {
          const pat = state.patterns.find((x) => x.id === optId);
          let cls = "quiz-option";
          if (quizState.answered) {
            if (optId === p.patternId) cls += " correct";
            else if (optId === quizState.answered && optId !== p.patternId) cls += " incorrect";
          }
          return `<button type="button" class="${cls}" data-answer="${esc(optId)}" ${quizState.answered ? "disabled" : ""}><span class="pattern-icon">${patternIcon(optId, { size: 15 })}</span>${esc(pat.name)}</button>`;
        }).join("")}
      </div>
      ${quizState.answered ? `
        <p class="quiz-feedback">${quizState.answered === p.patternId ? "Correct." : `Actual approach: <strong>${esc(patternName(state, p.patternId))}</strong> — ${esc(p.approach)}`}</p>
        <button class="btn btn-primary" id="quiz-next">Next question</button>
      ` : ""}
    </div>`;

  root.querySelectorAll("[data-answer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      quizState.answered = btn.dataset.answer;
      const isCorrect = quizState.answered === p.patternId;
      store.mutate((s) => {
        s.quiz.totalAsked += 1;
        if (isCorrect) s.quiz.totalCorrect += 1;
        s.quiz.recent.push({ correct: isCorrect });
        if (s.quiz.recent.length > 20) s.quiz.recent.shift();
      }, "Ledger: quiz answer");
      actions.rerender();
    });
  });
  const nextBtn = root.querySelector("#quiz-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      nextQuizQuestion(state);
      actions.rerender();
    });
  }
}

function nextQuizQuestion(state) {
  const p = pickQuizProblem(state, quizState.recentIds);
  quizState.current = p;
  quizState.answered = null;
  if (!p) return;
  quizState.options = quizOptions(state, p.patternId);
  quizState.recentIds = [p.id, ...quizState.recentIds].slice(0, 5);
}

// ---------- Warmup ----------
// A bounded (3-question) version of the same drill, framed as the on-ramp
// into a session rather than open-ended practice — "encourage 5 minutes of
// pattern review before you start."

const WARMUP_LENGTH = 3;
let warmupState = { count: 0, current: null, options: [], answered: null, recentIds: [] };

export function resetWarmup() {
  warmupState = { count: 0, current: null, options: [], answered: null, recentIds: [] };
}

export function renderWarmup(root, store, actions) {
  const state = store.state;
  if (warmupState.count === 0 && !warmupState.current) nextWarmupQuestion(state);

  if (warmupState.count >= WARMUP_LENGTH || (!warmupState.current && warmupState.count > 0)) {
    const rec = recommendSession(state);
    root.innerHTML = `
      <div class="card">
        <h2>Warmed up</h2>
        <p class="muted">${rec.problem ? esc(rec.message) : "Patterns are loaded, and there's nothing due right now — good day to stop here."}</p>
        <div class="row gap">
          ${rec.problem ? `<button class="btn btn-primary" id="warmup-start">Start — ${esc(rec.problem.name)}</button>` : ""}
          <button class="btn btn-ghost" data-tab="dashboard">Back to dashboard</button>
        </div>
      </div>`;
    wireTabButtons(root, actions);
    const startBtn = root.querySelector("#warmup-start");
    if (startBtn) {
      startBtn.addEventListener("click", () => {
        startSession(rec.problem);
        resetWarmup();
        actions.switchTab("workspace");
      });
    }
    return;
  }

  if (!warmupState.current) {
    root.innerHTML = `
      <div class="card">
        ${emptyState("quiz", "No warmup available yet",
          "Warmup replays patterns from problems you've already attempted, to get your head in before a session. Log one first.",
          { tab: "queue", label: "Go to the review queue" })}
        <button class="btn btn-ghost" data-tab="dashboard">Back to dashboard</button>
      </div>`;
    wireTabButtons(root, actions);
    return;
  }

  const p = warmupState.current;
  root.innerHTML = `
    <div class="card">
      <div class="row space-between"><h2>Pattern warmup</h2><span class="muted small">${warmupState.count + 1} of ${WARMUP_LENGTH}</span></div>
      <p class="muted">If this popped up cold, what pattern would you reach for?</p>
      <div class="quiz-prompt">
        <div class="queue-name">${esc(p.name)}${p.number ? ` <span class="muted">#${p.number}</span>` : ""}</div>
        <span class="pill pill-muted">${esc(p.difficulty)}</span>
      </div>
      <div class="quiz-options">
        ${warmupState.options.map((optId) => {
          const pat = state.patterns.find((x) => x.id === optId);
          let cls = "quiz-option";
          if (warmupState.answered) {
            if (optId === p.patternId) cls += " correct";
            else if (optId === warmupState.answered && optId !== p.patternId) cls += " incorrect";
          }
          return `<button type="button" class="${cls}" data-answer="${esc(optId)}" ${warmupState.answered ? "disabled" : ""}><span class="pattern-icon">${patternIcon(optId, { size: 15 })}</span>${esc(pat.name)}</button>`;
        }).join("")}
      </div>
      ${warmupState.answered ? `
        <p class="quiz-feedback">${warmupState.answered === p.patternId ? "Correct." : `It's <strong>${esc(patternName(state, p.patternId))}</strong>.`}</p>
        <button class="btn btn-primary" id="warmup-next">${warmupState.count + 1 >= WARMUP_LENGTH ? "Finish warmup" : "Next"}</button>
      ` : ""}
    </div>`;

  root.querySelectorAll("[data-answer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      warmupState.answered = btn.dataset.answer;
      const isCorrect = warmupState.answered === p.patternId;
      store.mutate((s) => {
        s.quiz.totalAsked += 1;
        if (isCorrect) s.quiz.totalCorrect += 1;
        s.quiz.recent.push({ correct: isCorrect });
        if (s.quiz.recent.length > 20) s.quiz.recent.shift();
      }, "Ledger: warmup answer");
      actions.rerender();
    });
  });
  const nextBtn = root.querySelector("#warmup-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      warmupState.count += 1;
      nextWarmupQuestion(state);
      actions.rerender();
    });
  }
}

function nextWarmupQuestion(state) {
  const p = pickQuizProblem(state, warmupState.recentIds);
  warmupState.current = p;
  warmupState.answered = null;
  if (!p) return;
  warmupState.options = quizOptions(state, p.patternId);
  warmupState.recentIds = [p.id, ...warmupState.recentIds].slice(0, 5);
}

// ---------- Whiteboard ----------

let activeWhiteboard = null;

export function renderWhiteboard(root, store, actions) {
  const state = store.state;
  const boards = [...state.whiteboards].reverse();

  root.innerHTML = `
    <div class="card">
      <h2>Whiteboard</h2>
      <p class="muted">A freeform scratchpad — for sketching outside an active session (system design,
      general note-taking). During a live session, a whiteboard panel is built into the workspace
      already and saves automatically when you submit. Works with mouse, touch, or a stylus.</p>
      <div id="wb-root"></div>
      <form id="wb-save-form" class="form" style="margin-top:0.75rem">
        <div class="two-col">
          <label class="field"><span class="label">Attach to problem (optional)</span>
            <select class="select" name="problemId">
              <option value="">— none —</option>
              ${state.problems.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
            </select></label>
          <label class="field"><span class="label">Caption</span><input class="input" name="caption" placeholder="e.g. two-pointer trace" /></label>
        </div>
        <button class="btn btn-primary" type="submit">Save to GitHub</button>
      </form>
    </div>
    <div class="card">
      <h2>Saved boards</h2>
      ${boards.length === 0 ? emptyState("whiteboard", "No boards saved yet",
        "Sketching the shape of a problem before writing code is most of the work in an interview. Anything you draw here can be saved against a problem.") : `
      <ul class="queue-list">
        ${boards.map((b) => `
          <li class="queue-item">
            <div>
              <div class="row gap-sm"><span class="pill pill-muted">${fmtDate(b.date)}</span>${b.problemId ? `<span class="pill pill-muted">${esc(state.problems.find((p) => p.id === b.problemId)?.name || "")}</span>` : ""}</div>
              <div class="queue-name">${esc(b.caption || "Untitled")}</div>
              <div class="whiteboard-thumb-host" id="wb-thumb-${esc(b.id)}"></div>
            </div>
            <button class="btn btn-ghost btn-sm" data-view-board="${esc(b.id)}">View</button>
          </li>`).join("")}
      </ul>`}
    </div>`;

  activeWhiteboard = createWhiteboard(root.querySelector("#wb-root"));

  root.querySelector("#wb-save-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (activeWhiteboard.isEmpty()) {
      toast("Nothing drawn yet.");
      return;
    }
    const f = new FormData(e.target);
    const id = uid();
    const path = `prep-data/whiteboards/${id}.png`;
    const dataUrl = activeWhiteboard.toDataUrl();
    toast("Saving…");
    try {
      await store.saveWhiteboardImage(path, dataUrl, "Ledger: save whiteboard drawing");
      store.mutate((s) => {
        s.whiteboards.push({ id, date: todayISO(), problemId: f.get("problemId") || null, path, caption: (f.get("caption") || "").trim() });
        updateStreak(s);
      }, "Ledger: index whiteboard drawing");
      toast("Saved.");
      actions.rerender();
    } catch (err) {
      toast("Save failed — check your connection.");
    }
  });

  root.querySelectorAll("[data-view-board]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const board = boards.find((b) => b.id === btn.dataset.viewBoard);
      const host = root.querySelector(`#wb-thumb-${CSS.escape(board.id)}`);
      if (host.childElementCount) {
        host.replaceChildren();
        return;
      }
      btn.disabled = true;
      try {
        const base64 = await store.gh.fetchBinaryFile(board.path);
        const img = document.createElement("img");
        img.src = `data:image/png;base64,${base64}`;
        img.alt = board.caption || "Whiteboard drawing";
        host.replaceChildren(img);
      } catch (err) {
        toast("Couldn't load that drawing.");
      }
      btn.disabled = false;
    });
  });
}

// ---------- LeetCode ----------

export function renderLeetCode(root, store, actions) {
  const state = store.state;
  const lc = store.leetcode;

  if (!lc || lc.status === "loading") {
    root.innerHTML = `<div class="card"><p class="muted">Loading LeetCode stats…</p></div>`;
    return;
  }
  if (lc.status === "error" || lc.status === "empty" || (lc.data && lc.data.error)) {
    root.innerHTML = `
      <div class="card">
        <h2>LeetCode</h2>
        <p class="muted">No synced data yet. LeetCode's API can't be called directly from a browser (no
        CORS support), so a daily GitHub Action in your private repo fetches your public profile
        server-side and commits it to <code>prep-data/leetcode-stats.json</code> — this tab just reads
        that file.</p>
        <ol class="setup-steps">
          <li>In the <code>leetcode</code> repo on GitHub: <strong>Settings → Secrets and variables →
            Actions → Variables</strong> → add <code>LEETCODE_USERNAME</code> with your LeetCode handle.</li>
          <li><strong>Actions</strong> tab → <strong>Sync LeetCode stats</strong> → <strong>Run
            workflow</strong> to sync immediately instead of waiting for the daily run.</li>
        </ol>
        <button class="btn btn-ghost" id="lc-refresh">Check again</button>
        ${lc.error ? `<p class="muted small">${esc(lc.error)}</p>` : ""}
      </div>`;
    root.querySelector("#lc-refresh").addEventListener("click", () => {
      store.loadLeetCodeStats().then(() => actions.rerender());
    });
    return;
  }

  const d = lc.data;
  const loggedCount = state.problems.filter((p) => p.attempts.length > 0).length;
  root.innerHTML = `
    <div class="card">
      <div class="row space-between">
        <h2>LeetCode — ${esc(d.username)}</h2>
        <button class="btn btn-ghost btn-sm" id="lc-refresh">Refresh</button>
      </div>
      <p class="muted small">Last synced ${d.fetchedAt ? new Date(d.fetchedAt).toLocaleString() : "—"} · updates ~daily</p>
      <div class="stat-row">
        <div class="stat"><span class="stat-num">${d.solvedByDifficulty?.All ?? 0}</span><span class="stat-label">solved on LeetCode</span></div>
        <div class="stat"><span class="stat-num">${loggedCount}</span><span class="stat-label">logged in Ledger</span></div>
        <div class="stat"><span class="stat-num">${d.streak ?? 0}</span><span class="stat-label">LC streak</span></div>
      </div>
      <div class="row gap" style="margin-top:0.5rem">
        <span class="pill pill-muted">Easy ${d.solvedByDifficulty?.Easy ?? 0}</span>
        <span class="pill pill-muted">Medium ${d.solvedByDifficulty?.Medium ?? 0}</span>
        <span class="pill pill-muted">Hard ${d.solvedByDifficulty?.Hard ?? 0}</span>
      </div>
    </div>
    <div class="card">
      <h2>Submission activity</h2>
      ${heatmapSvg(leetcodeCalendarToDateCounts(d.submissionCalendar))}
    </div>
    <div class="card">
      <h2>Recent accepted</h2>
      ${(d.recentAccepted || []).length === 0 ? `<p class="empty">Nothing recent, or your submission list is private on LeetCode.</p>` : `
      <ul class="queue-list">
        ${d.recentAccepted.map((s) => `
          <li class="queue-item">
            <div>
              <div class="queue-name"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></div>
              <span class="muted small">${new Date(s.timestamp * 1000).toLocaleDateString()} · ${esc(s.lang)}</span>
            </div>
            <button class="btn btn-primary btn-sm" data-quick-log="${esc(s.title)}" data-quick-slug="${esc(s.titleSlug)}">Quick log</button>
          </li>`).join("")}
      </ul>`}
    </div>`;

  root.querySelector("#lc-refresh").addEventListener("click", () => {
    store.loadLeetCodeStats().then(() => actions.rerender());
  });
  root.querySelectorAll("[data-quick-log]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const existing = state.problems.find((p) => p.name.toLowerCase() === btn.dataset.quickLog.toLowerCase());
      nav.prefillProblemId = existing ? existing.id : "__new__";
      nav.prefillName = btn.dataset.quickLog;
      nav.prefillUrl = `https://leetcode.com/problems/${btn.dataset.quickSlug}/`;
      actions.switchTab("log");
    });
  });
}

// ---------- Settings ----------

export function renderSettings(root, store, actions) {
  const state = store.state;
  const cfg = JSON.parse(localStorage.getItem("ledger.config") || "{}");

  root.innerHTML = `
    <div class="card">
      <h2>Daily budget</h2>
      <p class="muted small">A ceiling, not a target. Today's plan is filled up to this many minutes
      with the weakest and most overdue problems, and everything beyond it is pushed to the review
      queue rather than onto today. Finishing the plan is a complete day — the app will say so and
      stop asking for more.</p>
      <form id="budget-form" class="settings-form">
        <label class="field inline"><span class="label">Minutes per day</span>
          <input class="input" type="number" name="dailyBudgetMin" min="10" max="480"
                 value="${state.settings.dailyBudgetMin}" style="max-width:6rem" /></label>
        <button class="btn btn-primary" type="submit">Save</button>
      </form>
    </div>
    <div class="card">
      <h2>GitHub connection</h2>
      <p class="muted">${esc(cfg.owner)}/${esc(cfg.repo)} @ ${esc(cfg.branch)} — <code>${esc(cfg.path)}</code></p>
      <p class="muted small">Every change is written straight to that file, which is what lets the
      same log follow you between laptop and phone. Disconnecting only forgets the token on this
      device — nothing on GitHub is touched, and reconnecting brings it all back.</p>
      <button class="btn btn-ghost" id="disconnect">Disconnect this device</button>
    </div>
    <div class="card">
      <h2>Backup</h2>
      <p class="muted small">Your prep log already lives in version control, so this is for moving it
      somewhere else or keeping a copy outside GitHub. The export is the whole state — problems,
      attempts, soul statements, streaks. Importing replaces everything currently here.</p>
      <div class="row gap">
        <button class="btn btn-ghost" id="export-json">Export JSON</button>
        <label class="btn btn-ghost file-btn">Import JSON<input type="file" id="import-json" accept="application/json" hidden /></label>
      </div>
    </div>
    <div class="card">
      <h2>Theme</h2>
      <select class="select" id="theme-select" style="max-width:12rem">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>`;

  root.querySelector("#budget-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Number(new FormData(e.target).get("dailyBudgetMin")) || 75;
    store.mutate((s) => { s.settings.dailyBudgetMin = v; }, "Ledger: update daily budget");
    toast("Saved.");
  });

  root.querySelector("#disconnect").addEventListener("click", () => {
    if (confirm("Disconnect this device? Your data stays safe on GitHub — you'll just need to reconnect here to see it again.")) {
      store.disconnect();
    }
  });

  root.querySelector("#export-json").addEventListener("click", () => downloadState(state));

  root.querySelector("#import-json").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("This replaces all current data with the imported file. Continue?")) return;
    const text = await file.text();
    try {
      const imported = JSON.parse(text);
      store.mutate((s) => Object.assign(s, imported), "Ledger: import state.json");
      toast("Imported.");
    } catch (err) {
      alert("That file isn't valid JSON.");
    }
  });

  const themeSelect = root.querySelector("#theme-select");
  themeSelect.value = localStorage.getItem("ledger.theme") || "system";
  themeSelect.addEventListener("change", () => {
    const v = themeSelect.value;
    localStorage.setItem("ledger.theme", v);
    document.documentElement.dataset.theme = v === "system" ? "" : v;
  });
}
