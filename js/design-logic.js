// The system-design half of the domain: how a design session is timeboxed, how
// mastery of a component is measured, and how the two halves share one day.
//
// Where this fits: beside logic.js, which owns the coding half, and importing
// from it rather than duplicating. Spaced repetition, box intervals and the
// budget are the same machinery — a design problem is a problem with a
// different practice format, not a different kind of thing.
//
// The framing this whole file follows, and the reason it is not a separate
// feature: a day is 75 minutes of practice, and system design is part of that
// day rather than something you do instead. For anyone aiming past junior, the
// two are assessed in the same loop and should be prepared in the same loop.

import { todayISO, addDaysISO, daysBetween, isCleanSolve } from "./logic.js";
import { COMPONENTS } from "./design-components.js";
import { DESIGN_PROBLEMS } from "./design-problems.js";

/** How a design interview actually runs, in the order it runs. */
export const DESIGN_PHASES = [
  {
    key: "clarify", label: "Clarify", share: 0.15,
    prompt: "What is in scope and what is not? Get the functional requirements agreed, then the non-functional ones — scale, latency, consistency. Write them where you can both see them.",
  },
  {
    key: "estimate", label: "Estimate", share: 0.12,
    prompt: "Back of the envelope: users, requests per second, storage per year. You are not looking for accuracy, you are looking for the order of magnitude that decides the design.",
  },
  {
    key: "highlevel", label: "High level", share: 0.33,
    prompt: "Boxes and arrows, end to end, on the board. Get a complete path from client to storage and back before you make any of it good.",
  },
  {
    key: "deepdive", label: "Deep dive", share: 0.28,
    prompt: "Pick the part that carries the risk and justify it. Why this component, what it costs you, and what you would have used instead.",
  },
  {
    key: "wrap", label: "Bottlenecks", share: 0.12,
    prompt: "Name what breaks first as this grows, what you would monitor, and what you knowingly left out. Saying it before they ask is the point.",
  },
];

/** Minutes for one design problem, by difficulty. Longer than a coding box
 *  because the format is longer: a real design round is 45 minutes of talking
 *  and drawing, and practising it in fifteen teaches the wrong pace. */
export const DEFAULT_DESIGN_MINUTES = { Easy: 30, Medium: 40, Hard: 50, Unrated: 40 };

/** Below this the phases are ceremony rather than guidance. */
const MIN_DIVISIBLE = 15;

export function designMinutes(state, difficulty) {
  const table = state?.settings?.designMinutes || DEFAULT_DESIGN_MINUTES;
  return table[difficulty] ?? table.Unrated ?? DEFAULT_DESIGN_MINUTES.Unrated;
}

/**
 * The phases of one design session, with real minute boundaries.
 *
 * Proportional, unlike the coding timebox — and that difference is real rather
 * than an inconsistency. Reading a coding problem takes five minutes whether it
 * is easy or hard; clarifying requirements genuinely takes longer on a harder
 * system, because there is more to agree about before anything can be drawn.
 */
export function designPlan(state, difficulty) {
  const totalMin = Math.max(1, Math.round(designMinutes(state, difficulty)));
  if (totalMin < MIN_DIVISIBLE) {
    return {
      totalMin,
      phases: [{
        key: "sketch", label: "Sketch", startMin: 0, endMin: totalMin, minutes: totalMin,
        prompt: "Short box — requirements, one diagram, one tradeoff named out loud.",
      }],
    };
  }

  // Allocated by share and then reconciled, so the phases sum to the box
  // exactly. Rounding each independently leaves a box that reports a minute it
  // does not have — the same bug the coding timebox had before it was swept.
  let cursor = 0;
  const phases = DESIGN_PHASES.map((phase, i) => {
    const last = i === DESIGN_PHASES.length - 1;
    const minutes = last ? totalMin - cursor : Math.max(1, Math.round(totalMin * phase.share));
    const startMin = cursor;
    cursor += minutes;
    return { key: phase.key, label: phase.label, prompt: phase.prompt, startMin, endMin: cursor, minutes };
  });
  return { totalMin, phases };
}

/** Where you are in a design session. Same shape as questionPhase, so the
 *  workspace can render either without knowing which it has. */
export function designPhase(elapsedMin, plan) {
  const { phases, totalMin } = plan;
  const current = phases.find((p) => elapsedMin < p.endMin) || phases[phases.length - 1];
  const index = phases.indexOf(current);
  const remainingInPhase = current.endMin - elapsedMin;
  const remainingMin = totalMin - elapsedMin;
  return {
    key: current.key, label: current.label, prompt: current.prompt, index,
    remainingInPhase, remainingMin,
    fraction: totalMin > 0 ? elapsedMin / totalMin : 0,
    overrun: remainingMin < 0,
    endingSoon: remainingInPhase <= 1 && remainingInPhase > 0,
    nextLabel: phases[index + 1]?.label ?? null,
  };
}

