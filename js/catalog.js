// The problem catalog: ~2,500 LeetCode problems indexed by the patterns they
// exercise, so "find me more problems shaped like this one" is a lookup rather
// than a search.
//
// Where this fits: the Analyze view uses it to turn a prediction into practice,
// and the Review Queue uses it to suggest fresh volume on a weak pattern.
//
// The entries are metadata only — title, number, difficulty, tags, URL. No
// problem statements: the catalog says a problem exists and what shape it is,
// and links out to LeetCode for the text itself. Pattern weights come from each
// problem's own LeetCode topic tags, so these are labels rather than
// predictions, and are exact wherever LeetCode tagged the problem.

const CATALOG_URL = "./data/catalog.json";

/**
 * A fetch that failed in a way the UI should explain rather than swallow.
 *
 * Typed so callers can tell "the server said no" apart from a programming
 * error, and so a message shown to the user is never a bare stack trace.
 */
export class CatalogError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = "CatalogError";
    this.status = status;
    this.cause = cause;
  }
}

/**
 * A problem title reduced to the slug LeetCode would use.
 *
 * Shared because both the bank and the Analyze view need to recognize a
 * catalog problem the user already tracks, and they were deriving it
 * independently — two copies of one rule is one rule that can drift.
 */
export function slugify(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Slugs for everything the user already has, however it was added. */
export function savedSlugs(problems) {
  const out = new Set();
  for (const p of problems) {
    if (p.catalogSlug) out.add(p.catalogSlug);
    out.add(slugify(p.name));
  }
  return out;
}

// Match taxonomy.POSITIVE_THRESHOLD in scripts/taxonomy.py: below this a tag is
// a hint, not a claim, and shouldn't be presented as "this is that pattern".
export const PATTERN_CONFIDENCE = 0.5;

let catalogPromise = null;

/**
 * Load the catalog, memoized for the session.
 *
 * `refresh` discards the memo and refetches. A cache with no way to invalidate
 * it is a design gap rather than merely an inconvenience: the catalog is
 * rebuilt by a workflow, so a long-lived tab can otherwise hold a stale copy
 * indefinitely, and nothing could ever re-read it without a full page reload.
 */
export function loadCatalog({ refresh = false } = {}) {
  if (refresh) catalogPromise = null;
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((res) => {
        if (!res.ok) throw new CatalogError("The problem catalog couldn't be loaded.", { status: res.status });
        return res.json();
      })
      .catch((err) => {
        catalogPromise = null; // let a later attempt retry rather than caching the failure
        throw err instanceof CatalogError
          ? err
          : new CatalogError("The problem catalog couldn't be loaded.", { cause: err });
      });
  }
  return catalogPromise;
}

/**
 * Problems that genuinely exercise a pattern, hardest-signal first.
 *
 * `exclude` takes slugs already in the user's own problem list so the app never
 * recommends something they're already tracking.
 */
export async function problemsForPattern(patternId, {
  difficulty = null, limit = 12, exclude = new Set(),
} = {}) {
  const catalog = await loadCatalog();
  return catalog.problems
    .filter((p) => (p.patterns[patternId] || 0) >= PATTERN_CONFIDENCE)
    .filter((p) => !difficulty || p.difficulty === difficulty)
    .filter((p) => !exclude.has(p.slug))
    .sort((a, b) => (b.patterns[patternId] - a.patterns[patternId])
      || (a.number ?? 1e9) - (b.number ?? 1e9))
    .slice(0, limit);
}

// The whole state document is pushed to GitHub on every save, and the Contents
// API stops serving files over 1 MB — past that, sync breaks outright. A bank
// entry is therefore kept to the minimum that describes an unstarted problem:
// no url (it is derivable from the slug), and none of the empty strings and
// arrays a worked problem accumulates. At ~495 bytes per entry the full catalog
// would have produced a ~1.2 MB state file; the slim shape plus MAX_BANK_SIZE
// keeps it around 200 KB.
export const MAX_BANK_SIZE = 500;

/**
 * Where to go and read this problem, or null if we can't say.
 *
 * Tried in order: a stored url, the catalog slug, then the title. The last one
 * works because LeetCode's own slugs follow exactly the convention slugify()
 * implements — "3Sum" is /problems/3sum, "Implement Trie (Prefix Tree)" is
 * /problems/implement-trie-prefix-tree — and it is gated on the problem having
 * a LeetCode number, so hand-written entries like "0/1 Knapsack (reference)"
 * get no link rather than a link to a page that doesn't exist. A wrong link is
 * worse than none; an absent one is at least honest.
 */
export function problemUrl(problem) {
  if (problem.url) return problem.url;
  if (problem.catalogSlug) return `https://leetcode.com/problems/${problem.catalogSlug}/`;
  if (problem.number && problem.name) return `https://leetcode.com/problems/${slugify(problem.name)}/`;
  return null;
}

/**
 * Convert a catalog entry into a problem record for the user's own list.
 *
 * Shared by the bank and the Analyze view so the stored shape is defined once.
 * Fields absent here are genuinely absent, not empty: esc() renders null as ""
 * and the seeded problems carry no per-problem resources or whiteboards either,
 * so nothing downstream needs them to exist.
 */
export function problemFromCatalog(entry, { id, status, patternId = null, nextReviewDate = null }) {
  const ranked = Object.entries(entry.patterns).sort((a, b) => b[1] - a[1]);
  return {
    id,
    name: entry.title,
    number: entry.number,
    difficulty: entry.difficulty || "Unrated",
    patternId: patternId || (ranked.length ? ranked[0][0] : "arrays-hashing"),
    catalogSlug: entry.slug,
    status,
    box: 0,
    nextReviewDate,
    attempts: [],
  };
}

/** How many catalog problems exist per pattern — used to tell the user up front
 * whether a pattern has practice volume available. */
export async function countsByPattern() {
  const catalog = await loadCatalog();
  const counts = {};
  for (const problem of catalog.problems) {
    for (const [pattern, weight] of Object.entries(problem.patterns)) {
      if (weight >= PATTERN_CONFIDENCE) counts[pattern] = (counts[pattern] || 0) + 1;
    }
  }
  return counts;
}
