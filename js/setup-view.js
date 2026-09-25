// Connecting to GitHub, and resolving a conflict when two devices disagree.
//
// Where this fits: the two screens that stand between you and your data. Both
// are shown by app.js in place of the normal chrome — there is no nav on
// either, because until one of them is resolved there is nothing to navigate.
//
// They live together because they are the same subject seen twice: this is
// where the app explains that your log is a file in a repo you own, and where
// it admits that owning a file in a repo means two copies can diverge.

import { compareStates } from "./logic.js";
import { esc, fmtDate, toast, downloadState, confirmLoss } from "./ui.js";
import { defaultDataPath, IS_DEV } from "./channel.js";

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
          <!-- Generic on purpose: this repo is public, and the placeholder
               shouldn't carry a real person's handle or any part of their
               email address. -->
          <input class="input" name="owner" required placeholder="your-github-username" /></label>
        <label class="field"><span class="label">Repository name</span>
          <input class="input" name="repo" required placeholder="leetcode" /></label>
        <label class="field"><span class="label">Branch</span>
          <input class="input" name="branch" required value="main" /></label>
        <label class="field"><span class="label">Data file path</span>
          <input class="input" name="path" required value="${esc(defaultDataPath())}" /></label>
        <label class="field"><span class="label">Personal access token</span>
          <input class="input" name="token" type="password" required placeholder="github_pat_…" /></label>
        ${IS_DEV ? `<p class="banner banner-warn small">This is a development copy. The path above
          defaults to a separate file on purpose — pointing it at your real log means testing
          changes against your own practice history.</p>` : ""}
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
      path: f.get("path").trim() || defaultDataPath(),
      token: f.get("token").trim(),
    });
    store.init();
  });
}

export function renderConflict(root, store, rerender) {
  // Both options here permanently discard one side of the user's own practice
  // history, and the screen used to present that choice blind. Fetching the
  // other version read-only first turns it into an informed one — and usually
  // a reassuring one, since most conflicts are a device a few minutes stale
  // rather than real work on both sides.
  const render = (diff, error) => {
    const side = (label, summary) => summary ? `
      <div class="conflict-side">
        <h3 class="small-heading">${label}</h3>
        <p class="small">${summary.attempts} logged attempt${summary.attempts === 1 ? "" : "s"}
        across ${summary.problems} problem${summary.problems === 1 ? "" : "s"}${summary.soulStatements
          ? `, ${summary.soulStatements} with a soul statement` : ""}.</p>
        <p class="muted small">${summary.lastActivity ? `Last activity ${fmtDate(summary.lastActivity)}` : "No activity recorded"}</p>
      </div>` : `
      <div class="conflict-side"><h3 class="small-heading">${label}</h3>
      <p class="muted small">Couldn't be read.</p></div>`;

    root.innerHTML = `
      <div class="card">
        <h2>Sync conflict</h2>
        <p>The file on GitHub changed since this device last loaded it — usually a save from another
        device. Nothing has been overwritten; pick which version to keep.</p>

        ${diff ? verdictHtml(diff) : `<p class="muted small">${error
          ? `Couldn't read the other version to compare (${esc(error)}). Both options below still work, but
             this device can't tell you what they'd discard — export a copy first if it matters.`
          : "Comparing the two versions…"}</p>`}

        ${diff ? `<div class="two-col conflict-compare">
          ${side("On this device", diff.mine)}
          ${side("On GitHub", diff.theirs)}
        </div>` : ""}

        <div class="row gap" style="margin-top:1rem">
          <button class="btn btn-primary" id="keep-mine">Keep this device's version</button>
          <button class="btn btn-ghost" id="take-theirs">Use the version on GitHub</button>
          <button class="btn btn-ghost" id="conflict-export">Download this device's copy first</button>
        </div>
      </div>`;

    root.querySelector("#keep-mine").addEventListener("click", async () => {
      if (!confirmDiscard(diff, "theirs")) return;
      await store.resolveConflictKeepMine();
      rerender();
    });
    root.querySelector("#take-theirs").addEventListener("click", async () => {
      if (!confirmDiscard(diff, "mine")) return;
      await store.resolveConflictTakeTheirs();
      rerender();
    });
    root.querySelector("#conflict-export").addEventListener("click", () => {
      downloadState(store.state);
      toast("Saved a copy of this device's data.");
    });
  };

  render(null, null);
  // Read-only: this never writes, so looking costs nothing even if the user
  // then picks the other side.
  store.peekRemoteState()
    .then((remote) => render(compareStates(store.state, remote), null))
    .catch((err) => render(null, err.message || String(err)));
}

/** The headline: what, if anything, is actually at risk. */
function verdictHtml(diff) {
  if (diff.identical) {
    return `<p class="banner banner-good small">Both versions contain the same logged attempts —
      whichever you pick, nothing is lost.</p>`;
  }
  if (diff.safeChoice === "theirs") {
    return `<p class="banner banner-good small">The GitHub version has
      ${diff.attemptsOnlyThere} attempt${diff.attemptsOnlyThere === 1 ? "" : "s"} this device doesn't,
      and this device has none that it's missing. Using the GitHub version loses nothing.</p>`;
  }
  if (diff.safeChoice === "mine") {
    return `<p class="banner banner-good small">This device has
      ${diff.attemptsOnlyHere} attempt${diff.attemptsOnlyHere === 1 ? "" : "s"} GitHub doesn't,
      and GitHub has none this device is missing. Keeping this device's version loses nothing.</p>`;
  }
  return `<p class="banner banner-warn small">Both versions have work the other doesn't —
    ${diff.attemptsOnlyHere} attempt${diff.attemptsOnlyHere === 1 ? "" : "s"} only here and
    ${diff.attemptsOnlyThere} only on GitHub. Whichever you choose, the other side's attempts go.
    Download a copy first if you'd rather not lose either.</p>`;
}

function confirmDiscard(diff, losing) {
  const count = losing === "mine" ? diff?.attemptsOnlyHere : diff?.attemptsOnlyThere;
  if (!count) return true; // nothing unique on the side being dropped
  const where = losing === "mine" ? "this device" : "GitHub";
  const plural = count === 1 ? { s: "", verb: "exists" } : { s: "s", verb: "exist" };
  const surviving = losing === "mine" ? "GitHub" : "this device";
  return confirmLoss({
    action: `Keep the version on ${surviving}?`,
    lost: `${count} logged attempt${plural.s} that only ${plural.verb} on ${where}`,
    kept: `everything on ${surviving}`,
  });
}
