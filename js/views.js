import {
  todayISO, applyOutcome, dueProblems, planToday, allAttempts, patternStats,
  updateStreak, systemDesignUnlock, uid, MISTAKE_TAGS, MOCK_CHECKLIST, daysBetween,
} from "./logic.js";

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
        <div class="queue-name">${esc(p.name)}${p.number ? ` <span class="muted">#${p.number}</span>` : ""}</div>
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
  nav.prefillProblemId = null;
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
          <label class="field"><span class="label">Name</span><input class="input" name="newName" /></label>
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

  function syncNewFields() {
    newFields.hidden = select.value !== "__new__";
  }
  select.addEventListener("change", syncNewFields);
  syncNewFields();
  mockCheck.addEventListener("change", () => (mockFields.hidden = !mockCheck.checked));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
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
        <thead><tr><th>Pattern</th><th># problems</th><th>Attempts</th><th>Clean-solve rate</th><th>ID'd correctly</th><th>Avg time to insight</th><th>Top mistake</th></tr></thead>
        <tbody>
          ${stats.map((s) => `
            <tr>
              <td>${esc(s.pattern.name)}</td>
              <td class="num">${s.problemCount}</td>
              <td class="num">${s.attempts}</td>
              <td class="num">${s.attempts ? `<div class="bar bar-inline"><div class="bar-fill" style="width:${Math.round((s.solvedCleanRate || 0) * 100)}%"></div></div>${pct(s.solvedCleanRate)}` : "—"}</td>
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
          </li>`).join("")}
      </ul>`}
    </div>`;

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
