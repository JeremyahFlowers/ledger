// A system-design session: draw first, compare second.
//
// Where this fits: beside session-view.js, which owns the coding session, and
// sharing its parts rather than copying them — the same whiteboard, the same
// event log and sync, the same phase strip, the same checkpointing. What
// differs is the format, and only the format.
//
// The format is the whole point of the feature. A coding session ends when the
// code runs; a design session ends when you compare what you drew against a
// reference and record honestly which components you reached for and which you
// did not. That comparison is the exercise, and it is why the reference is
// locked until the clock stops: reading it first turns an exercise into a
// lecture.

import {
  designPlan, designPhase, designProblemById, componentsFor,
} from "./design-logic.js";
import { componentById } from "./design-logic.js";
import { createWhiteboard } from "./whiteboard.js";
import { createRepoChannel, createEmitter } from "./session-sync.js";
import { createLiveChannel } from "./live-channel.js";
import { deviceId } from "./session-log.js";
import { storageKey } from "./channel.js";
import { uid, todayISO, applyOutcome, updateStreak } from "./logic.js";
import { esc, toast, confirmLoss } from "./ui.js";
import { resetWalkthrough } from "./design-view.js";

let session = null;

export function hasActiveDesignSession() {
  return session != null;
}

export function currentDesignProblemName() {
  return session?.problem?.name || "";
}

export function startDesignSession(problemId) {
  const problem = designProblemById(problemId);
  if (!problem) return false;
  // The reference is closed again, because you are about to answer it. Leaving
  // it open where you last read it would be handing you the answer.
  resetWalkthrough();
  session = {
    problem, startedAt: null, endedAt: null, plan: null,
    intervalId: null, whiteboardCtl: null, mounted: false,
    syncId: uid(), emitter: null, sync: null, live: null,
    covered: new Set(), boardDataUrl: null,
  };
  return true;
}

export function abandonDesignSession() {
  if (session?.intervalId) clearInterval(session.intervalId);
  if (session?.whiteboardCtl) session.whiteboardCtl.destroy();
  session?.sync?.stop({ discard: true }).catch(() => {});
  session?.live?.stop().catch(() => {});
  session = null;
}

/** Leaving without recording it, asked the same way every other discard is. */
export function discardDesignSession(actions) {
  if (!confirmLoss({
    action: "Discard this design session?",
    lost: "the drawing and the timer from this one sitting",
    kept: "every attempt you have recorded before now",
  })) return false;
  abandonDesignSession();
  actions.switchTab("designBank");
  return true;
}

// ---------- the session ----------

