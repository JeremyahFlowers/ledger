// Settings: the connection, the numbers that drive the schedule, and the
// state of your data.
//
// Where this fits: its own page, and the only one that writes to
// state.settings. It is also where the app is at its most honest — the sync
// footprint, the fault log and the import inspector all exist so that when
// something goes wrong you can see what, rather than being told to try again.

import {
  parseBoxIntervals, validateBoxIntervals, syncFootprint, formatBytes,
  dayTimerElapsedMs, dayTimerAdjustmentMin, adjustDayTimer,
  questionMinutes, planMinutes, questionPlan, READ_MINUTES, REFLECT_MINUTES, inspectImport,
  describeState,
} from "./logic.js";
import { splitBudget, designShare, designAttempts } from "./design-logic.js";
import { APP_VERSION, RELEASED } from "./version.js";
import { migrateState } from "./seed.js";
import { resetWelcome } from "./welcome.js";
import { recentFaults, clearFaults, report, AppError } from "./errors.js";
import { esc, toast, downloadState, confirmLoss } from "./ui.js";
import { storageKey } from "./channel.js";


// ---------- Settings ----------

/**
 * Anything that has gone wrong this session.
 *
 * Hidden when there is nothing to report, so it is never a worry on a healthy
 * install. It exists because the console is not reachable on a phone, and
 * "something went wrong" with no detail leaves nobody able to act.
 */
/**
 * How close the synced log is to the size GitHub will accept.
 *
 * Hidden until it matters. A storage meter on an otherwise healthy install is
 * an anxiety with nothing attached to it — but crossing the limit fails every
 * save at once, so the warning has to arrive while shedding weight is still a
 * choice.
 */
function footprintCardHtml(state) {
  const f = syncFootprint(state);
  if (!f.warn) return "";
  const pct = Math.round(f.fraction * 100);
  return `
    <div class="card ${f.over ? "banner banner-bad" : "banner banner-warn"}">
      <h2 style="margin-top:0">${f.over ? "Your log is too large to sync" : "Your log is getting large"}</h2>
      <p class="small">${esc(formatBytes(f.total))} of ${esc(formatBytes(f.limit))} used (${pct}%).
      ${f.over
        ? "Saves are failing until this comes down. Nothing is lost — it's all still on this device."
        : "Everything still saves normally; this is a heads-up while there's room to act."}</p>
      <ul class="footprint-list muted small">
        <li><strong>${esc(formatBytes(f.breakdown.attempts))}</strong> — your ${f.counts.attempts}
          logged attempts, everything they hold. Of that,
          ${esc(formatBytes(f.breakdown.code))} is saved code from ${f.counts.withCode} of them
          and ${esc(formatBytes(f.breakdown.notes))} is what you wrote.</li>
        <li><strong>${esc(formatBytes(f.breakdown.statements))}</strong> — problem statements,
          across ${f.counts.withStatement} problems.</li>
        <li><strong>${esc(formatBytes(f.breakdown.rest))}</strong> — everything else: the problems
          themselves, settings, your streak, mocks and the journal.</li>
      </ul>
      <p class="muted small">Attempts are what grows, and they grow forever — each one costs about
      the same whether or not you keep its code. Deleting a problem you have finished with takes its
      attempts and its statement with it, which is the largest single thing you can do. An attempt
      you don't need can go from that problem's history.</p>
    </div>`;
}

/** How long ago, in words. Coarse on purpose: the useful distinction is
 * "just now" against "before you shut the laptop", not the exact minute. */
