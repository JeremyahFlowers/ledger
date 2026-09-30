// The week, as a shape somebody agrees to once.
//
// Where this fits: above prep.js, which says what you are preparing for, and
// below the dashboard, which asks it what today is. prep.js answers "how much
// and how hard"; this answers "on which days, and doing what".
//
// Why a week and not a day. A daily minute budget cannot express the thing
// people actually plan — "two problems Monday, one plus a design topic
// Tuesday, and Saturday is the long design day" — and it cannot express a rest
// day at all, so every day off reads as a failure. A week can hold all of
// that, and it is also the unit people think in: eight problems a week is a
// commitment somebody can keep, where "75 minutes a day" is one they will
// break on the first Thursday they work late.
//
// Two rules hold the design together:
//
//   * **A day is a small list of items, not a duration.** "Two problems" is
//     something you can finish; "sixty minutes" is something you can sit
//     through. The minute band from prep.js stays, as the guard rail it always
//     was — it says when to stop, not what to do.
//   * **The template is a starting point, never a cage.** Every generated week
//     is editable per day, and an edited week is stored whole rather than as a
//     diff against a template that might later change under it.

import { todayISO, daysBetween } from "./logic.js";
import { clarifyToday } from "./clarify.js";
import { pairMocksToday } from "./pair-mock.js";

/** Monday first: the week people plan in starts on Monday, whatever
 *  Date.getDay() thinks. */
export const DAYS = [
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
  { key: "sun", label: "Sunday", short: "Sun" },
];

/**
 * What a day can be asked to hold.
 *
 * Deliberately few. A planner with twenty kinds of session is a planner nobody
 * fills in, and every one of these is something the app can actually start for
 * you — which is the test for whether it earns a place here.
 */
export const ITEM_KINDS = {
  coding: {
    key: "coding", label: "Coding problems", unit: "problem",
    blurb: "Worked under the clock, then reflected on.",
    countable: true, defaultCount: 2, minutesEach: 35,
  },
  mock: {
    key: "mock", label: "Coding mock", unit: "mock",
    blurb: "Spoken out loud, counting down, no hints.",
    countable: true, defaultCount: 1, minutesEach: 45,
  },
  designStudy: {
    key: "designStudy", label: "Design topic", unit: "topic",
    blurb: "One component or pattern read properly, not a whole system.",
    countable: true, defaultCount: 1, minutesEach: 30,
  },
  designProblem: {
    key: "designProblem", label: "Design problem", unit: "problem",
    blurb: "A full staged run: requirements through deep dives.",
    countable: true, defaultCount: 1, minutesEach: 45,
  },
  designMock: {
    key: "designMock", label: "Design deep session", unit: "session",
    blurb: "The long one. Two blocks with a break: a system end to end, then stress-tested.",
    countable: false, defaultCount: 1, minutesEach: 180,
  },
  pairMock: {
    key: "pairMock", label: "Two-mediums mock", unit: "round",
    blurb: "Two mediums in forty-five minutes — the pace some top-tier rounds run at.",
    countable: false, defaultCount: 1, minutesEach: 55,
  },
  clarify: {
    key: "clarify", label: "Clarify drill", unit: "prompt",
    blurb: "A vague prompt: the questions to ask before writing a line.",
    countable: true, defaultCount: 2, minutesEach: 5,
  },
  drill: {
    key: "drill", label: "Pattern drill", unit: "drill",
    blurb: "Recall only — which pattern is this, and why.",
    countable: true, defaultCount: 1, minutesEach: 10,
  },
  rest: {
    key: "rest", label: "Rest", unit: "",
    blurb: "Genuinely off. A week with no rest day is a week somebody abandons in three.",
    countable: false, defaultCount: 0, minutesEach: 0,
  },
};

export const itemKind = (key) => ITEM_KINDS[key] || null;

/** Minutes a day's items are expected to take. */
export function dayMinutes(day) {
  return (day?.items || []).reduce((n, item) => {
    const kind = itemKind(item.kind);
    if (!kind) return n;
    return n + kind.minutesEach * (kind.countable ? (item.count ?? kind.defaultCount) : 1);
  }, 0);
}

