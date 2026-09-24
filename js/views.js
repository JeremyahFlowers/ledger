// The pages that make up the app's spine.
//
// What's left here after the split: the Dashboard, the refresher Queue, the
// Log form, Pattern mastery, the Journal, System Design, Topics and LeetCode.
// They share a file because each is a page over the same one document, and
// none is large enough to be worth its own.
//
// What left, and why: the furniture every page uses is chrome.js; connecting
// and conflict resolution are setup-view.js; the quiz and warm-up are
// drill-view.js; Settings is settings-view.js; a problem's and a day's detail
// are detail-view.js. This file had reached 2,534 lines and sixteen unrelated
// renderers — the same state logic.js was in before cycle 3 split it.
//
// It is no longer a door: every module that wanted `esc` or `startSession`
// used to import them from here, and now names the module they actually live
// in. The facade was load-bearing during the split and nothing but indirection
// afterwards.

import {
  todayISO, applyOutcome, activateProblem, dueProblems, planToday, allAttempts, patternStats,
  updateStreak, systemDesignUnlock, uid, MISTAKE_TAGS, activityByDate, patternTrend,
  recommendSession, computePlantState, streakGraceInfo, refresherStatus, STATUS_ACTIVE,
} from "./logic.js";

import { migrateState } from "./seed.js";

import { patternProgressHtml } from "./progress-view.js";

import { TOPICS } from "./topics-content.js";
import { loadCodeMirror, CODE_MODES } from "./codemirror-loader.js";
import { createWhiteboard } from "./whiteboard.js";

import { patternIcon } from "./icons.js";
import { resetWarmup } from "./drill-view.js";
import { showProblem, showDay } from "./detail-view.js";
import {
  esc, richText, pct, mins, fmtDate, patternName, toast, topicNav, showTopic, outcomeOptions,
  offerUndo,
} from "./ui.js";
import {
  startSession, hasActiveSession, currentSessionProblemName, wireStartButtons,
} from "./session-view.js";

import {
  loadDiagramModules, plantCardHtml, prefill, recencyPill, heatmapSvg,
  leetcodeCalendarToDateCounts, emptyState, trendLineHtml, sparklineSvg, ringSvg, outcomeIcon,
  weekStripSvg, wireBoardViewers,
} from "./chrome.js";

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
    ${hasActiveSession() ? `
    <!-- An unfinished session is the only thing more urgent than today's
         recommendation, and without this there is no way back to one you
         navigated away from. -->
    <div class="card session-cta-card">
      <div class="row space-between session-cta-row">
        <div>
          <h2>Session in progress</h2>
          <p class="muted">${esc(currentSessionProblemName())} — still open, with your code and timer.</p>
        </div>
        <button class="btn btn-primary" id="cta-resume">Back to it</button>
      </div>
    </div>` : ""}
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
            <div class="stat">
              <span class="stat-num">${state.streak.current}</span>
              <!-- Says outright when a rest day is holding the streak
                   together. A streak that quietly papers over a gap is a
                   number the record cannot support, and this app does not
                   get to claim you practised on a day you didn't. -->
              <span class="stat-label">day streak${streakGraceInfo(state).used
                ? ` <span class="muted" title="A rest day this week is covered, so the streak holds.">· incl. a rest day</span>` : ""}</span>
            </div>
            <div class="stat"><span class="stat-num">${state.streak.longest}</span><span class="stat-label">longest</span></div>
          </div>
          <div class="row gap-sm" style="align-items:center">
            ${ringSvg(budgetMin ? usedMin / budgetMin : 0, { size: 40, stroke: 4,
              description: `${usedMin} of ${budgetMin} minutes of work lined up today` })}
            <!-- "lined up", not "today": the standing plant shows minutes
                 actually spent against the same budget, and two rings both
                 labelled "today" against the same denominator read as the
                 same number disagreeing with itself. This one is the size of
                 the work queued; that one is the clock. -->
            <span class="stat-label">${usedMin}/${budgetMin} min<br/>of work lined up</span>
          </div>
        </div>
        <p class="muted small" style="margin:0.6rem 0 0">Last 7 days</p>
        ${weekStripSvg(state)}
        ${trendLineHtml(state)}
      </div>

      <div class="card">
        <h2>Today's plan</h2>
        ${plan.length === 0 ? `<p class="empty">Nothing needs a refresher right now.</p>` : `
        <ul class="queue-list">
          ${plan.map((p) => queueItemHtml(state, p)).join("")}
        </ul>`}
        ${overflow.length ? `<p class="muted small">${overflow.length} more could use a refresher, beyond today's ${budgetMin} min — they'll keep.</p>` : ""}
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
  root.querySelector("#cta-resume")?.addEventListener("click", () => actions.switchTab("workspace"));

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
          ${recencyPill(p)}
        </div>
        <!-- The name opens this problem's own history. It used to be a link
             straight out to LeetCode, which meant the record the app had been
             keeping was the one thing you could not reach from it. -->
        <div class="queue-name"><button type="button" class="link-button" data-open-problem="${esc(p.id)}">${esc(p.name)}</button>${p.number ? ` <span class="muted">#${p.number}</span>` : ""}</div>
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
/** Problem names are buttons into that problem's history; bound here rather
 * than in every view that happens to list one. */