function agoText(ms) {
  if (!ms) return "not yet this session";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Sync state, and the controls for it.
 *
 * "Synced" in the header says the last attempt worked, not when — and there
 * was no way to pull a change made on another device short of reloading, or to
 * retry a failed push without making another change first.
 */
function syncCardHtml(store) {
  const unsaved = store.dirty;
  // Spelled out rather than left to a tooltip. If saving has actually stopped,
  // the one thing someone needs to know is whether to keep working — and a
  // title attribute is not where anyone looks for that.
  const stalled = store.status === "offline" || store.status === "error";
  return `
    <div class="card">
      <h2>Sync</h2>
      <p class="muted small">
        Last synced ${esc(agoText(store.lastSyncedAt))}.
        ${unsaved
          ? "You have changes that haven't reached GitHub yet."
          // Only claimed when a sync has actually succeeded. It read
          // "Everything here is on GitHub" beside a 401, which is the kind of
          // confident wrong answer that stops people trusting the rest.
          : store.lastSyncedAt ? "Everything here is on GitHub."
          : "Nothing has reached GitHub yet."}
        ${store.error ? `<br/><span class="budget-warn">${esc(store.error)}</span>` : ""}
      </p>
      ${stalled ? `<p class="banner banner-warn small" style="margin:0.5rem 0">
        <strong>Keep working — nothing is lost.</strong> Everything is saved on this device and will
        go to GitHub on its own once it can. Until then this is the only copy, so avoid clearing your
        browser data or switching devices.</p>` : ""}
      <div class="row gap-sm" style="margin-top:0.6rem;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="sync-pull" ${unsaved ? "disabled" : ""}
          title="${unsaved ? "Save your changes first" : "Fetch changes made on another device"}">Check for changes</button>
        <button class="btn btn-ghost btn-sm" id="sync-push" ${unsaved ? "" : "disabled"}
          title="${unsaved ? "Send your unsaved changes now" : "Nothing waiting to send"}">Save now</button>
      </div>
    </div>`;
}

function faultLogHtml() {
  const faults = recentFaults();
  if (!faults.length) return "";
  return `
    <div class="card">
      <h2>Recent problems</h2>
      <p class="muted small">${faults.length} this session. These are already handled — the app
      kept working — but they are worth reporting if something looks wrong.</p>
      <ul class="fault-list">
        ${faults.map((f) => `<li>${esc(f.at.slice(11, 19))} · ${esc(f.code)}${f.context ? ` · ${esc(f.context)}` : ""} — ${esc(f.message)}</li>`).join("")}
      </ul>
      <button class="btn btn-ghost btn-sm" id="clear-faults" style="margin-top:0.6rem">Clear</button>
    </div>`;
}

/**
 * How much of the day goes to system design.
 *
 * Off by default, including for every log that existed before this shipped.
 * The two halves belong in the same day — that is the whole premise — but
 * taking minutes from somebody who never asked for it is not how it gets there.
 *
 * Expressed as a share rather than a number of minutes so it survives changing
 * the daily budget: raise the day from 75 to 90 and the split moves with it,
 * rather than quietly becoming a different ratio.
 */
const DESIGN_PRESETS = [
  { share: 0, label: "Off", note: "Coding only." },
  { share: 0.2, label: "A fifth", note: "A design problem every few days." },
  { share: 0.4, label: "Two fifths", note: "45 coding / 30 design in a 75-minute day." },
  { share: 0.5, label: "Half and half", note: "For when the design round is the one you are worried about." },
];

function designCardHtml(state) {
  const split = splitBudget(state);
  const current = designShare(state);
  const worked = designAttempts(state).length;
  return `
    <div class="card">
      <h3>System design share</h3>
      <p class="muted small">System design is assessed in the same loop as coding and is worth
      preparing in the same loop. This decides how much of your daily budget goes to it — the
      minutes are split, not added, so the day stays the length you set.</p>
      <form id="design-share-form" class="form">
        <div class="row gap-sm" style="flex-wrap:wrap">
          ${DESIGN_PRESETS.map((preset) => `
            <label class="field checkbox-field" style="flex:1 1 12rem">
              <input type="radio" name="designShare" value="${preset.share}"
                ${Math.abs(current - preset.share) < 0.001 ? "checked" : ""} />
              <span><strong>${esc(preset.label)}</strong><br />
              <span class="muted small">${esc(preset.note)}</span></span>
            </label>`).join("")}
        </div>
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
      </form>
      <p class="muted small">${split.enabled
        ? `Today: ${split.codingMin} minutes coding, ${split.designMin} design.`
        : "Today: all of it is coding."}${worked ? ` ${worked} design attempt${worked === 1 ? "" : "s"} recorded.` : ""}</p>
    </div>`;
}

/**
 * Where the live relay is, if there is one.
 *
 * Optional, and the app is complete without it: with no relay, a drawing still
 * follows you between devices within a few seconds, because the durable copy in
 * your own repo is what makes that work. The relay only makes it immediate,
 * which matters when two screens are open at once — a tablet beside a laptop,
 * or an interviewer watching.
 *
 * Empty by default, deliberately. Pointing this at somebody else's server means
 * a session's strokes and code pass through it, and that should be a thing you
 * typed in rather than a default you inherited.
 */
function liveSyncCardHtml(state) {
  const url = state.settings?.relayUrl || "";
  return `
    <div class="card">
      <h3>Live sync</h3>
      <p class="muted small">Without this, a drawing follows you between devices in a few seconds,
      through your own repo. With it, a stroke appears on the other screen as you draw — which is
      what two screens at once needs, and what a mock interview with somebody watching needs.</p>
      <p class="muted small">It relays and stores nothing, and only ever carries the session in
      front of you: the problem, the drawing, the code. Never your log. Run your own with
      <code>node relay/server.mjs</code> — see <code>relay/README.md</code>.</p>
      <form id="relay-form" class="settings-form">
        <label class="field"><span class="label">Relay address</span>
          <input class="input" name="relayUrl" type="url" placeholder="https://your-relay.example.com"
                 value="${esc(url)}" style="max-width:22rem" /></label>
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
      </form>
      <p class="muted small">${url
        ? "Sessions started from now on will use it. Leave it empty to turn live sync off."
        : "Off. Everything works; cross-device updates just take a few seconds instead of a moment."}</p>
    </div>`;
}

/**
 * How long one question gets, and how much of it is for planning.
 *
 * Two tables rather than one, because they answer different questions. The
 * total is how long you are giving yourself; the planning share is the
 * judgement call — too low trains you to type before you know the shape of the
 * answer, which is the commonest way a solvable problem goes wrong, and too
 * high leaves you with a good plan and no clock.
 *
 * Reading and reflecting are not settable. Reading is five minutes whether the
 * problem is easy or hard, and the reflection is the thing this app exists to
 * collect — making it adjustable would make it the first thing to be set to
 * zero.
 */
const TIMEBOX_DIFFICULTIES = ["Easy", "Medium", "Hard", "Unrated"];

function timeboxCardHtml(state) {
  const total = (d) => questionMinutes(state, d);
  const planning = (d) => planMinutes(state, d);
  return `
    <div class="card">
      <h3>Time per question</h3>
      <p class="muted small">A box for one problem, so a single medium can't absorb the whole day.
      Nothing stops when a phase ends — the session says where you are and what the phase is for,
      and going over is counted rather than hidden. ${READ_MINUTES} minutes for reading and
      ${REFLECT_MINUTES} for writing down what happened come off the top of every box.</p>
      <form id="timebox-form">
        <div class="table-wrap">
          <table class="table timebox-table">
            <thead><tr><th>Difficulty</th><th>Total</th><th>Of that, planning</th><th>Leaves for code</th></tr></thead>
            <tbody>
              ${TIMEBOX_DIFFICULTIES.map((d) => {
                const phases = questionPlan(state, d).phases;
                const code = phases.find((x) => x.key === "code");
                return `
                <tr>
                  <td>${esc(d)}</td>
                  <td><input class="input input-xs" type="number" min="1" max="240"
                        name="total-${esc(d)}" value="${total(d)}" aria-label="${esc(d)} total minutes" /></td>
                  <td><input class="input input-xs" type="number" min="1" max="240"
                        name="plan-${esc(d)}" value="${planning(d)}" aria-label="${esc(d)} planning minutes" /></td>
                  <td class="num muted">${code ? `${code.minutes} min` : "—"}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        <button class="btn btn-primary btn-sm" type="submit">Save times</button>
      </form>
    </div>`;
}

/**
 * Today's clock, and the ability to correct it.
 *
 * It feeds the budget ring and the plant's health, and until now it could only
 * run or pause — leave it going over lunch and the day was spent, with no way
 * to say otherwise. A number you cannot correct is a number you stop trusting,
 * and then stop looking at, which costs more than the wrong forty minutes did.
 *
 * Here rather than on the widget, which the plant deliberately keeps to a
 * visual cue and one pause button, and rather than on the Dashboard, where a
 * budget card was tried and disliked. The correction belongs beside the number
 * it corrects.
 */
function clockCardHtml(state) {
  const used = Math.round(dayTimerElapsedMs(state) / 60000);
  const correction = Math.round(dayTimerAdjustmentMin(state));
  return `
    <div class="card">
      <h3>Today's clock</h3>
      <p class="muted small">What the day clock has counted so far. Correct it if it ran while you
      weren't working — the reading it measured is kept, and the correction is shown as one.</p>
      <div class="row gap-sm" style="align-items:baseline">
        <span class="stat-num">${used}</span><span class="stat-label">min today</span>
        <span class="row gap-sm" style="margin-left:auto">
          ${[-30, -15, -5, 5].map((d) => `<button type="button" class="btn btn-ghost btn-xs"
            data-adjust-clock="${d}">${d > 0 ? "+" : ""}${d}</button>`).join("")}
        </span>
      </div>
      ${correction
        ? `<p class="muted small">Includes a correction of ${correction > 0 ? "+" : ""}${correction}
           min. <button type="button" class="link-button" id="clear-clock-correction">Undo it</button></p>`
        : ""}
    </div>`;
}

export function renderSettings(root, store, actions) {
  const state = store.state;
  const cfg = JSON.parse(localStorage.getItem(storageKey("ledger.config")) || "{}");

  root.innerHTML = `
    <!-- Anything wrong sits above the sections, unheaded, because it is a
         state of the app rather than something you came here to change.
         All three render nothing when there is nothing to say. -->
    ${syncCardHtml(store)}
    ${footprintCardHtml(store.state)}
    ${faultLogHtml()}

    <nav class="settings-jump" aria-label="Settings sections">
      <a href="#set-practice">How practice works</a>
      <a href="#set-data">Your data</a>
      <a href="#set-app">This app</a>
    </nav>

    <section class="settings-section">
      <h2 id="set-practice" tabindex="-1">How practice works</h2>
      <p class="muted small">The two numbers the schedule is built out of. Changing either affects
      what comes up next; nothing already recorded is altered.</p>
<div class="card">
      <h3>Daily budget</h3>
      <p class="muted small">A ceiling, not a target. Today's plan is filled up to this many minutes
      with whatever you find hardest and haven't seen in longest, and the rest is left for the refresher
      queue rather than onto today. Finishing the plan is a complete day — the app will say so and
      stop asking for more.</p>
      <form id="budget-form" class="settings-form">
        <label class="field inline"><span class="label">Minutes per day</span>
          <input class="input" type="number" name="dailyBudgetMin" min="10" max="480"
                 value="${state.settings.dailyBudgetMin}" style="max-width:6rem" /></label>
        <button class="btn btn-primary" type="submit">Save</button>
      </form>
    </div>
${timeboxCardHtml(store.state)}
${designCardHtml(store.state)}
${liveSyncCardHtml(store.state)}
${clockCardHtml(store.state)}
<div class="card">
      <h3>Review intervals</h3>
      <p class="muted small">How long each box waits before a problem comes round again. A clean
      solve moves up a box, a struggle holds, a failure drops back to the first. The defaults are
      a standard Leitner ladder; shorten them if things are fading before they come back, lengthen
      them if refreshers feel unnecessary.</p>
      <form id="intervals-form" class="settings-form">
        <label class="field"><span class="label">Days per box, in order</span>
          <input class="input" name="boxIntervalsDays" style="max-width:18rem"
            value="${esc(state.settings.boxIntervalsDays.join(", "))}" /></label>
        <button class="btn btn-primary btn-sm" type="submit">Save intervals</button>
      </form>
      <p class="muted small" style="margin-top:0.5rem">Currently ${state.settings.boxIntervalsDays.length}
      boxes: ${state.settings.boxIntervalsDays.map((d, i) => `box ${i} after ${d} day${d === 1 ? "" : "s"}`).join(", ")}.
      Changing these affects when problems next come up; nothing already recorded is altered.</p>
    </div>
    </section>

    <section class="settings-section">
      <h2 id="set-data" tabindex="-1">Your data</h2>
      <p class="muted small">Where the log lives, and how to get a copy of it.</p>
<div class="card">
      <h3>GitHub connection</h3>
      <p class="muted">${esc(cfg.owner)}/${esc(cfg.repo)} @ ${esc(cfg.branch)} — <code>${esc(cfg.path)}</code></p>
      <p class="muted small">Every change is written straight to that file, which is what lets the
      same log follow you between laptop and phone. Disconnecting only forgets the token on this
      device — nothing on GitHub is touched, and reconnecting brings it all back.</p>
      <button class="btn btn-ghost" id="disconnect">Disconnect this device</button>
    </div>
<div class="card">
      <h3>Backup</h3>
      <p class="muted small">Your prep log already lives in version control, so this is for moving it
      somewhere else or keeping a copy outside GitHub. The export is the whole state — problems,
      attempts, soul statements, streaks. Importing replaces everything currently here.</p>
      <div class="row gap">
        <button class="btn btn-ghost" id="export-json">Export JSON</button>
        <label class="btn btn-ghost file-btn">Import JSON<input type="file" id="import-json" accept="application/json" hidden /></label>
      </div>
    </div>
    </section>

    <section class="settings-section">
      <h2 id="set-app" tabindex="-1">This app</h2>
      <div class="card version-card">
        <div class="row space-between" style="align-items:baseline;flex-wrap:wrap;gap:0.5rem">
          <h3 style="margin:0">Ledger <span class="version-number">v${esc(APP_VERSION)}</span></h3>
          <span class="muted small">released ${esc(RELEASED)}</span>
        </div>
        <p class="muted small" style="margin:0.4rem 0 0">What changed in this version, and every one
        before it, is in <a href="https://github.com/JeremyahFlowers/ledger/blob/main/CHANGELOG.md"
        target="_blank" rel="noopener noreferrer">the changelog</a>.</p>
        <button class="btn btn-ghost btn-sm" id="replay-welcome" style="margin-top:0.6rem">What is this app for?</button>
      </div>
<div class="card">
      <h3>Theme</h3>
      <select class="select" id="theme-select" style="max-width:12rem">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
    </section>`;

  root.querySelector("#design-share-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = Number(new FormData(e.target).get("designShare"));
    const share = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0;
    store.mutate((st) => { st.settings.designShare = share; }, "Ledger: set the design share");
    const split = splitBudget({ settings: { ...store.state.settings, designShare: share } });
    toast(share
      ? `${split.codingMin} minutes coding, ${split.designMin} design.`
      : "System design off — the whole day is coding.");
    actions.rerender();
  });

  root.querySelector("#relay-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = String(new FormData(e.target).get("relayUrl") || "").trim();
    if (raw) {
      // Checked here rather than left to fail silently at session start, where
      // the only symptom would be sync not happening for no stated reason.
      let parsed;
      try {
        parsed = new URL(raw);
      } catch (_) {
        toast("That isn't a web address. It should look like https://your-relay.example.com");
        return;
      }
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        toast("Use https — an http relay would send your session in the clear.");
        return;
      }
    }
    store.mutate((st) => { st.settings.relayUrl = raw; }, "Ledger: set live sync relay");
    toast(raw ? "Live sync on for new sessions." : "Live sync off.");
    actions.rerender();
  });

  root.querySelector("#timebox-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const read = (prefix, d) => {
      const raw = Number(f.get(`${prefix}-${d}`));
      return Number.isFinite(raw) && raw >= 1 ? Math.min(240, Math.round(raw)) : null;
    };
    const totals = {};
    const plans = {};
    for (const d of TIMEBOX_DIFFICULTIES) {
      const t = read("total", d);
      const p = read("plan", d);
      if (t == null || p == null) {
        toast(`${d} needs a number of minutes, at least 1.`);
        return;
      }
      totals[d] = t;
      // Clamped against its own total rather than refused: planning longer than
      // the whole box is a typo, and the useful response is the largest thing
      // they could have meant.
      plans[d] = Math.min(p, Math.max(1, t - READ_MINUTES - REFLECT_MINUTES - 1));
    }
    store.mutate((st) => {
      st.settings.questionMinutes = totals;
      st.settings.planMinutes = plans;
    }, "Ledger: update time per question");
    const clamped = TIMEBOX_DIFFICULTIES.filter((d) => plans[d] !== read("plan", d));
    toast(clamped.length
      ? `Saved. Planning time trimmed for ${clamped.join(", ")} to leave room to code.`
      : "Saved.");
    actions.rerender();
  });

  root.querySelectorAll("[data-adjust-clock]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const asked = Number(btn.dataset.adjustClock);
      let applied = 0;
      store.mutate((s) => { applied = adjustDayTimer(s, asked); }, "Ledger: correct today's clock");
      // Says what happened rather than what was asked for: subtracting half an
      // hour from a ten-minute day removes ten minutes, because the rest of it
      // never happened.
      toast(applied === asked
        ? `${applied > 0 ? "Added" : "Removed"} ${Math.abs(Math.round(applied))} min.`
        : `Removed ${Math.abs(Math.round(applied))} min — that was all there was on the clock.`);
      actions.rerender();
    });
  });

  root.querySelector("#clear-clock-correction")?.addEventListener("click", () => {
    store.mutate((s) => { s.dayTimer.adjustmentMs = 0; }, "Ledger: undo clock correction");
    toast("Correction removed.");
    actions.rerender();
  });

  root.querySelector("#replay-welcome")?.addEventListener("click", () => {
    resetWelcome();
    actions.rerender();
  });

  root.querySelector("#sync-pull")?.addEventListener("click", async () => {
    try {
      await store.refreshFromRemote();
      toast("Up to date.");
    } catch (err) {
      report(new AppError(err.message || "Couldn't reach GitHub.", { code: err.code || "sync_pull", cause: err }),
        "checking for changes");
    }
  });
  root.querySelector("#sync-push")?.addEventListener("click", async () => {
    await store.flush("Ledger: manual save");
    toast(store.dirty ? "Still unsaved — see the message above." : "Saved to GitHub.");
  });

  root.querySelector("#clear-faults")?.addEventListener("click", () => {
    clearFaults();
    actions.rerender();
  });

  root.querySelector("#intervals-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = new FormData(e.target).get("boxIntervalsDays");
    const values = parseBoxIntervals(raw);
    const check = validateBoxIntervals(values);
    if (!check.ok) {
      // Refused with the reason, not silently ignored: a bad table here is
      // not a bad preference, it is a schedule that stops working.
      report(new AppError(check.errors.join(" "), { code: "bad_intervals" }), "saving your intervals");
      return;
    }
    store.mutate((s) => {
      s.settings.boxIntervalsDays = values;
      // Existing problems may now sit in a box the new table no longer has.
      for (const p of s.problems) p.box = Math.min(p.box || 0, values.length - 1);
    }, "Ledger: update review intervals");
    toast("Saved — this affects when problems next come up.");
  });

  root.querySelector("#budget-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Number(new FormData(e.target).get("dailyBudgetMin")) || 75;
    store.mutate((s) => { s.settings.dailyBudgetMin = v; }, "Ledger: update daily budget");
    toast("Saved.");
  });

  root.querySelector("#disconnect").addEventListener("click", () => {
    if (confirmLoss({
      action: "Disconnect this device?",
      lost: "the token and the cached copy stored in this browser",
      kept: "everything in your repo — reconnect here and it all comes back",
    })) {
      store.disconnect();
    }
  });

  root.querySelector("#export-json").addEventListener("click", () => downloadState(state));

  root.querySelector("#import-json").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Reset the input so picking the same file twice fires change again —
    // otherwise a refused import cannot be retried after fixing the file.
    e.target.value = "";

    let imported;
    try {
      imported = JSON.parse(await file.text());
    } catch (err) {
      report(new AppError(`${file.name} isn't valid JSON, so nothing was changed.`,
        { code: "import_unparseable", cause: err }), "reading that file");
      return;
    }

    // Checked before anything is touched. This replaces the whole prep log,
    // and it used to accept any JSON that parsed — a truncated download or an
    // unrelated file silently destroyed every problem, attempt and note.
    const found = inspectImport(imported);
    if (!found.ok) {
      report(new AppError(`${file.name} doesn't look like a Ledger backup: ${found.errors.join(" ")} Nothing was changed.`,
        { code: "import_invalid" }), "checking that file");
      return;
    }

    // Confirmed against what it holds and what it would replace, rather than
    // against the word "everything".
    const incoming = `${found.problems} problem${found.problems === 1 ? "" : "s"} and `
      + `${found.attempts} attempt${found.attempts === 1 ? "" : "s"}`
      + (found.appVersion ? `, last written by Ledger ${found.appVersion}` : "");
    if (!confirmLoss({
      action: `Replace your prep log with ${file.name}?`,
      lost: `${describeState(state)} — everything currently on this device`,
      kept: `nothing from before; the file's ${incoming} replaces all of it`,
    })) return;

    store.mutate((s) => {
      // Replaced, not merged. Object.assign left any key the file omitted in
      // place, producing a state half from each — a 2024 problem list beside
      // a 2026 streak.
      for (const key of Object.keys(s)) delete s[key];
      Object.assign(s, migrateState(imported));
    }, "Ledger: import state.json");
    toast(`Imported ${found.problems} problems and ${found.attempts} attempts.`);
  });

  const themeSelect = root.querySelector("#theme-select");
  themeSelect.value = localStorage.getItem(storageKey("ledger.theme")) || "system";
  themeSelect.addEventListener("change", () => {
    const v = themeSelect.value;
    localStorage.setItem(storageKey("ledger.theme"), v);
    document.documentElement.dataset.theme = v === "system" ? "" : v;
  });
}