export function renderDesignSession(root, store, actions) {
  if (!session) {
    actions.switchTab("designBank");
    return;
  }
  const p = session.problem;
  if (!session.plan) session.plan = designPlan(store.state, p.difficulty);

  if (!session.startedAt) {
    root.innerHTML = `
      <div class="card">
        <h2>${esc(p.name)}</h2>
        <p class="muted">${esc(p.prompt)}</p>
        <p class="muted small">Clarify the requirements out loud, estimate the scale, then draw.
        The reference answer stays shut until the session ends — comparing is the exercise, and
        reading it first is not.</p>
        ${boxPreviewHtml(session.plan)}
        <button class="btn btn-primary" id="ds-start">Start</button>
        <button class="btn btn-ghost" id="ds-exit">Back</button>
      </div>`;
    root.querySelector("#ds-start").addEventListener("click", () => {
      session.startedAt = Date.now();
      startSync(store);
      actions.rerender();
    });
    root.querySelector("#ds-exit").addEventListener("click", () => {
      abandonDesignSession();
      actions.switchTab("designBank");
    });
    return;
  }

  // Re-rendering a live session would tear the canvas out from under the pen.
  if (session.mounted && root.querySelector("#ds-board")) return;

  root.innerHTML = `
    <div class="ws-shell">
      <div class="ws-bar">
        <div class="ws-bar-id"><strong>${esc(p.name)}</strong>
          <span class="muted small">${esc(p.difficulty)}</span></div>
        <div class="session-clock" id="ds-clock">00:00</div>
        <div class="mock-phase" id="ds-phase"></div>
        <div class="ws-bar-actions">
          <button class="btn btn-ghost btn-sm" id="ds-requirements">Requirements</button>
          <button class="btn btn-primary btn-sm" id="ds-done">Compare with the answer</button>
          <button class="btn btn-ghost btn-sm session-exit" id="ds-discard">Exit</button>
        </div>
      </div>
      <div class="ds-panes">
        <section class="ws-pane ds-brief" id="ds-brief" hidden>
          <header class="ws-pane-head"><span class="label">Requirements</span></header>
          <div class="ws-pane-body">
            <h3 class="small-heading">Functional</h3>
            <ul class="tight-list">${p.requirements.functional.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
            <h3 class="small-heading">Non-functional</h3>
            <ul class="tight-list">${p.requirements.nonFunctional.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
            <h3 class="small-heading">Assume</h3>
            <ul class="tight-list">${p.estimate.assumptions.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
          </div>
        </section>
        <section class="ws-pane ds-board-pane">
          <div class="ws-pane-body ws-pane-body-flush"><div id="ds-board"></div></div>
        </section>
      </div>
    </div>`;

  session.mounted = true;
  const boardHost = root.querySelector("#ds-board");
  session.whiteboardCtl = createWhiteboard(boardHost, {
    onAdd: (el) => session.emitter?.emit("element", el),
    onUpdate: (el) => session.emitter?.emit("element-move", el),
    onRemove: (id) => session.emitter?.emit("element-del", { id }),
    onClear: () => session.emitter?.emit("board-clear"),
  });

  const brief = root.querySelector("#ds-brief");
  root.querySelector("#ds-requirements").addEventListener("click", () => {
    brief.hidden = !brief.hidden;
    session.whiteboardCtl?.resize();
  });
  root.querySelector("#ds-done").addEventListener("click", () => {
    session.endedAt = Date.now();
    session.boardDataUrl = session.whiteboardCtl?.toDataUrl() || null;
    if (session.intervalId) clearInterval(session.intervalId);
    actions.switchTab("designCompare");
  });
  root.querySelector("#ds-discard").addEventListener("click", () => discardDesignSession(actions));

  clearInterval(session.intervalId);
  session.intervalId = setInterval(() => {
    const clock = root.querySelector("#ds-clock");
    if (!clock) { clearInterval(session.intervalId); return; }
    const elapsedMin = (Date.now() - session.startedAt) / 60000;
    const phase = designPhase(elapsedMin, session.plan);
    const abs = Math.abs(phase.remainingMin);
    clock.textContent = `${phase.overrun ? "+" : ""}${String(Math.floor(abs)).padStart(2, "0")}:`
      + String(Math.floor((abs % 1) * 60)).padStart(2, "0");
    clock.classList.toggle("clock-overrun", phase.overrun);
    const host = root.querySelector("#ds-phase");
    const stamp = `${phase.index}:${phase.endingSoon ? 1 : 0}`;
    if (host && host.dataset.phase !== stamp) {
      host.dataset.phase = stamp;
      host.innerHTML = `<span class="mock-phase-label">${esc(phase.label)}</span>
        <span class="mock-phase-prompt">${esc(phase.prompt)}</span>
        ${phase.endingSoon && phase.nextLabel
          ? `<span class="mock-phase-next">${esc(phase.nextLabel)} next</span>` : ""}`;
    }
  }, 250);
}

function boxPreviewHtml(plan) {
  if (!plan?.phases?.length) return "";
  return `
    <div class="box-preview">
      <p class="muted small"><strong>${plan.totalMin} minutes.</strong> Nothing stops when a phase
      ends — the session says where you are, so requirements do not eat the time you needed to
      draw.</p>
      <ol class="box-phases">
        ${plan.phases.map((ph) => `<li style="flex-grow:${ph.minutes}">
          <span class="box-phase-label">${esc(ph.label)}</span>
          <span class="muted small">${ph.minutes}m</span></li>`).join("")}
      </ol>
    </div>`;
}

// ---------- comparing ----------