/** How many of one kind a whole week asks for. */
export function weeklyCount(week, kindKey) {
  return (week?.days || []).reduce((n, day) => n + (day.items || [])
    .filter((i) => i.kind === kindKey)
    .reduce((m, i) => m + (itemKind(i.kind)?.countable ? (i.count ?? 1) : 1), 0), 0);
}

export const weeklyProblems = (week) => weeklyCount(week, "coding") + weeklyCount(week, "mock");
export const weeklyMinutes = (week) => (week?.days || []).reduce((n, d) => n + dayMinutes(d), 0);

const rest = (key) => ({ day: key, items: [{ kind: "rest" }] });
const coding = (key, count, extra = []) => ({ day: key, items: [{ kind: "coding", count }, ...extra] });

/**
 * The shapes people actually keep to.
 *
 * Each one is a function of how much coding a week should hold and whether
 * design is part of the picture, so the same shape scales from four problems a
 * week to twelve without becoming a different plan.
 */
export const WEEK_TEMPLATES = [
  {
    key: "weekdays", label: "Weekdays, weekend off",
    blurb: "Five working days, both weekend days genuinely free.",
    build: ({ problems, design }) => {
      const designDays = design.perWeek > 0 ? ["tue", "thu"].slice(0, design.perWeek) : [];
      const spread = spreadOver(["mon", "tue", "wed", "thu", "fri"], problems, { light: designDays });
      const days = DAYS.map((d) => {
        if (d.key === "sat" || d.key === "sun") return rest(d.key);
        const extra = designDays.includes(d.key) ? [{ kind: design.kind, count: 1 }] : [];
        return coding(d.key, spread[d.key], extra);
      });
      return { days };
    },
  },
  {
    key: "weekdaysPlusDesign", label: "Weekdays, plus a design Saturday",
    blurb: "Coding Monday to Friday, with design folded into two of them, and one long design session at the weekend.",
    build: ({ problems, design }) => {
      // Tuesday reads a topic, Thursday works a whole problem: the study comes
      // before the thing it is studied for.
      const designDays = design.perWeek > 0 ? ["tue", "thu"].slice(0, design.perWeek) : [];
      const spread = spreadOver(["mon", "tue", "wed", "thu", "fri"], problems, { light: designDays });
      const days = DAYS.map((d) => {
        if (d.key === "sun") return rest(d.key);
        if (d.key === "sat") return { day: "sat", items: [{ kind: "designMock" }] };
        const extra = designDays.includes(d.key)
          ? [{ kind: d.key === "tue" ? "designStudy" : "designProblem", count: 1 }] : [];
        return coding(d.key, spread[d.key], extra);
      });
      return { days };
    },
  },
  {
    key: "everyOther", label: "Every other day",
    blurb: "Fewer, longer sittings. Suits a week that will not give you an hour every evening.",
    build: ({ problems, design }) => {
      const on = ["mon", "wed", "fri", "sat"];
      const spread = spreadOver(on, problems);
      return {
        days: DAYS.map((d) => {
          if (!on.includes(d.key)) return rest(d.key);
          const extra = design.perWeek > 0 && d.key === "sat"
            ? [{ kind: design.kind, count: 1 }] : [];
          return coding(d.key, spread[d.key], extra);
        }),
      };
    },
  },
  {
    key: "weekendHeavy", label: "Light weekdays, heavy weekend",
    blurb: "A drill or one problem on working days, and the real work on Saturday and Sunday.",
    build: ({ problems, design }) => {
      const weekend = Math.max(2, Math.round(problems * 0.6));
      const weekday = Math.max(0, problems - weekend);
      // Monday off, because it is the day after the heavy weekend. A shape
      // whose light days are still every day is not a light week.
      const working = ["tue", "wed", "thu", "fri"];
      const spreadWeek = spreadOver(working, weekday);
      const spreadEnd = spreadOver(["sat", "sun"], weekend);
      return {
        days: DAYS.map((d) => {
          if (d.key === "mon") return rest("mon");
          if (d.key === "sat" || d.key === "sun") {
            const extra = design.perWeek > 0 && d.key === "sat" ? [{ kind: design.kind, count: 1 }] : [];
            return coding(d.key, spreadEnd[d.key], extra);
          }
          if (!spreadWeek[d.key]) return { day: d.key, items: [{ kind: "drill", count: 1 }] };
          return coding(d.key, spreadWeek[d.key]);
        }),
      };
    },
  },
  {
    key: "daily", label: "A little every day",
    blurb: "Seven short days. The most forgiving shape, and the one that builds a habit fastest.",
    build: ({ problems, design }) => {
      const spread = spreadOver(DAYS.map((d) => d.key), problems);
      return {
        days: DAYS.map((d) => {
          const extra = design.perWeek > 0 && d.key === "sun" ? [{ kind: design.kind, count: 1 }] : [];
          return spread[d.key] ? coding(d.key, spread[d.key], extra)
            : { day: d.key, items: [{ kind: "drill", count: 1 }, ...extra] };
        }),
      };
    },
  },
];

