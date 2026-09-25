// The two recall drills: the pattern quiz and the warm-up.
//
// Where this fits: both are pages under Practice that ask the same question in
// different settings — given a problem you have already solved, which pattern
// does it want? The quiz is open-ended and keeps a lifetime score; the warm-up
// is a fixed short run you do before a session to get your head in.
//
// They share a file because they share a shape: module-level question state, a
// weighted pick that avoids repeating what it just asked, and a reveal that
// shows the real approach rather than only marking you wrong.

import { pickQuizProblem, quizOptions, recommendSession, quizConfusions } from "./logic.js";
import { patternIcon } from "./icons.js";
import { esc, pct, patternName } from "./ui.js";
import { emptyState, ringSvg } from "./chrome.js";
import {
  pickComponentQuestion, componentOptions, componentById,
} from "./design-logic.js";
import { startSession } from "./session-view.js";

// ---------- Quiz ----------

// How many answers are kept. Twenty was enough for a trend line and too few
// to see a pattern pair twice; fifty of these is about three kilobytes, which
// the sync budget does not notice.
const QUIZ_MEMORY = 50;

let quizState = { current: null, options: [], answered: null, recentIds: [] };

/** The design half's drill, on the same page as the coding one. Two drills in
 *  two places would be two habits to build; one page with a switch is one. */
let quizMode = "pattern";

export function renderQuiz(root, store, actions) {
  if (quizMode === "component") return renderComponentQuiz(root, store, actions);
  return renderPatternQuiz(root, store, actions);
}

/**
 * Which component is being described?
 *
 * The mirror of the pattern drill, and the same argument for existing: naming
 * the thing from its properties is the recall an interview asks for, where
 * reading its page is recognition.
 */
function renderComponentQuiz(root, store, actions) {
  const state = store.state;
  if (!componentQuiz.current) nextComponentQuestion(state);
  const c = componentQuiz.current;
  const total = state.designQuiz?.totalAsked || 0;
  const correct = state.designQuiz?.totalCorrect || 0;

  root.innerHTML = `
    ${modeSwitchHtml("component")}
    <div class="card">
      <div class="row space-between" style="align-items:center">
        <h2>Component recall</h2>
        <span class="muted small">${correct}/${total} lifetime</span>
      </div>
      <p class="muted">Which component is this? The wrong answers are from the same family on
      purpose — telling two things in the same family apart is what the interview tests.</p>
      <div class="quiz-prompt"><div class="queue-name">${esc(c.concept)}</div></div>
      <div class="quiz-options">
        ${componentQuiz.options.map((id) => {
          const option = componentById(id);
          let cls = "quiz-option";
          if (componentQuiz.answered) {
            if (id === c.id) cls += " correct";
            else if (id === componentQuiz.answered) cls += " incorrect";
          }
          return `<button type="button" class="${cls}" data-answer="${esc(id)}"
            ${componentQuiz.answered ? "disabled" : ""}>${esc(option.name)}</button>`;
        }).join("")}
      </div>
      ${componentQuiz.answered ? `
        <p class="quiz-feedback">${componentQuiz.answered === c.id
          ? "Correct."
          : `It was <strong>${esc(c.name)}</strong>.`} ${esc(c.hook)}</p>
        <div class="row gap-sm">
          <button class="btn btn-primary" id="quiz-next">Next</button>
          <button class="btn btn-ghost" data-goto-component="${esc(c.id)}">Read its page</button>
        </div>` : ""}
    </div>`;

  root.querySelectorAll("[data-answer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      componentQuiz.answered = btn.dataset.answer;
      const right = componentQuiz.answered === c.id;
      store.mutate((s) => {
        if (!s.designQuiz) s.designQuiz = { totalAsked: 0, totalCorrect: 0, recent: [] };
        s.designQuiz.totalAsked += 1;
        if (right) s.designQuiz.totalCorrect += 1;
        s.designQuiz.recent.push({ correct: right, actual: c.id, said: componentQuiz.answered });
        if (s.designQuiz.recent.length > 50) s.designQuiz.recent.shift();
      }, "Ledger: component recall answer");
      actions.rerender();
    });
  });
  root.querySelector("#quiz-next")?.addEventListener("click", () => {
    nextComponentQuestion(state);
    actions.rerender();
  });
  wireModeSwitch(root, actions);
}

function modeSwitchHtml(active) {
  return `
    <div class="card">
      <div class="row gap-sm" role="tablist" aria-label="Which drill">
        <button type="button" class="btn ${active === "pattern" ? "btn-primary" : "btn-ghost"} btn-sm"
          data-quiz-mode="pattern" aria-pressed="${active === "pattern"}">Patterns</button>
        <button type="button" class="btn ${active === "component" ? "btn-primary" : "btn-ghost"} btn-sm"
          data-quiz-mode="component" aria-pressed="${active === "component"}">Components</button>
      </div>
    </div>`;
}

