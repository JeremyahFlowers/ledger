// The Progress view: "am I actually getting better?"
//
// Where this fits: its own page under Track. The app already recorded
// everything needed to answer this, but spread across the queue, the quiz and
// the mastery table, so the answer was never actually on screen.
//
// Two decisions shape everything here.
//
// First, better does not mean more. The failure mode this whole app exists to
// prevent is grinding harder and calling it progress, so the headline measures
// are solving cleanly and recognizing the pattern faster. Volume appears only
// so that a spike followed by a collapse is visible for what it is, and a week
// far above the usual is named rather than congratulated.
//
// Second, the charts refuse to flatter. A week with a single attempt shows a
// gap rather than 0% or 100%, empty weeks stay visible instead of being
// collapsed, and a pattern without enough attempts on both sides of a split is
// left out rather than drawn as flat. A chart that misleads is worse than no
// chart, because it gets believed.

import { esc } from "./views.js";
import { weeklyProgress, patternMovement, progressSummary, PROGRESS_WEEKS } from "./logic.js";
import { patternIcon, navIcon } from "./icons.js";

const CHART_WIDTH = 560;
const CHART_HEIGHT = 120;
const PADDING = { top: 10, right: 8, bottom: 20, left: 30 };
// Below this many rated weeks there is no trend to draw, only noise to
// over-interpret.
const MIN_POINTS_FOR_CHART = 2;

export function renderProgress(root, store) {
  const state = store.state;
  const summary = progressSummary(state, PROGRESS_WEEKS);
  const movers = patternMovement(state);

  root.innerHTML = `
    <div class="card">
      <h2>Are you getting better?</h2>
      ${summary.hasEnoughData
        ? `<p class="muted">${headlineText(summary)}</p>`
        : `<p class="muted">Not enough logged yet to show a trend — this needs a couple of weeks
           with at least two sessions each. ${summary.totalAttempts} attempt${summary.totalAttempts === 1 ? "" : "s"}
           recorded across ${summary.activeWeeks} week${summary.activeWeeks === 1 ? "" : "s"} so far.</p>`}
      ${summary.spike ? spikeNoticeHtml(summary.spike) : ""}
    </div>

    ${summary.hasEnoughData ? `
    <div class="card">
      <h2>Clean solves</h2>
      <p class="muted small">Share of attempts you solved without stumbling, by week. Weeks with a
      single attempt are left blank — one attempt isn't a rate.</p>
      ${lineChart(summary.weeks.map((w) => ({ label: shortWeek(w.weekStart), value: w.cleanRate })),
        { format: (v) => `${Math.round(v * 100)}%`, max: 1, min: 0 })}
    </div>

    <div class="card">
      <h2>Time to insight</h2>
      <p class="muted small">Median minutes before you knew the approach. This one is the interview
      skill — falling is good, and it improves long before clean-solve rate does.</p>
      ${lineChart(summary.weeks.map((w) => ({ label: shortWeek(w.weekStart), value: w.medianInsightMin })),
        { format: (v) => `${Math.round(v)}m`, lowerIsBetter: true })}
    </div>` : ""}

    <div class="card">
      <h2>Weekly volume</h2>
      <p class="muted small">Here to show consistency, not to be maximized. An even line beats a
      tall one — spikes are what precede stopping altogether.</p>
      ${volumeChart(summary.weeks)}
    </div>

    ${moversHtml(movers)}`;
}

function headlineText(summary) {
  const parts = [];
  if (summary.cleanRateDelta != null) {
    const points = Math.round(Math.abs(summary.cleanRateDelta) * 100);
    if (points < 3) parts.push("Your clean-solve rate is holding steady");
    else parts.push(`Your clean-solve rate is ${summary.cleanRateDelta > 0 ? "up" : "down"} about ${points} points`);
  }
  if (summary.insightDelta != null) {
    const mins = Math.abs(summary.insightDelta);
    if (mins >= 1) {
      parts.push(`you're reaching the approach about ${mins.toFixed(0)} minute${mins >= 2 ? "s" : ""} ${summary.insightDelta < 0 ? "faster" : "slower"}`);
    }
  }
  if (!parts.length) return "Steady across the last few weeks — no meaningful movement either way.";
  return `${parts.join(", and ")}, comparing the recent half of this window with the earlier half.`;
}

function spikeNoticeHtml(spike) {
  return `
    <div class="banner banner-warn" style="margin-top:0.75rem">
      <strong>That was a big week.</strong>
      <p class="small" style="margin:0.3rem 0 0">${spike.attempts} attempts against a usual
      ${spike.typical}. Worth noticing rather than repeating — this is the shape that tends to come
      right before a fortnight of nothing. A lighter week next is a good outcome, not lost ground.</p>
    </div>`;
}