// ---------- the bank ----------

export function designProblemById(id) {
  return DESIGN_PROBLEMS.find((p) => p.id === id) || null;
}

export function componentById(id) {
  return COMPONENTS.find((c) => c.id === id) || null;
}

/** Every component a problem's reference answer reaches for, in the order the
 *  walkthrough introduces them and without repeats. */
export function componentsFor(problem) {
  const seen = new Set();
  const out = [];
  for (const stage of problem?.walkthrough || []) {
    for (const id of stage.components || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const component = componentById(id);
      if (component) out.push(component);
    }
  }
  return out;
}

/** The problems whose reference answer uses this component — the practice
 *  ladder for a component page, built from the bank rather than listed by hand
 *  so it cannot drift. */
export function problemsUsing(componentId) {
  return DESIGN_PROBLEMS.filter((p) =>
    (p.walkthrough || []).some((s) => (s.components || []).includes(componentId)));
}

// ---------- your record ----------

/** Every design attempt across every design problem, oldest first. */
export function designAttempts(state, componentId = null) {
  const out = [];
  for (const problem of state?.designProblems || []) {
    for (const attempt of problem.attempts || []) {
      if (componentId && !(attempt.covered || []).includes(componentId)) continue;
      out.push({ ...attempt, problemId: problem.id, problemName: problem.name });
    }
  }
  return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

/**
 * How you are doing on each component.
 *
 * Measured by whether you reached for it unprompted, not by whether you have
 * read its page. An attempt records which components you covered before seeing
 * the reference answer, and which the answer used that you missed — so
 * "recalled" here means the same thing the coding side's pattern recall does:
 * you produced it cold.
 */
export function componentStats(state) {
  return COMPONENTS.map((component) => {
    const relevant = designAttempts(state).filter((a) =>
      (a.covered || []).includes(component.id) || (a.missed || []).includes(component.id));
    const recalled = relevant.filter((a) => (a.covered || []).includes(component.id)).length;
    return {
      component,
      problemCount: problemsUsing(component.id).length,
      seen: relevant.length,
      recalled,
      recallRate: relevant.length ? recalled / relevant.length : null,
      lastSeen: relevant.length ? relevant[relevant.length - 1].date : null,
    };
  });
}

/** Components a reference answer used that you did not name, most often first.
 *  The design half's equivalent of the quiz's confusion list: a specific thing
 *  to go and read rather than a rate to feel bad about. */
export const BLIND_SPOT_MIN = 2;

export function blindSpots(state, min = BLIND_SPOT_MIN) {
  const counts = new Map();
  for (const attempt of designAttempts(state)) {
    for (const id of attempt.missed || []) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= min)
    .map(([id, times]) => ({ component: componentById(id), times }))
    .filter((x) => x.component)
    .sort((a, b) => b.times - a.times);
}

// ---------- one day, two halves ----------

/** What share of the daily budget goes to system design once it is switched on.
 *  Forty-five minutes of coding and thirty of design inside a seventy-five
 *  minute day is the split the default encodes. */
export const DEFAULT_DESIGN_SHARE = 0.4;

export function designShare(state) {
  const raw = state?.settings?.designShare;
  return typeof raw === "number" && raw >= 0 && raw <= 1 ? raw : 0;
}

/**
 * How today's minutes divide between the two halves.
 *
 * Returns whole minutes that sum to the budget. A share of zero means design is
 * off and the day is entirely coding, which is what every existing user gets
 * until they turn it on — this must not silently take time away from someone
 * who never asked for it.
 */
export function splitBudget(state) {
  const budgetMin = state?.settings?.dailyBudgetMin || 75;
  const share = designShare(state);
  const designMin = Math.round(budgetMin * share);
  return { budgetMin, codingMin: budgetMin - designMin, designMin, enabled: share > 0 };
}

/** Design problems ready for another attempt, soonest first. The same Leitner
 *  schedule the coding side uses — a design problem you drew a month ago is due
 *  for the same reason a coding problem is. */
export function dueDesignProblems(state, today = todayISO()) {
  return (state?.designProblems || [])
    .filter((p) => !p.nextReviewDate || p.nextReviewDate <= today)
    .sort((a, b) => (a.box - b.box) || (a.nextReviewDate || "").localeCompare(b.nextReviewDate || ""));
}

/**
 * Today's design work, filling the design share of the budget.
 *
 * Due problems first, then anything never attempted — the same rule as the
 * coding plan, so a day reads the same on both halves.
 */
export function planDesignToday(state, today = todayISO()) {
  const { designMin, enabled } = splitBudget(state);
  if (!enabled) return { plan: [], usedMin: 0, budgetMin: 0, overflow: [] };

  const due = dueDesignProblems(state, today);
  const fresh = (state?.designProblems || []).filter((p) => !(p.attempts || []).length && !due.includes(p));
  const plan = [];
  const overflow = [];
  let used = 0;
  for (const problem of [...due, ...fresh]) {
    const cost = designMinutes(state, problem.difficulty);
    // The first one always goes in, even if it alone exceeds the share: a
    // budget that plans nothing is worse than one that plans one thing.
    if (plan.length === 0 || used + cost <= designMin) {
      plan.push({ problem, estimateMin: cost });
      used += cost;
    } else {
      overflow.push(problem);
    }
  }
  return { plan, usedMin: used, budgetMin: designMin, overflow };
}

/**
 * The one design thing to do next, or nothing.
 *
 * Deliberately quieter than recommendSession: the coding half owns the
 * dashboard's headline, and two competing recommendations is two people telling
 * you what to do.
 */
export function recommendDesign(state, today = todayISO()) {
  if (!splitBudget(state).enabled) return null;
  const doneToday = designAttempts(state).filter((a) => a.date === today).length;
  if (doneToday) return null;

  const spot = blindSpots(state)[0];
  if (spot) {
    const problem = problemsUsing(spot.component.id)[0];
    if (problem) {
      return {
        type: "blind-spot", problemId: problem.id, componentId: spot.component.id,
        message: `${spot.component.name} has come up in ${spot.times} reference answers you didn't reach for. `
          + `${problem.name} leans on it.`,
      };
    }
  }
  // "Another pass" only makes sense for something you have had a first pass
  // at. A never-attempted problem is new, not neglected — the same distinction
  // the refresher queue draws, and for the same reason: telling somebody they
  // are behind on work they have never seen is the framing this app removed.
  const due = dueDesignProblems(state, today).find((p) => (p.attempts || []).length);
  if (due) {
    return { type: "due", problemId: due.id, componentId: null,
      message: `${due.name} is ready for another pass.` };
  }
  const fresh = (state?.designProblems || []).find((p) => !(p.attempts || []).length);
  if (fresh) {
    return { type: "first", problemId: fresh.id, componentId: null,
      message: `${fresh.name} — you haven't worked this one yet.` };
  }
  return null;
}

/** How long since a component last appeared in anything you attempted. Feeds
 *  the same "it's been a while" framing the coding side uses, rather than a
 *  deadline nobody set. */
export function componentRecency(state, componentId, today = todayISO()) {
  const attempts = designAttempts(state, componentId);
  if (!attempts.length) return { daysSince: null, tone: "new" };
  const daysSince = daysBetween(attempts[attempts.length - 1].date, today);
  return { daysSince, tone: daysSince >= 30 ? "fading" : daysSince >= 14 ? "aWhile" : "recent" };
}

// ---------- drilling components ----------

/**
 * A recall question about a component: its own description, and three others
 * from the same category to choose between.
 *
 * Same-category distractors on purpose. "Is this a cache or a load balancer"
 * is not a question anybody gets wrong; "is this Redis or a CDN" is, and
 * telling two things in the same family apart is what the interview actually
 * tests.
 */
export function pickComponentQuestion(state, recentIds = []) {
  const stats = componentStats(state);
  const avoid = new Set(recentIds);
  // Weighted toward what you have missed and away from what you have just been
  // asked — the same priority the coding quiz uses.
  const weighted = stats
    .filter((s) => !avoid.has(s.component.id))
    .map((s) => ({
      component: s.component,
      weight: 1 + (s.recallRate == null ? 1 : (1 - s.recallRate) * 3) + (s.seen === 0 ? 0.5 : 0),
    }));
  if (!weighted.length) return null;
  const total = weighted.reduce((n, w) => n + w.weight, 0);
  let roll = Math.random() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.component;
  }
  return weighted[weighted.length - 1].component;
}

export function componentOptions(component, count = 4) {
  const siblings = COMPONENTS.filter((c) => c.category === component.category && c.id !== component.id);
  // Falls back to the whole library when a category is too small to fill the
  // options, rather than returning two choices and making it a coin flip.
  const pool = siblings.length >= count - 1
    ? siblings
    : [...siblings, ...COMPONENTS.filter((c) => c.category !== component.category)];
  const picked = shuffleLocal(pool).slice(0, count - 1);
  return shuffleLocal([component, ...picked]).map((c) => c.id);
}

function shuffleLocal(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