export function renderDesignCompare(root, store, actions) {
  if (!session || !session.endedAt) {
    actions.switchTab("designBank");
    return;
  }
  const p = session.problem;
  const components = componentsFor(p);
  const minutes = Math.round((session.endedAt - session.startedAt) / 60000);

  root.innerHTML = `
    <div class="card">
      <h2>${esc(p.name)} — compare</h2>
      <p class="muted">${minutes} minute${minutes === 1 ? "" : "s"}. Read the reference, then tick
      what you actually had on your board. Be honest about it: the value of this screen is entirely
      in the gap it shows you, and a generous tick teaches nothing.</p>
    </div>

    <div class="card">
      <h2>A reference answer</h2>
      <ol class="walk-stages">
        ${p.walkthrough.map((stage, i) => `
          <li class="walk-stage">
            <h3>${i + 1}. ${esc(stage.title)}</h3>
            <p>${esc(stage.says)}</p>
            <p class="muted small"><strong>Why.</strong> ${esc(stage.because)}</p>
            ${stage.watchFor ? `<p class="small walk-watch"><strong>Watch for.</strong> ${esc(stage.watchFor)}</p>` : ""}
          </li>`).join("")}
      </ol>
    </div>

    <div class="card">
      <h2>Which of these did you have?</h2>
      <p class="muted small">Unticked means the reference used it and you did not — which is not a
      failure, it is the list of what to read next.</p>
      <ul class="checklist" id="ds-covered">
        ${components.map((c) => `<li><label>
          <input type="checkbox" data-covered="${esc(c.id)}" /> ${esc(c.name)}
          <span class="muted small">— ${esc(c.hook)}</span></label></li>`).join("")}
      </ul>
    </div>

    <div class="card">
      <h2>What a good answer covers</h2>
      <ul class="tight-list">${p.rubric.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    </div>

    <div class="card">
      <form id="ds-save" class="form">
        <label class="field"><span class="label">How did that go?</span>
          <select class="select" name="selfScore">
            <option value="4">Had most of it, and the reasoning</option>
            <option value="3" selected>Got the shape, missed some pieces</option>
            <option value="2">Struggled, but learned something specific</option>
            <option value="1">Did not know where to start</option>
          </select></label>
        <label class="field"><span class="label">One thing you will do differently</span>
          <textarea class="textarea" name="notes" rows="3"
            placeholder="I jumped to the database before asking about read:write ratio."></textarea></label>
        <button class="btn btn-primary" type="submit">Save this attempt</button>
        <button class="btn btn-ghost" type="button" id="ds-cancel">Discard it</button>
      </form>
    </div>`;

  root.querySelector("#ds-cancel").addEventListener("click", () => discardDesignSession(actions));
  root.querySelector("#ds-save").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const covered = [...root.querySelectorAll("[data-covered]")]
      .filter((box) => box.checked).map((box) => box.dataset.covered);
    const missed = components.map((c) => c.id).filter((id) => !covered.includes(id));
    const selfScore = Number(form.get("selfScore")) || 3;
    const problemId = p.id;
    const date = todayISO();

    store.mutate((s) => {
      const record = (s.designProblems || []).find((x) => x.id === problemId);
      if (!record) return;
      record.attempts.push({
        id: uid(), date, covered, missed, selfScore,
        notes: form.get("notes") || "",
        minutes,
        // Whether the day clock was already counting these minutes — the same
        // flag the coding side records, for the same reason.
        onClock: !!(s.dayTimer?.running && s.dayTimer.date === date),
      });
      // Scored on the same ladder as a coding problem: a strong pass moves it
      // up a box, a weak one holds, not knowing where to start resets it.
      applyOutcome(record, outcomeFor(selfScore), s.settings);
      updateStreak(s);
    }, `Ledger: design — ${p.name}`);

    abandonDesignSession();
    toast("Recorded.");
    actions.switchTab("designBank");
  });
}

/** A self-score mapped onto the outcomes the scheduler already understands, so
 *  a design problem moves through the boxes exactly as a coding one does. */
function outcomeFor(selfScore) {
  if (selfScore >= 4) return "solved-clean";
  if (selfScore === 3) return "solved-struggled";
  if (selfScore === 2) return "ran-out-of-time";
  return "failed";
}

// ---------- sync ----------

/** The same two channels the coding session uses, so a design session can be
 *  picked up on another device and watched by an interviewer without any of
 *  that being built twice. */
function startSync(store) {
  const device = deviceId(localStorage, storageKey("ledger.device"));
  const durable = store.gh ? createRepoChannel({ gh: store.gh, sessionId: session.syncId }) : null;
  const relayUrl = store.state?.settings?.relayUrl || "";
  const live = relayUrl
    ? createLiveChannel({ relayUrl, sessionId: session.syncId, deviceId: device })
    : null;

  session.sync = durable;
  session.live = live;
  session.emitter = createEmitter({
    sessionId: session.syncId, deviceId: device, channels: [durable, live].filter(Boolean),
  });
  session.emitter.emit("session", {
    problemId: session.problem.id,
    problemName: session.problem.name,
    difficulty: session.problem.difficulty,
    statement: session.problem.prompt,
    plan: session.plan,
  });
  session.emitter.emit("timer", { action: "start" }, session.startedAt);

  if (!live) return;
  live.subscribe((event) => {
    const ctl = session?.whiteboardCtl;
    if (!ctl) return;
    const payload = event.payload || {};
    if (event.kind === "element") ctl.applyRemote({ id: event.id, ...payload });
    else if (event.kind === "element-move") ctl.applyRemote({ ...ctl.toJSON().find((e) => e.id === payload.id), ...payload });
    else if (event.kind === "element-del") ctl.removeRemote(payload.id);
    else if (event.kind === "board-clear") ctl.restore([]);
  });
  live.start();
}