function shortWeek(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * A line chart that draws gaps as gaps.
 *
 * Null values break the line instead of interpolating across them, because
 * joining two points across a blank week would draw a trend through data that
 * doesn't exist.
 */
function lineChart(points, { format, max = null, min = null, lowerIsBetter = false } = {}) {
  const values = points.map((p) => p.value).filter((v) => v != null);
  if (values.length < MIN_POINTS_FOR_CHART) {
    return `<p class="empty">Not enough weeks with data to draw this yet.</p>`;
  }

  const hi = max != null ? max : Math.max(...values) * 1.15;
  const lo = min != null ? min : Math.min(0, Math.min(...values));
  const span = hi - lo || 1;
  const plotW = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotH = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;

  const x = (i) => PADDING.left + i * step;
  const y = (v) => PADDING.top + plotH - ((v - lo) / span) * plotH;

  // Contiguous runs, so a missing week breaks the line rather than being
  // silently bridged.
  const runs = [];
  let run = [];
  points.forEach((p, i) => {
    if (p.value == null) { if (run.length) runs.push(run); run = []; return; }
    run.push([x(i), y(p.value)]);
  });
  if (run.length) runs.push(run);

  const paths = runs
    .filter((r) => r.length > 1)
    .map((r) => `<path d="${r.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}"
      fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join("");

  const dots = points.map((p, i) => p.value == null ? "" : `
    <circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3"
      fill="var(--accent)"><title>${esc(p.label)}: ${esc(format(p.value))}</title></circle>`).join("");

  const isolated = runs.filter((r) => r.length === 1)
    .map(([[px, py]]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="var(--accent)"/>`).join("");

  // The first and last labels are anchored inward; centred, they overhang the
  // viewBox and get clipped at both ends.
  const anchorFor = (i) => (i === 0 ? "start" : i === points.length - 1 ? "end" : "middle");
  const labels = points.map((p, i) =>
    (i % 2 === 0 || i === points.length - 1)
      ? `<text x="${x(i).toFixed(1)}" y="${CHART_HEIGHT - 5}" text-anchor="${anchorFor(i)}" class="chart-label">${esc(p.label)}</text>`
      : "").join("");

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" class="chart" role="img"
           aria-label="${esc(describeSeries(points, format, lowerIsBetter))}">
        <line x1="${PADDING.left}" y1="${PADDING.top + plotH}" x2="${CHART_WIDTH - PADDING.right}" y2="${PADDING.top + plotH}"
              stroke="var(--border)" stroke-width="1"/>
        <text x="${PADDING.left - 6}" y="${PADDING.top + 4}" text-anchor="end" class="chart-label">${esc(format(hi))}</text>
        <text x="${PADDING.left - 6}" y="${PADDING.top + plotH}" text-anchor="end" class="chart-label">${esc(format(lo))}</text>
        ${paths}${isolated}${dots}${labels}
      </svg>
    </div>`;
}

/** A sentence version of the series, so the chart isn't invisible to anyone
 * using a screen reader. */
function describeSeries(points, format, lowerIsBetter) {
  const withValues = points.filter((p) => p.value != null);
  if (withValues.length < 2) return "Not enough data to describe a trend.";
  const first = withValues[0];
  const last = withValues[withValues.length - 1];
  const rose = last.value > first.value;
  const better = lowerIsBetter ? !rose : rose;
  return `From ${format(first.value)} in the week of ${first.label} to ${format(last.value)} in the week of ${last.label} — ${better ? "an improvement" : "a decline"}.`;
}

function volumeChart(weeks) {
  const max = Math.max(1, ...weeks.map((w) => w.attempts));
  return `
    <ul class="volume-bars">
      ${weeks.map((w) => `
        <li>
          <span class="volume-bar" style="--h:${Math.round((w.attempts / max) * 100)}%"
                title="${esc(shortWeek(w.weekStart))}: ${w.attempts} attempt${w.attempts === 1 ? "" : "s"}, ${w.minutes} min"></span>
          <span class="chart-label">${esc(shortWeek(w.weekStart))}</span>
        </li>`).join("")}
    </ul>
    <p class="muted small" style="margin-top:0.4rem">
      ${weeks.reduce((s, w) => s + w.attempts, 0)} attempts across
      ${weeks.filter((w) => w.attempts > 0).length} active week${weeks.filter((w) => w.attempts > 0).length === 1 ? "" : "s"}.</p>`;
}

function moversHtml(movers) {
  if (!movers.length) {
    return `
      <div class="card">
        <h2>Pattern movement</h2>
        <p class="muted small">Nothing has enough attempts on both sides of a split yet. A pattern
        needs a few reps before and a few after before "improving" means anything.</p>
      </div>`;
  }
  const improved = movers.filter((m) => m.delta > 0.01).slice(0, 5);
  const slipped = movers.filter((m) => m.delta < -0.01).slice(-5).reverse();
  const row = (m) => `
    <li>
      <span class="row gap-sm" style="align-items:center">
        <span class="pattern-icon">${patternIcon(m.pattern.id, { size: 15 })}</span>
        <span>${esc(m.pattern.name)}</span>
      </span>
      <span class="mover-delta ${m.delta > 0 ? "up" : "down"}">
        ${m.delta > 0 ? "+" : ""}${Math.round(m.delta * 100)} pts
        <span class="muted small">${Math.round(m.before * 100)}% &rarr; ${Math.round(m.after * 100)}%</span>
      </span>
    </li>`;

  return `
    <div class="card">
      <h2>Pattern movement</h2>
      <p class="muted small">Recent attempts against everything before them, for patterns with
      enough reps on both sides to compare.</p>
      <div class="two-col">
        <div>
          <h3 class="small-heading">Coming together</h3>
          ${improved.length ? `<ul class="mover-list">${improved.map(row).join("")}</ul>`
            : `<p class="muted small">Nothing clearly improving yet.</p>`}
        </div>
        <div>
          <h3 class="small-heading">Slipping</h3>
          ${slipped.length ? `<ul class="mover-list">${slipped.map(row).join("")}</ul>`
            : `<p class="muted small">Nothing going backwards — good.</p>`}
        </div>
      </div>
    </div>`;
}
