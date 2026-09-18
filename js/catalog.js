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

// Match taxonomy.POSITIVE_THRESHOLD in scripts/taxonomy.py: below this a tag is
// a hint, not a claim, and shouldn't be presented as "this is that pattern".
export const PATTERN_CONFIDENCE = 0.5;

let catalogPromise = null;

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`catalog unavailable (HTTP ${res.status})`);
        return res.json();
      })
      .catch((err) => {
        catalogPromise = null;
        throw err;
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

export function problemUrl(problem) {
  return problem.url || (problem.catalogSlug
    ? `https://leetcode.com/problems/${problem.catalogSlug}/`
    : null);
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
