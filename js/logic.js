// Pure functions: spaced repetition, daily budget planning, pattern analytics,
// streaks, system-design unlock. No DOM, no network — easy to reason about and
// easy to extend as the system grows.

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function daysBetween(aISO, bISO) {
  const [ay, am, ad] = aISO.split("-").map(Number);
  const [by, bm, bd] = bISO.split("-").map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

export const MISTAKE_TAGS = [
  "misread-problem",
  "wrong-pattern-id",
  "edge-case-missed",
  "implementation-bug",
  "time-management",
  "forgot-technique",
  "off-by-one",
  "complexity-misjudged",
  "communication",
  "other",
];

export const MOCK_CHECKLIST = [
  "Clarified constraints & edge cases before coding",
  "Stated approach out loud before typing",
  "Narrated trade-offs while coding",
  "Stated time/space complexity unprompted",
  "Tested with an example before declaring done",
];

/** Leitner-style box scheduling: clean solve advances a box, a struggle holds,
 * a failure resets to box 0. Mutates `problem` in place. */
export function applyOutcome(problem, outcome, settings) {
  const intervals = settings.boxIntervalsDays;
  let box = problem.box || 0;
  if (outcome === "solved-clean") box = Math.min(box + 1, intervals.length - 1);
  else if (outcome === "failed") box = 0;
  problem.box = box;
  problem.nextReviewDate = addDaysISO(todayISO(), intervals[box]);
}

export function dueProblems(state) {
  const today = todayISO();
  return state.problems
    .filter((p) => !p.nextReviewDate || p.nextReviewDate <= today)
    .sort((a, b) => a.box - b.box || (a.nextReviewDate || "").localeCompare(b.nextReviewDate || ""));
}

/** Greedily fills today's review budget with the weakest/most-overdue
 * problems first, so a 75-minute day never silently drops what matters most. */
export function planToday(state) {
  const due = dueProblems(state);
  const budget = state.settings.dailyBudgetMin;
  const est = state.settings.estimateMinByDifficulty;
  let used = 0;
  const plan = [];
  const overflow = [];
  for (const p of due) {
    const cost = est[p.difficulty] ?? est.Unrated ?? 30;
    if (plan.length === 0 || used + cost <= budget) {
      plan.push(p);
      used += cost;
    } else {
      overflow.push(p);
    }
  }
  return { plan, overflow, usedMin: used, budgetMin: budget };
}

export function allAttempts(state, patternId) {
  const problems = patternId ? state.problems.filter((p) => p.patternId === patternId) : state.problems;
  const out = [];
  for (const p of problems) {
    for (const a of p.attempts) {
      out.push({ ...a, problemId: p.id, problemName: p.name, patternId: p.patternId });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

export function patternStats(state) {
  return state.patterns.map((pat) => {
    const attempts = allAttempts(state, pat.id);
    const n = attempts.length;
    const solvedClean = attempts.filter((a) => a.outcome === "solved-clean").length;
    const guessedCorrect = attempts.filter((a) => a.patternGuess === "correct").length;
    const times = attempts.map((a) => a.timeToInsightMin).filter((t) => typeof t === "number" && !Number.isNaN(t));
    const avgInsight = times.length ? times.reduce((s, t) => s + t, 0) / times.length : null;
    const mistakeFreq = {};
    attempts.forEach((a) => (a.mistakeTags || []).forEach((t) => (mistakeFreq[t] = (mistakeFreq[t] || 0) + 1)));
    const topMistake = Object.entries(mistakeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
      pattern: pat,
      problemCount: state.problems.filter((p) => p.patternId === pat.id).length,
      attempts: n,
      solvedCleanRate: n ? solvedClean / n : null,
      patternGuessRate: n ? guessedCorrect / n : null,
      avgInsightMin: avgInsight,
      topMistake,
    };
  });
}

export function updateStreak(state) {
  const today = todayISO();
  const streak = state.streak;
  if (streak.lastActiveDate === today) return;
  if (streak.lastActiveDate && daysBetween(streak.lastActiveDate, today) === 1) {
    streak.current += 1;
  } else {
    streak.current = 1;
  }
  streak.longest = Math.max(streak.longest || 0, streak.current);
  streak.lastActiveDate = today;
}

export function systemDesignUnlock(state) {
  const { minMocks, minSolvedCleanRate } = state.settings.systemDesignUnlockThreshold;
  const recent = state.mocks.slice(-10);
  const rate = recent.length ? recent.filter((m) => m.outcome === "solved-clean").length / recent.length : 0;
  const meetsAuto = state.mocks.length >= minMocks && rate >= minSolvedCleanRate;
  return {
    unlocked: state.systemDesign.manualUnlock || meetsAuto,
    manualUnlock: state.systemDesign.manualUnlock,
    mocksLogged: state.mocks.length,
    minMocks,
    recentSolvedCleanRate: rate,
    minSolvedCleanRate,
  };
}

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
