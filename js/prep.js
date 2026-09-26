// What you are preparing for, and what that changes.
//
// Where this fits: above logic.js, which owns a practice day, and read by the
// dashboard, the settings screen and the recommendation. It holds no state of
// its own — everything here is derived from four answers the user gives once
// and can change whenever they like.
//
// Why it exists. The app knew how long a day was and nothing else, so it gave
// the same advice to somebody six months out as to somebody interviewing on
// Friday, and the same advice to a new grad as to a senior. Those are not the
// same preparation. What actually differs:
//
//   * **How long you have** decides whether you are still building foundations
//     or should be simulating the real thing. Topic-by-topic blocks are right
//     early and wrong late; random problems under a strict clock are right late
//     and wrong early.
//   * **Where you are starting** decides how much a day has to hold.
//   * **What you are aiming at** decides what gets weighted. A top-tier loop
//     assumes fluency and clean code as the floor and tests ambiguity on top;
//     a broad search does not.
//   * **What level** decides whether system design is part of the day at all.
//
// One thing this deliberately does not do is set a single number and call it a
// plan. A day is a band — a floor below which the day did not really happen,
// and a ceiling past which the evidence is that you stop learning and start
// skimming. Two hours of deliberate technical practice is the top of the range
// most people sustain; the band makes that visible instead of implying that
// more is always better.

import { todayISO, daysBetween, addDaysISO } from "./logic.js";

/** Where somebody is starting from, and what a day has to hold because of it. */
export const STARTING_POINTS = [
  {
    key: "sharp", label: "Currently sharp",
    note: "Interviewing now, or practising already. Maintenance, not rebuilding.",
    weeksNeeded: 3, lift: -15,
  },
  {
    key: "rusty", label: "Done this before, gone rusty",
    note: "The ideas are in there somewhere. Most of the work is retrieval and speed.",
    weeksNeeded: 6, lift: 0,
  },
  {
    key: "new", label: "New to data structures and algorithms",
    note: "Foundations first. This takes longer than anyone wants it to, and compressing it does not work.",
    weeksNeeded: 12, lift: 20,
  },
];

/**
 * What you are aiming at, and what that weights.
 *
 * The distinction that matters is not the company's name, it is what the loop
 * assumes you already have. A top-tier loop treats fluency in your language and
 * clean first-draft code as the floor and spends its time on ambiguity and
 * follow-ups; somewhere else, getting a correct answer is the bar.
 */
export const TARGETS = [
  {
    key: "top", label: "Top tier",
    hint: "Meta, Google and the like",
    note: "Assumes fluency and clean code as the floor. The differentiators are speed on classics, and handling a deliberately vague prompt without flailing.",
    emphasis: ["fluency", "clean", "ambiguity", "speed"],
  },
  {
    key: "strong", label: "Strong engineering org",
    hint: "Series B and up, good product companies",
    note: "Correctness and communication carry it. Depth matters more than raw speed.",
    emphasis: ["clean", "communication"],
  },
  {
    key: "broad", label: "Broad search",
    hint: "Casting wide, mixed bar",
    note: "Coverage over depth: more patterns seen once beats three seen perfectly.",
    emphasis: ["coverage"],
  },
];

/** What the level changes. Mostly: whether system design is part of the day. */
export const LEVELS = [
  { key: "newgrad", label: "New grad / junior", designShare: 0,
    note: "Coding rounds decide this. System design, if it appears at all, is a conversation rather than a round." },
  { key: "mid", label: "Mid level", hint: "L4 / E4",
    designShare: 0.2,
    note: "One design round, usually. Enough to need the shape of an answer, not enough to need depth everywhere." },
  { key: "senior", label: "Senior and up", hint: "L5 / E5+",
    designShare: 0.4,
    note: "Design carries as much weight as coding, and is where the level is actually decided." },
];

/**
 * How much of a day this is, as a band rather than a number.
 *
 * The floor is where a day starts counting — below it there is no room for a
 * real problem *and* the review afterwards, and the review is the part that
 * teaches. The ceiling is where deliberate practice stops being deliberate.
 * Past roughly two hours of this kind of work most people stop analysing their
 * own mistakes and start skimming solutions, which feels like progress and is
 * not; the long bands exist for people genuinely doing this full time, and say
 * so.
 */
export const INTENSITIES = [
  {
    key: "light", label: "Light", band: [30, 45], blocks: 1,
    note: "A rep and a proper review. Slow progress, but it is progress and it survives a busy month.",
  },
  {
    key: "steady", label: "Steady", band: [45, 75], blocks: 1,
    note: "One problem worked properly plus a refresher. The most common sustainable shape alongside a job.",
  },
  {
    key: "focused", label: "Focused", band: [75, 120], blocks: 1,
    note: "Warm-up, one hard problem under the clock, and a real review. The top of what most people sustain daily.",
  },
  {
    key: "rigorous", label: "Rigorous", band: [120, 180], blocks: 2,
    note: "Two blocks with a genuine break between them. One sitting this long stops being deliberate practice about halfway through.",
  },
  {
    key: "fulltime", label: "Full time", band: [180, 240], blocks: 2,
    note: "Only if this is your job right now. Split morning and afternoon; four hours in one sitting is three hours of skimming.",
  },
];