export const templateByKey = (key) => WEEK_TEMPLATES.find((t) => t.key === key) || WEEK_TEMPLATES[0];

/** A day carrying design work takes one problem, not two. */
export const LIGHT_DAY_PROBLEMS = 1;

/**
 * Hand out n problems across the given days.
 *
 * Whole numbers, never an average: two on Monday and one on Tuesday is a plan
 * somebody follows, and 1.6 every day is a rounding error they have to resolve
 * every morning.
 *
 * Days named `light` are the ones already carrying something else — a design
 * topic, a deep dive — and they are capped first, so the coding load moves off
 * them and onto the days that have room. Without that the design days become
 * the heaviest days of the week, which is how design quietly stops happening.
 */
function spreadOver(dayKeys, n, { light = [] } = {}) {
  const out = Object.fromEntries(dayKeys.map((k) => [k, 0]));
  const lightSet = new Set(light.filter((k) => dayKeys.includes(k)));
  const heavy = dayKeys.filter((k) => !lightSet.has(k));
  let left = Math.max(0, n);

  for (const k of lightSet) {
    const take = Math.min(LIGHT_DAY_PROBLEMS, left);
    out[k] = take;
    left -= take;
  }
  const order = heavy.length ? heavy : dayKeys;
  for (let i = 0; left > 0 && i < left + order.length * (n + 1); i++) {
    out[order[i % order.length]] += 1;
    left -= 1;
  }
  return out;
}

/**
 * The share of a day that is actually new problems.
 *
 * A day is not all core work: it opens with a warm-up and ends with the review,
 * and the review is the part that teaches. Costing the whole day against
 * problems is how an estimate tells somebody with ninety minutes that they can
 * do eighteen problems a week, which is both wrong and exactly the
 * over-committing this app exists to argue against. Matches the core share of
 * the block shape in prep.js.
 */
export const CORE_SHARE = 0.53;

/** Roughly how many problems a week a band supports, once the warm-up and the
 *  review are paid for. */
export function problemsForBand(band, codingDaysPerWeek = 5) {
  const perDay = ((band.min + band.max) / 2) * CORE_SHARE;
  const each = ITEM_KINDS.coding.minutesEach;
  return Math.max(1, Math.round((perDay * codingDaysPerWeek) / each));
}

/** Days in a week that ask for a coding problem at all — the only days the
 *  estimate above should be spread over. */
export function codingDays(week) {
  return (week?.days || []).filter((d) => (d.items || [])
    .some((i) => i.kind === "coding" || i.kind === "mock")).length;
}

export const DEFAULT_WEEK = {
  template: "weekdays",
  problems: 8,
  design: { perWeek: 0, kind: "designStudy" },
  days: null,          // null means "derive from the template"
};

/** Whether somebody has set up a week at all. Until they have, nothing reads
 *  from it: the dashboard's day card and the day's gating of the coding
 *  recommendation both stay out of the way. */
export function weekConfigured(state) {
  return !!state?.settings?.week;
}

export function weekSettings(state) {
  return { ...DEFAULT_WEEK, ...(state?.settings?.week || {}) };
}

/**
 * The week in force.
 *
 * An edited week is stored whole and wins outright. Otherwise it is built from
 * the template each time, so changing the problem count or turning design on
 * reshapes the week rather than leaving a stale copy behind.
 */
export function weekPlan(state) {
  const settings = weekSettings(state);
  if (Array.isArray(settings.days) && settings.days.length === DAYS.length) {
    return { days: settings.days, template: settings.template, edited: true };
  }
  const built = templateByKey(settings.template).build({
    problems: settings.problems,
    design: settings.design || DEFAULT_WEEK.design,
  });
  return { ...built, template: settings.template, edited: false };
}

