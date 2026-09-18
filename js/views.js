import {
  todayISO, applyOutcome, dueProblems, planToday, allAttempts, patternStats,
  updateStreak, systemDesignUnlock, uid, MISTAKE_TAGS, MOCK_CHECKLIST, daysBetween,
  activityByDate, patternTrend, pickQuizProblem, quizOptions, addDaysISO,
} from "./logic.js";
import { TOPICS } from "./topics-content.js";
import { loadCodeMirror, CODE_MODES } from "./codemirror-loader.js";
import { createWhiteboard } from "./whiteboard.js";

// Cross-tab handoff: "Log a rep" buttons elsewhere set this, renderLog reads
// and clears it. A single module-level slot is enough for a single-user app.
export const nav = { prefillProblemId: null };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pct(x) {
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
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMin meet" class="heatmap">${rects}</svg>`;
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

function sparklineSvg(points, { width = 80, height = 22 } = {}) {
  if (!points.length) return "";
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((v, i) => `${(i * step).toFixed(1)},${(height - v * height).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="sparkline"><polyline points="${coords}" /></svg>`;
}

function toast(msg) {
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
  root.innerHTML = `
    <div class="card banner banner-bad">
      <h2>Sync conflict</h2>
      <p>The data file changed on GitHub since this device last loaded it — probably a save from
      another device. Nothing is lost yet: choose how to resolve it.</p>
      <div class="row gap">
        <button class="btn btn-primary" id="keep-mine">Keep this device's changes</button>
        <button class="btn btn-ghost" id="take-theirs">Discard mine, load the latest from GitHub</button>
      </div>
    </div>`;
  root.querySelector("#keep-mine").addEventListener("click", async () => {
    await store.resolveConflictKeepMine();
    rerender();
  });
  root.querySelector("#take-theirs").addEventListener("click", async () => {
    await store.resolveConflictTakeTheirs();
    rerender();
  });
}

// ---------- Dashboard ----------

export function renderDashboard(root, store, actions) {
  const state = store.state;
  const { plan, overflow, usedMin, budgetMin } = planToday(state);
  const stats = patternStats(state).filter((s) => s.attempts > 0).sort((a, b) => a.solvedCleanRate - b.solvedCleanRate);
  const weakest = stats.slice(0, 2);
  const sd = systemDesignUnlock(state);

  root.innerHTML = `
    <div class="grid dashboard-grid">
      <div class="card streak-card">
        <div class="stat-row">
          <div class="stat"><span class="stat-num">${state.streak.current}</span><span class="stat-label">day streak</span></div>
          <div class="stat"><span class="stat-num">${state.streak.longest}</span><span class="stat-label">longest</span></div>
          <div class="stat"><span class="stat-num">${usedMin}/${budgetMin}</span><span class="stat-label">min planned</span></div>
        </div>
      </div>

      <div class="card">
        <h2>Today's plan</h2>
        ${plan.length === 0 ? `<p class="empty">Nothing due. Log a new problem to seed the queue, or get ahead on a weak pattern.</p>` : `
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
              <div class="row space-between"><strong>${esc(s.pattern.name)}</strong><span>${pct(s.solvedCleanRate)} clean-solve</span></div>
              <div class="bar"><div class="bar-fill" style="width:${Math.round((s.solvedCleanRate || 0) * 100)}%"></div></div>
            </li>`).join("")}
        </ul>`}
        <button class="btn btn-ghost" data-tab="patterns">See all patterns</button>
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
  wireLogButtons(root, actions);
}

function queueItemHtml(state, p) {
  return `
    <li class="queue-item">
      <div>
        <div class="row gap-sm">
          <span class="pill">${esc(patternName(state, p.patternId))}</span>
          <span class="pill pill-muted">${esc(p.difficulty)}</span>
          <span class="pill ${overdueLabel(p.nextReviewDate).includes("overdue") ? "pill-warn" : "pill-muted"}">${overdueLabel(p.nextReviewDate)}</span>
        </div>
        <div class="queue-name">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}${p.number ? ` <span class="muted">#${p.number}</span>` : ""}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-log-problem="${esc(p.id)}">Log a rep</button>
    </li>`;
}

function wireTabButtons(root, actions) {
  root.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => actions.switchTab(btn.dataset.tab));
  });
}
function wireLogButtons(root, actions) {
  root.querySelectorAll("[data-log-problem]").forEach((btn) => {
    btn.addEventListener("click", () => {
      nav.prefillProblemId = btn.dataset.logProblem;
      actions.switchTab("log");
    });
  });
}

// ---------- Review Queue ----------

export function renderQueue(root, store, actions) {
  const state = store.state;
  const due = dueProblems(state);
  root.innerHTML = `
    <div class="card">
      <h2>Review queue</h2>
      <p class="muted">Weakest / most-overdue first. Today's budget is ${state.settings.dailyBudgetMin} min.</p>
      ${due.length === 0 ? `<p class="empty">Queue's clear.</p>` : `
      <ul class="queue-list">${due.map((p) => queueItemHtml(state, p)).join("")}</ul>`}
    </div>`;
  wireLogButtons(root, actions);
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
      <h2>Log a session</h2>
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

        <label class="field"><span class="label">Soul statement</span>
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

export function renderPatterns(root, store) {
  const state = store.state;
  const stats = patternStats(state).sort((a, b) => (a.solvedCleanRate ?? 1) - (b.solvedCleanRate ?? 1));
  root.innerHTML = `
    <div class="card">
      <h2>Pattern mastery</h2>
      <p class="muted">Weakest first — this is what "next 2 weeks of focus" should be picked from.</p>
      <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Pattern</th><th># problems</th><th>Attempts</th><th>Clean-solve rate</th><th>Trend</th><th>ID'd correctly</th><th>Avg time to insight</th><th>Top mistake</th></tr></thead>
        <tbody>
          ${stats.map((s) => `
            <tr>
              <td>${esc(s.pattern.name)}</td>
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
}

// ---------- Mock Interview ----------

let mockTimer = { running: false, endsAt: null, plannedMin: 45, intervalId: null };

export function renderMock(root, store, actions) {
  const state = store.state;
  const past = [...state.mocks].reverse();

  root.innerHTML = `
    <div class="card">
      <h2>Mock interview</h2>
      ${mockTimer.running ? mockRunningHtml() : mockStartHtml()}
    </div>
    <div class="card">
      <h2>Past mocks</h2>
      ${past.length === 0 ? `<p class="empty">None logged yet.</p>` : `
      <ul class="queue-list">
        ${past.map((m) => `
          <li class="queue-item">
            <div>
              <div class="row gap-sm">
                <span class="pill ${m.outcome === "solved-clean" ? "pill-good" : "pill-muted"}">${esc(m.outcome)}</span>
                <span class="pill pill-muted">${fmtDate(m.date)}</span>
              </div>
              <div class="queue-name">${esc(state.problems.find((p) => p.id === m.problemId)?.name || "Untitled")}${m.communicationRating ? ` · comms ${m.communicationRating}/5` : ""}</div>
            </div>
          </li>`).join("")}
      </ul>`}
    </div>`;

  if (mockTimer.running) {
    wireMockRunning(root, store, actions);
  } else {
    root.querySelector("#start-mock").addEventListener("click", () => {
      const durationInput = root.querySelector("#mock-duration");
      mockTimer.plannedMin = Number(durationInput.value) || 45;
      mockTimer.running = true;
      mockTimer.endsAt = Date.now() + mockTimer.plannedMin * 60000;
      actions.rerender();
      startTicking(actions);
    });
  }
}

function mockStartHtml() {
  return `
    <p class="muted">45 minutes, verbalized, no pausing to think quietly. Pick a due problem from the
    queue first, then start the clock.</p>
    <label class="field inline"><span class="label">Duration (min)</span>
      <input class="input" id="mock-duration" type="number" value="45" style="max-width:6rem" /></label>
    <button class="btn btn-primary" id="start-mock">Start mock</button>`;
}

function mockRunningHtml() {
  return `
    <div class="mock-timer" id="mock-clock">--:--</div>
    <ul class="checklist">
      ${MOCK_CHECKLIST.map((item, i) => `<li><label><input type="checkbox" data-check="${i}" /> ${esc(item)}</label></li>`).join("")}
    </ul>
    <button class="btn btn-primary" id="finish-mock">Finish mock</button>`;
}

function startTicking(actions) {
  clearInterval(mockTimer.intervalId);
  mockTimer.intervalId = setInterval(() => {
    const clock = document.getElementById("mock-clock");
    if (!clock) {
      clearInterval(mockTimer.intervalId);
      return;
    }
    const remainMs = mockTimer.endsAt - Date.now();
    const sign = remainMs < 0 ? "-" : "";
    const total = Math.abs(Math.round(remainMs / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    clock.textContent = `${sign}${m}:${s}`;
    clock.classList.toggle("overtime", remainMs < 0);
  }, 250);
}

function wireMockRunning(root, store, actions) {
  root.querySelectorAll("[data-check]").forEach((cb) => {
    cb.addEventListener("change", () => {
      mockTimer.checklist = mockTimer.checklist || {};
      mockTimer.checklist[cb.dataset.check] = cb.checked;
    });
  });
  root.querySelector("#finish-mock").addEventListener("click", () => {
    clearInterval(mockTimer.intervalId);
    const actualMin = Math.max(0, Math.round((mockTimer.plannedMin * 60000 - (mockTimer.endsAt - Date.now())) / 60000));
    renderMockComplete(root, store, actions, actualMin, mockTimer.checklist || {});
    mockTimer = { running: false, endsAt: null, plannedMin: 45, intervalId: null };
  });
}

function renderMockComplete(root, store, actions, actualMin, checklist) {
  const state = store.state;
  const due = dueProblems(state);
  root.querySelector(".card").innerHTML = `
    <h2>Mock complete — ${actualMin} min</h2>
    <form id="mock-complete-form" class="form">
      <label class="field"><span class="label">Problem</span>
        <select class="select" name="problemId">
          <option value="">— unspecified —</option>
          ${state.problems.map((p) => `<option value="${esc(p.id)}" ${due.some((d) => d.id === p.id) ? "" : ""}>${esc(p.name)}</option>`).join("")}
        </select></label>
      <label class="field"><span class="label">Outcome</span>
        <select class="select" name="outcome">
          <option value="solved-clean">Solved clean</option>
          <option value="solved-struggled">Solved, struggled</option>
          <option value="failed">Didn't solve</option>
        </select></label>
      <label class="field"><span class="label">Communication rating (1-5)</span>
        <input class="input" type="number" min="1" max="5" name="communicationRating" /></label>
      <label class="field"><span class="label">Notes</span>
        <textarea class="textarea" name="notes" rows="3"></textarea></label>
      <button class="btn btn-primary" type="submit">Save mock</button>
    </form>`;
  root.querySelector("#mock-complete-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    store.mutate((s) => {
      const outcome = f.get("outcome");
      s.mocks.push({
        id: uid(),
        date: todayISO(),
        problemId: f.get("problemId") || null,
        outcome,
        communicationRating: f.get("communicationRating") ? Number(f.get("communicationRating")) : null,
        durationActualMin: actualMin,
        notes: f.get("notes") || "",
        checklist,
      });
      const problem = s.problems.find((p) => p.id === f.get("problemId"));
      if (problem) applyOutcome(problem, outcome, s.settings);
      updateStreak(s);
    }, "Ledger: log mock interview");
    toast("Mock saved.");
    actions.switchTab("mock");
  });
}

// ---------- Journal ----------

export function renderJournal(root, store) {
  const state = store.state;
  const entries = allAttempts(state).filter((a) => a.soulStatement).reverse();
  const notes = [...state.journal].reverse();

  root.innerHTML = `
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
      ${notes.length === 0 ? `<p class="empty">No freeform notes yet.</p>` : `
      <ul class="journal-list">
        ${notes.map((n) => `<li><div class="row space-between"><strong>${esc(n.type.replace(/-/g, " "))}</strong><span class="muted">${fmtDate(n.date)}</span></div><p>${esc(n.text)}</p></li>`).join("")}
      </ul>`}
    </div>
    <div class="card">
      <h2>Soul statements</h2>
      ${entries.length === 0 ? `<p class="empty">Log a session to start building this archive.</p>` : `
      <ul class="journal-list">
        ${entries.map((a) => `
          <li>
            <div class="row space-between">
              <strong>${esc(a.problemName)}</strong>
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
      <div class="row gap">
        <div class="stat"><span class="stat-num">${sd.mocksLogged}/${sd.minMocks}</span><span class="stat-label">mocks logged</span></div>
        <div class="stat"><span class="stat-num">${pct(sd.recentSolvedCleanRate)}</span><span class="stat-label">recent clean-solve (need ${pct(sd.minSolvedCleanRate)})</span></div>
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
      ${sessions.length === 0 ? `<p class="empty">None yet.</p>` : `
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

export function renderTopics(root, store, actions) {
  const state = store.state;
  const stats = patternStats(state);
  const statByPattern = Object.fromEntries(stats.map((s) => [s.pattern.id, s]));

  root.innerHTML = `
    <div class="card">
      <h2>Topics</h2>
      <p class="muted">The concept, how to recognize it, the invariant that makes it work, and the
      pitfalls that actually cost people in interviews — plus your own logged problems as the practice
      ladder for each, so it stays current instead of linking to problems you haven't touched.</p>
    </div>
    ${state.patterns.map((pat) => {
      const t = TOPICS[pat.id];
      const s = statByPattern[pat.id];
      const problems = state.problems.filter((p) => p.patternId === pat.id)
        .sort((a, b) => (a.difficulty === b.difficulty ? 0 : DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]));
      const resources = (state.resources[pat.id] || []);
      return `
      <details class="card topic-card">
        <summary>
          <span class="topic-title">${esc(pat.name)}</span>
          ${s && s.attempts ? `<span class="pill ${pct(s.solvedCleanRate)[0] === "1" ? "pill-good" : "pill-muted"}">${pct(s.solvedCleanRate)} clean-solve</span>` : `<span class="pill pill-muted">not practiced yet</span>`}
        </summary>
        <p>${esc(pat.description)}</p>
        ${t ? `
        <p><strong>Concept.</strong> ${esc(t.concept)}</p>
        <p><strong>Recognize it from:</strong> ${t.recognize.map((r) => `<span class="pill pill-muted">${esc(r)}</span>`).join(" ")}</p>
        <p><strong>Invariant.</strong> ${esc(t.invariant)}</p>
        <p><strong>Pitfalls</strong></p>
        <ul class="tight-list">${t.pitfalls.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        ` : ""}
        <p><strong>Practice ladder</strong> (your own logged problems, easiest first)</p>
        ${problems.length === 0 ? `<p class="empty">None logged yet.</p>` : `
        <ul class="queue-list">${problems.map((p) => queueItemHtml(state, p)).join("")}</ul>`}
        <p><strong>Resources</strong></p>
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
      </details>`;
    }).join("")}`;

  wireLogButtons(root, actions);
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

const DIFFICULTY_ORDER = { Easy: 0, Medium: 1, Hard: 2, Unrated: 1.5 };

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
        <p class="empty">Log a few problems first — the quiz draws its questions from problems you've
        actually attempted.</p>
      </div>`;
    return;
  }

  const p = quizState.current;
  root.innerHTML = `
    <div class="card">
      <div class="row space-between">
        <h2>Pattern-recognition drill</h2>
        <span class="muted small">${correct}/${total} lifetime${total ? ` (${pct(correct / total)})` : ""}</span>
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
          return `<button type="button" class="${cls}" data-answer="${esc(optId)}" ${quizState.answered ? "disabled" : ""}>${esc(pat.name)}</button>`;
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

// ---------- Whiteboard ----------

let activeWhiteboard = null;

export function renderWhiteboard(root, store, actions) {
  const state = store.state;
  const boards = [...state.whiteboards].reverse();

  root.innerHTML = `
    <div class="card">
      <h2>Whiteboard</h2>
      <p class="muted">Draw out the problem — arrays, pointers, a call stack, whatever helps you think.
      Works with mouse, touch, or a stylus. Saves as its own image file in your repo.</p>
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
      ${boards.length === 0 ? `<p class="empty">Nothing saved yet.</p>` : `
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
      <form id="budget-form" class="form">
        <label class="field inline"><span class="label">Minutes per day</span>
          <input class="input" type="number" name="dailyBudgetMin" value="${state.settings.dailyBudgetMin}" style="max-width:6rem" /></label>
        <button class="btn btn-primary" type="submit">Save</button>
      </form>
    </div>
    <div class="card">
      <h2>GitHub connection</h2>
      <p class="muted">${esc(cfg.owner)}/${esc(cfg.repo)} @ ${esc(cfg.branch)} — <code>${esc(cfg.path)}</code></p>
      <button class="btn btn-ghost" id="disconnect">Disconnect this device</button>
    </div>
    <div class="card">
      <h2>Backup</h2>
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

  root.querySelector("#export-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-export-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

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