/** Past this, a day is split into blocks rather than run as one sitting. */
export const LONG_DAY_MIN = 120;

export const DEFAULT_PREP = {
  targetDate: null,
  startingPoint: "rusty",
  target: "strong",
  level: "mid",
  intensity: null,      // null means "follow the suggestion"
  startedOn: null,
};

export const intensityByKey = (key) => INTENSITIES.find((i) => i.key === key) || null;
export const startingPointByKey = (key) => STARTING_POINTS.find((s) => s.key === key) || null;
export const targetByKey = (key) => TARGETS.find((t) => t.key === key) || null;
export const levelByKey = (key) => LEVELS.find((l) => l.key === key) || null;

export function prepOf(state) {
  return { ...DEFAULT_PREP, ...(state?.settings?.prep || {}) };
}

/** Whole weeks until the target date, or null if there isn't one. Never
 *  negative: the day of the interview is zero weeks out, not minus one. */
export function weeksUntil(state, today = todayISO()) {
  const prep = prepOf(state);
  if (!prep.targetDate) return null;
  return Math.max(0, Math.ceil(daysBetween(today, prep.targetDate) / 7));
}

/**
 * Which part of the preparation this is.
 *
 * By how far through the plan you are rather than by a fixed number of weeks,
 * because "topic blocks for two months, then mix it up" is advice about
 * proportions. Somebody with six weeks and somebody with six months both need
 * a foundations stretch and a simulation stretch; they just need them at
 * different lengths.
 *
 * With no target date it stays on `mixed`, which is what the app did before
 * any of this existed. Nobody is made to pick a date to get sensible defaults.
 */
export const PREP_PHASES = {
  foundations: {
    key: "foundations", label: "Foundations",
    blurb: "One pattern at a time, until the shape of it is obvious.",
    detail: "Block practice: stay on a pattern until you can see it coming, rather than meeting it once and moving on. Mixing too early feels harder and teaches less, because every problem becomes a fresh search instead of a recognition.",
  },
  mixed: {
    key: "mixed", label: "Mixed practice",
    blurb: "Patterns interleaved, the way the queue decides.",
    detail: "Spaced and interleaved: what you saw longest ago comes back first. This is where recognition actually forms, because you no longer know what kind of problem is coming.",
  },
  simulation: {
    key: "simulation", label: "Simulation",
    blurb: "Random, strictly timed, spoken out loud.",
    detail: "Stop learning new patterns and start rehearsing the event. Random problems, a hard clock, talking through it — the gap being closed now is performance, not knowledge.",
  },
};

/** Always simulate inside this, however long the plan was. */
const SIMULATION_WEEKS = 2;

export function prepPhase(state, today = todayISO()) {
  const weeksOut = weeksUntil(state, today);
  if (weeksOut == null) return PREP_PHASES.mixed;
  if (weeksOut <= SIMULATION_WEEKS) return PREP_PHASES.simulation;

  const prep = prepOf(state);
  const started = prep.startedOn;
  if (!started) return weeksOut > 8 ? PREP_PHASES.foundations : PREP_PHASES.mixed;

  const elapsed = Math.max(0, daysBetween(started, today));
  const remaining = Math.max(0, daysBetween(today, prep.targetDate));
  const total = elapsed + remaining;
  if (total <= 0) return PREP_PHASES.simulation;

  const through = elapsed / total;
  if (through < 0.4) return PREP_PHASES.foundations;
  if (through < 0.75) return PREP_PHASES.mixed;
  return PREP_PHASES.simulation;
}

/**
 * How hard a day should be, given how long is left and where you started.
 *
 * Short runway raises it, because there is less time for the same ground; a
 * standing start raises it, because there is more ground. Both are capped
 * below the full-time band, which is a decision somebody makes about their
 * life rather than something an app infers from a date.
 */
export function suggestIntensity(state, today = todayISO()) {
  const prep = prepOf(state);
  const start = startingPointByKey(prep.startingPoint) || STARTING_POINTS[1];
  const weeksOut = weeksUntil(state, today);

  let i = INTENSITIES.findIndex((x) => x.key === "steady");
  if (weeksOut != null) {
    const pressure = start.weeksNeeded / Math.max(1, weeksOut);
    if (pressure >= 2) i += 2;
    else if (pressure >= 1.2) i += 1;
    else if (pressure < 0.6) i -= 1;
  } else if (start.key === "new") {
    i += 1;
  }
  // Never suggests full time. That is a statement about somebody's week, not
  // something to be inferred from a date in a form.
  const max = INTENSITIES.findIndex((x) => x.key === "rigorous");
  return INTENSITIES[Math.max(0, Math.min(max, i))];
}

/** The intensity in force: whatever was chosen, or the suggestion. */
export function currentIntensity(state, today = todayISO()) {
  return intensityByKey(prepOf(state).intensity) || suggestIntensity(state, today);
}

/**
 * Today's band, in minutes.
 *
 * Read from the saved settings when they exist, so a hand-set band is never
 * overwritten by the suggestion, and derived from the intensity otherwise.
 */
