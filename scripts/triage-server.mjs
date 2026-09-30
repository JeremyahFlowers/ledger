// Serves the app locally with a stubbed GitHub API, for driving it in a browser.
//
//   node scripts/triage-server.mjs [port]
//
// Where this fits: beside check-views.mjs, which renders every view against a
// fake DOM. That catches a view that throws; it cannot catch one that renders
// wrong. This is for the second kind — open /triage.html and every screen can
// be walked end to end against the populated demo log.
//
// Why it stubs GitHub rather than using a token: a development build must
// never hold write access to somebody's real practice log. The stub answers
// the contents API from memory, so saves "succeed" and go nowhere, and every
// key it writes is namespaced to the dev channel by the app itself.
//
// The seed is built fresh from demo-state.mjs on every start, so it cannot
// drift from what check-views renders.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { demoState } from "./demo-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 8765;

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
};

/** The profile the app's owner described: five weeks out, top tier, a
 *  90–120 minute band, eight problems a week with design on two weekdays and
 *  a long Saturday session. Close enough to real use to exercise every card. */
function seed() {
  const s = demoState();
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const target = new Date(today.getTime() + 36 * 86400000);
  s.settings.prep = {
    targetDate: iso(target), startingPoint: "rusty", target: "top", level: "mid",
    intensity: "focused", startedOn: iso(today),
  };
  s.settings.dailyFloorMin = 90;
  s.settings.dailyBudgetMin = 120;
  s.settings.week = {
    template: "weekdaysPlusDesign", problems: 8,
    design: { perWeek: 2, kind: "designStudy" }, days: null,
  };
  s.settings.designShare = 0.2;
  return JSON.stringify(s);
}

const stub = (state) => `<script>
(() => {
  const files = { "prep-data/state.dev.json": ${JSON.stringify(state)} };
  let n = 0;
  const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const real = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url && url.url ? url.url : url);
    if (!u.startsWith("https://api.github.com")) return real(url, opts);
    const m = u.match(/\\/contents\\/([^?]+)/);
    const path = m ? decodeURIComponent(m[1]) : "";
    if ((opts.method || "GET") === "GET") {
      if (!(path in files)) return new Response("{}", { status: 404 });
      return ok({ sha: "sha" + n, content: b64(files[path]), encoding: "base64" });
    }
    if (opts.method === "PUT") {
      const body = JSON.parse(opts.body);
      files[path] = new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)));
      return ok({ content: { sha: "sha" + ++n } });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    localStorage.setItem("ledger.config.dev", JSON.stringify({
      owner: "triage", repo: "triage", token: "not-a-real-token", path: "prep-data/state.dev.json", branch: "main" }));
    localStorage.setItem("ledger.welcomed.dev", "1");
  } catch (e) {}
})();
</script>`;

const state = seed();

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  const triage = path === "/triage.html";
  const file = join(ROOT, normalize(triage ? "/index.html" : path).replace(/^(\.\.[/\\])+/, ""));
  try {
    let body = await readFile(file);
    if (triage) body = String(body).replace("<head>", "<head>\n" + stub(state));
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`triage server on http://localhost:${PORT}/triage.html`));