/** Heatmap cells that have something in them open that day. Bound alongside
 * the other cross-view links, since the heatmap appears on more than one
 * page. Keyboard too: they are focusable, so Enter and Space must work. */
export function wireHeatmapDays(root, actions) {
  root.querySelectorAll("[data-heat-day]").forEach((cell) => {
    const open = () => {
      showDay(cell.dataset.heatDay);
      actions.switchTab("dayDetail");
    };
    cell.addEventListener("click", open);
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

export function wireProblemLinks(root, actions) {
  root.querySelectorAll("[data-open-problem]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showProblem(btn.dataset.openProblem);
      actions.switchTab("problemDetail");
    });
  });
}

// ---------- Review Queue ----------

export function renderQueue(root, store, actions) {
  const state = store.state;
  const due = dueProblems(state);
  const today = todayISO();
  // Grouped by how long it's been, not by how late anything is. The bands are
  // the same underlying schedule; only what they're called changed.
  const buckets = { recent: 0, aWhile: 0, longest: 0 };
  due.forEach((p) => {
    const { daysSince } = refresherStatus(p, today);
    if (daysSince == null || daysSince >= 30) buckets.longest++;
    else if (daysSince >= 14) buckets.aWhile++;
    else buckets.recent++;
  });
  const total = due.length || 1;
  root.innerHTML = `
    <div class="card">
      <h2>Ready for a refresher</h2>
      <p class="muted">Whatever you haven't looked at in a while, the ones you find hardest first.
      There's no deadline on any of this — it's here when you want it.</p>
      ${due.length > 0 ? `
      <div class="backlog-bar">
        <div class="backlog-seg" style="width:${(buckets.recent / total) * 100}%; background:var(--accent)"></div>
        <div class="backlog-seg" style="width:${(buckets.aWhile / total) * 100}%; background:var(--warn)"></div>
        <div class="backlog-seg" style="width:${(buckets.longest / total) * 100}%; background:var(--bad)"></div>
      </div>
      <div class="backlog-legend">
        <span style="--_c:var(--accent)">${buckets.recent} from the last fortnight</span>
        <span style="--_c:var(--warn)">${buckets.aWhile} it's been a few weeks</span>
        <span style="--_c:var(--bad)">${buckets.longest} a month or more</span>
      </div>` : ""}
      ${due.length === 0 ? `<p class="empty">Nothing's gone stale — everything you're tracking is recent.</p>` : `
      <ul class="queue-list">${due.map((p) => queueItemHtml(state, p)).join("")}</ul>`}
    </div>`;
  wireStartButtons(root, store, actions);
}

// ---------- Log Session ----------