function wireModeSwitch(root, actions) {
  root.querySelectorAll("[data-quiz-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      quizMode = btn.dataset.quizMode;
      actions.rerender();
    });
  });
  root.querySelectorAll("[data-goto-component]").forEach((btn) => {
    btn.addEventListener("click", () => actions.openComponent(btn.dataset.gotoComponent));
  });
}

let componentQuiz = { current: null, options: [], answered: null, recentIds: [] };

function nextComponentQuestion(state) {
  const component = pickComponentQuestion(state, componentQuiz.recentIds);
  componentQuiz.current = component;
  componentQuiz.answered = null;
  if (!component) return;
  componentQuiz.options = componentOptions(component);
  componentQuiz.recentIds = [component.id, ...componentQuiz.recentIds].slice(0, 6);
}

function renderPatternQuiz(root, store, actions) {
  const state = store.state;
  if (!quizState.current) nextQuizQuestion(state);

  const total = state.quiz.totalAsked;
  const correct = state.quiz.totalCorrect;

  if (!quizState.current) {
    root.innerHTML = `
      ${modeSwitchHtml("pattern")}
      <div class="card">
        <h2>Pattern-recognition drill</h2>
        ${emptyState("quiz", "Nothing to drill yet",
          "This drill shows a problem you've already solved and asks which pattern it used — the recall step that makes a pattern stick. It needs a few logged attempts to draw from.",
          { tab: "queue", label: "See what is ready for a refresher" })}
      </div>`;
    // Wired before returning. The switch to the component drill is on this
    // screen too, and on a fresh account this is the *only* screen — so an
    // early return here made it a button that did nothing, on the one page a
    // new user sees.
    wireModeSwitch(root, actions);
    return;
  }

  const p = quizState.current;
  root.innerHTML = `
    ${modeSwitchHtml("pattern")}
    <div class="card">
      <div class="row space-between" style="align-items:center">
        <h2>Pattern-recognition drill</h2>
        <span class="row gap-sm" style="align-items:center">${total ? ringSvg(correct / total, { size: 36, stroke: 4, label: pct(correct / total),
          description: `${correct} of ${total} pattern-recall questions correct` }) : ""}<span class="muted small">${correct}/${total} lifetime</span></span>
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
    </div>
    ${confusionsHtml(state)}`;

  root.querySelectorAll("[data-answer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      quizState.answered = btn.dataset.answer;
      const isCorrect = quizState.answered === p.patternId;
      store.mutate((s) => {
        s.quiz.totalAsked += 1;
        if (isCorrect) s.quiz.totalCorrect += 1;
        // Which pattern you reached for instead is the whole signal, and it
        // used to be discarded the moment the answer was scored. A rate can
        // say recall is at 62%; only this can say that most of the misses are
        // one particular pair.
        s.quiz.recent.push({
          correct: isCorrect,
          actual: p.patternId,
          said: quizState.answered,
          problemId: p.id,
        });
        if (s.quiz.recent.length > QUIZ_MEMORY) s.quiz.recent.shift();
      }, "Ledger: quiz answer");
      actions.rerender();
    });
  });
  wireModeSwitch(root, actions);
  const nextBtn = root.querySelector("#quiz-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      nextQuizQuestion(state);
      actions.rerender();
    });
  }
}

/**
 * The pairs you keep mixing up.
 *
 * Shown under the drill rather than after each answer: the point is what to
 * study next, which is a question about the last fifty answers and not about
 * the one you just got wrong. Silent until there is something to say — an
 * empty "your confusions" heading implies you have none, when what you have
 * is not enough answers yet.
 */
function confusionsHtml(state) {
  const { pairs, ungraded } = quizConfusions(state);
  if (!pairs.length) return "";
  return `
    <div class="card">
      <h2>What you keep swapping</h2>
      <p class="muted small">Pairs you have mixed up more than once in your last
      ${QUIZ_MEMORY} answers. One mix-up is a slip; twice is worth reading about.</p>
      <ul class="confusion-list">
        ${pairs.map((c) => `
          <li>
            <span class="confusion-pair">
              <span class="pattern-icon">${patternIcon(c.actual, { size: 15 })}</span>
              ${esc(patternName(state, c.actual))}
              <span class="muted small">answered as</span>
              <span class="pattern-icon">${patternIcon(c.said, { size: 15 })}</span>
              ${esc(patternName(state, c.said))}
            </span>
            <span class="row gap-sm" style="align-items:center">
              <span class="muted small">${c.times}&times;</span>
              <button type="button" class="btn btn-ghost btn-xs" data-goto-topic="${esc(c.actual)}">Read it</button>
            </span>
          </li>`).join("")}
      </ul>
      ${ungraded ? `<p class="muted small">${ungraded} older answer${ungraded === 1 ? "" : "s"}
        ${ungraded === 1 ? "is" : "are"} counted in your score but recorded before the app kept
        which pattern you chose, so ${ungraded === 1 ? "it" : "they"} can't appear here.</p>` : ""}
    </div>`;
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
          { tab: "queue", label: "See what is ready for a refresher" })}
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