/** Which day of the week an ISO date is, Monday-first. */
export function dayKeyOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(y, m - 1, d).getDay();   // 0 = Sunday
  return DAYS[(js + 6) % 7].key;
}

/** What today is for. */
export function todaysSlot(state, today = todayISO()) {
  const week = weekPlan(state);
  const key = dayKeyOf(today);
  const day = week.days.find((d) => d.day === key) || rest(key);
  return { ...day, label: DAYS.find((d) => d.key === key).label, minutes: dayMinutes(day) };
}

export const isRestDay = (slot) => (slot.items || []).every((i) => i.kind === "rest");

/**
 * How far through today's list you are.
 *
 * Counted from what was actually recorded rather than from a checkbox, so it
 * cannot drift from the log. A day is done when every countable item is met —
 * and a rest day is done on arrival, which is the point of having one.
 */
export function dayProgress(state, today = todayISO()) {
  const slot = todaysSlot(state, today);
  const attempts = (state.problems || []).flatMap((p) => (p.attempts || [])
    .filter((a) => a.date === today)
    .map((a) => ({ ...a, problemId: p.id })));
  const mocksToday = (state.mocks || []).filter((m) => m.date === today).length;
  const designToday = (state.designProblems || [])
    .flatMap((p) => (p.attempts || []).filter((a) => a.date === today)).length;

  const done = {
    coding: attempts.filter((a) => !a.isMock).length,
    mock: mocksToday,
    designProblem: designToday,
    designMock: designToday,
    pairMock: pairMocksToday(state, today),
    clarify: clarifyToday(state, today),
  };
  // What the log cannot see — reading a topic, a drill — is ticked by hand.
  // Counting it as silently done told somebody their Tuesday was finished
  // while the design topic sat unread; counting it as outstanding with no way
  // to clear it would nag for ever. A tick is the honest middle.
  const ticked = state.dayChecks?.[today] || {};

  const items = (slot.items || []).filter((i) => i.kind !== "rest").map((item) => {
    const kind = itemKind(item.kind);
    const want = kind?.countable ? (item.count ?? kind.defaultCount) : 1;
    const detectable = CAN_DETECT.has(item.kind);
    const got = detectable
      ? Math.min(want, done[item.kind] ?? 0)
      : (ticked[item.kind] ? want : 0);
    return {
      ...item, kind: item.kind, label: kind?.label || item.kind,
      want, got, met: got >= want, manual: !detectable,
    };
  });

  const rested = isRestDay(slot);
  return {
    slot, items, rested,
    complete: rested || items.every((i) => i.met),
    remaining: items.filter((i) => !i.met),
  };
}

/** How many days of hand ticks are kept. Only today's are ever read; the rest
 *  are kept briefly so a tick survives a device that is a day behind. */
export const DAY_CHECK_DAYS = 14;

/**
 * Tick, or untick, something the log cannot see.
 *
 * Mutates `state`, for use inside store.mutate. Old dates are dropped on the
 * way through, so a year of ticks never accumulates in the synced file — every
 * byte of that file is paid for on every save.
 */
export function setDayCheck(state, kind, on, today = todayISO()) {
  const checks = { ...(state.dayChecks || {}) };
  const day = { ...(checks[today] || {}) };
  if (on) day[kind] = true; else delete day[kind];
  if (Object.keys(day).length) checks[today] = day; else delete checks[today];
  for (const date of Object.keys(checks)) {
    if (daysBetween(date, today) >= DAY_CHECK_DAYS) delete checks[date];
  }
  state.dayChecks = checks;
}

/** The kinds the log can actually confirm. */
const CAN_DETECT = new Set(["coding", "mock", "designProblem", "designMock", "pairMock", "clarify"]);

/** Problems recorded across the last seven days, against what the week asks
 *  for. The honest unit for "am I keeping to this". */
export function weekProgress(state, today = todayISO()) {
  const week = weekPlan(state);
  const want = weeklyProblems(week);
  const got = (state.problems || []).flatMap((p) => p.attempts || [])
    .filter((a) => {
      const gap = daysBetween(a.date, today);
      return gap >= 0 && gap < 7;
    }).length;
  return { want, got, week, onTrack: got >= want * 0.75 };
}
