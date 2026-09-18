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