export function renderLog(root, store, actions) {
  const state = store.state;
  const prefillId = prefill.problemId;
  const prefillName = prefill.name || "";
  const prefillUrl = prefill.url || "";
  prefill.problemId = null;
  prefill.name = null;
  prefill.url = null;
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
                  ${problems.map((p) => `<option value="${esc(p.id)}" ${p.id === prefillId ? "selected" : ""}>${esc(p.name)}${p.number ? ` (#${p.number})` : ""}</option>`).join("")}
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
              ${outcomeOptions()}
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
    // Checked before the mutate, not inside it: a new problem with no name
    // used to abandon the whole submission from within store.mutate, so the
    // form sat there looking untouched and the rep was gone.
    if (f.get("problemId") === "__new__" && !(f.get("newName") || "").trim()) {
      const nameField = form.querySelector('[name="newName"]');
      nameField?.focus();
      toast("Give the problem a name first.");
      return;
    }
    const code = cm ? cm.getValue().trim() : "";
    const codeLang = langSelect.value;
    store.mutate((s) => {
      let problemId = f.get("problemId");
      if (problemId === "__new__") {
        const name = (f.get("newName") || "").trim();
        if (!name) {
          // Inside store.mutate, so this cannot toast from here without the
          // message being lost to the re-render; the submit handler checks
          // first and never reaches this. Kept as a guard, not a refusal.
          return;
        }
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
          // Stated rather than left to migrateState's "no status means active"
          // fallback. That rule exists to read state files written before the
          // field did; new records shouldn't be relying on it.
          status: STATUS_ACTIVE,
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
              <td>${ringSvg(s.attempts ? s.solvedCleanRate || 0 : 0, { size: 34, stroke: 4, label: s.attempts ? pct(s.solvedCleanRate) : "–",
                description: s.attempts ? `${pct(s.solvedCleanRate)} clean-solve rate across ${s.attempts} attempts` : "No attempts yet" })}</td>
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
        <div class="row gap-sm" style="align-items:center">${ringSvg(sd.minMocks ? Math.min(1, sd.mocksLogged / sd.minMocks) : 0, { size: 48, label: `${sd.mocksLogged}/${sd.minMocks}`,
          description: `${sd.mocksLogged} of ${sd.minMocks} mock interviews logged` })}<span class="stat-label">mocks logged</span></div>
        <div class="row gap-sm" style="align-items:center">${ringSvg(sd.recentSolvedCleanRate || 0, { size: 48, color: (sd.recentSolvedCleanRate || 0) >= sd.minSolvedCleanRate ? "var(--good)" : "var(--accent)", label: pct(sd.recentSolvedCleanRate),
          description: `Recent clean-solve rate ${pct(sd.recentSolvedCleanRate)}, need ${pct(sd.minSolvedCleanRate)}` })}<span class="stat-label">recent clean-solve (need ${pct(sd.minSolvedCleanRate)})</span></div>
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
    </div>

    <!-- The pattern's own trend lives here rather than on Progress. Progress
         answers "am I getting better" across everything, which is the right
         question there and useless the moment you know which pattern is weak:
         "0% across 3 attempts" is only actionable next to the attempts that
         made it so. -->
    ${patternProgressHtml(state, pat.id)}`;

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
  // Removing one thing from a list: it happens, and it can be taken back.
  // This was the one destructive action in the app with neither a question
  // nor an undo — the quietest of the three, on the only one with no way back.
  root.querySelectorAll("[data-remove-resource]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [patternId, resourceId] = btn.dataset.removeResource.split("::");
      const removed = (store.state.resources[patternId] || []).find((r) => r.id === resourceId);
      if (!removed) return;
      const at = (store.state.resources[patternId] || []).indexOf(removed);
      store.mutate((s) => {
        s.resources[patternId] = (s.resources[patternId] || []).filter((r) => r.id !== resourceId);
      }, "Ledger: remove resource link");
      offerUndo(store, `Removed ${removed.title || removed.url}.`, (s) => {
        // Back where it was, not appended: the order is the user's.
        const list = s.resources[patternId] || (s.resources[patternId] = []);
        list.splice(Math.min(at, list.length), 0, removed);
      }, "Ledger: restore resource link");
    });
  });
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

  wireBoardViewers(root, store, boards);
}

/**
 * Wire "show this drawing" buttons against a list of boards.
 *
 * Boards are PNGs in the repo rather than in state, so each one is a fetch —
 * hence lazily, on click, rather than loading every thumbnail on render.
 * Shared by the Whiteboard page and a problem's own page, which would
 * otherwise be two copies of the same fetch-decode-insert.
 */

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
      prefill.problemId = existing ? existing.id : "__new__";
      prefill.name = btn.dataset.quickLog;
      prefill.url = `https://leetcode.com/problems/${btn.dataset.quickSlug}/`;
      actions.switchTab("log");
    });
  });
}