export function dailyBand(state, today = todayISO()) {
  const settings = state?.settings || {};
  const max = settings.dailyBudgetMin;
  const min = settings.dailyFloorMin;
  if (max != null && min != null) return { min: Math.min(min, max), max };
  const [lo, hi] = currentIntensity(state, today).band;
  return { min: min ?? Math.min(lo, max ?? hi), max: max ?? hi };
}

/**
 * The shape of a day: blocks, and what each block is for.
 *
 * A long day is not one long session. Past two hours the useful move is two
 * sittings with a real break, and inside each sitting the same three-part
 * shape: something you already know to get the machinery running, one hard
 * thing under the clock, and then the review — which is the part that is
 * skipped first and teaches most.
 */
const BLOCK_SHAPE = [
  { key: "warmup", label: "Warm-up", share: 0.16,
    prompt: "Re-code something from last week from memory, or take an easy one. This is to get the machinery running, not to learn anything." },
  { key: "core", label: "Deliberate practice", share: 0.53,
    prompt: "One problem at the top of your range, under a hard clock, spoken out loud. No hints." },
  { key: "review", label: "Review", share: 0.31,
    prompt: "Why did it go the way it did? Write the sentence you would need in six months, and the complexity you argued for." },
];

export function dayPlan(state, today = todayISO()) {
  const band = dailyBand(state, today);
  const intensity = currentIntensity(state, today);
  const target = Math.round((band.min + band.max) / 2);
  const count = band.max > LONG_DAY_MIN ? Math.max(2, intensity.blocks) : 1;
  const per = Math.round(target / count);

  const blocks = [];
  for (let b = 0; b < count; b++) {
    let used = 0;
    const parts = BLOCK_SHAPE.map((part, i) => {
      const minutes = i === BLOCK_SHAPE.length - 1
        ? per - used
        : Math.max(1, Math.round(per * part.share));
      used += minutes;
      return { ...part, minutes };
    });
    blocks.push({
      index: b,
      label: count === 1 ? "Today" : b === 0 ? "First block" : "Second block",
      minutes: per,
      parts,
    });
  }
  return { band, target, blocks, splitReason: count > 1 ? intensity.note : null };
}

/**
 * Whether the band is somewhere the evidence supports.
 *
 * Said rather than enforced. Somebody who has decided to do four hours a day
 * is allowed to; what they should not be able to do is set it without the app
 * having mentioned what happens past the top of the range.
 */
export const SUSTAINABLE_MAX = 120;
export const MIN_USEFUL_DAY = 25;

export function bandAdvice(state, today = todayISO()) {
  const { min, max } = dailyBand(state, today);
  if (max > 240) {
    return { level: "bad", message: "Past four hours this stops being practice. Nobody analyses their own mistakes in the fourth hour; they skim solutions and feel productive." };
  }
  if (max > SUSTAINABLE_MAX) {
    const intensity = currentIntensity(state, today);
    if (intensity.blocks > 1) {
      return { level: "warn", message: `Over ${SUSTAINABLE_MAX} minutes of this is two sittings, not one. Today is planned as ${intensity.blocks} blocks with a real break between them.` };
    }
    return { level: "warn", message: `Over ${SUSTAINABLE_MAX} minutes in one sitting is where deliberate practice stops being deliberate. Split it into two blocks, or bring the ceiling down.` };
  }
  if (max < MIN_USEFUL_DAY) {
    return { level: "warn", message: "Under half an hour there is no room for the review, and the review is the part that teaches. A shorter day is fine; a day with no review is not." };
  }
  if (min >= max) {
    return { level: "warn", message: "A floor equal to the ceiling is a target, not a band — every day is then either short or over." };
  }
  return { level: "ok", message: "" };
}

/**
 * Everything the dashboard needs to say what this preparation is.
 *
 * One call, because these are answers to one question and computing them in
 * four places is how they start disagreeing.
 */
export function prepStatus(state, today = todayISO()) {
  const prep = prepOf(state);
  const weeksOut = weeksUntil(state, today);
  const phase = prepPhase(state, today);
  const intensity = currentIntensity(state, today);
  const band = dailyBand(state, today);
  const start = startingPointByKey(prep.startingPoint);
  const target = targetByKey(prep.target);
  const level = levelByKey(prep.level);
  const suggested = suggestIntensity(state, today);

  return {
    configured: !!prep.targetDate || !!prep.intensity,
    targetDate: prep.targetDate, weeksOut, phase, intensity, band,
    startingPoint: start, target, level,
    suggestedIntensity: suggested,
    followingSuggestion: !prep.intensity,
    emphasis: target?.emphasis || [],
    advice: bandAdvice(state, today),
    // Whether the runway is honest about the ground still to cover. Said once,
    // plainly, rather than nagged: it is their date and their call.
    tight: weeksOut != null && start != null && weeksOut < start.weeksNeeded,
  };
}

/** The date the plan should have started from, for somebody setting a target
 *  date today. Used to seed `startedOn` so the phases have a span to divide. */
export function planStart(today = todayISO()) {
  return today;
}

export { addDaysISO };
