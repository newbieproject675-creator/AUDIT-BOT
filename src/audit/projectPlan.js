// projectPlan.js
//
// The brains of the project-order feature:
//   - parsePlanText      reads the list an admin pastes into /set_project_order
//   - fetchNationProjects asks the game which planned projects a nation has built
//   - verifyProjectKeys  checks every planned project name exists in the game data
//   - buildRecommendations works out what is overdue and what comes next
//
// The plan is stored in settings.projectPlan as:
//   { entries: [ { key: "urban_planning", atCity: 10 }, ... ], updatedAt: "..." }

const { queryPNW } = require("../pnw");
const { projectByKey, findProject } = require("./projectCatalog");

const MAX_CITY_COUNT = 200;

// ---------------------------------------------------------------------------
// Reading the admin's list
// ---------------------------------------------------------------------------

// Accepts one project per line in almost any layout:
//   "C10 - Urban Planning"   "10: Urban Planning"   "Urban Planning (C10)"
// Blank lines and lines starting with # are ignored.
// Returns { entries, errors }. If there are ANY errors nothing should be saved.
function parsePlanText(text) {
  const entries = [];
  const errors = [];
  const seen = new Map(); // project key -> line number

  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return;

      const numbers = line.match(/\d+/g) || [];
      if (numbers.length === 0) {
        errors.push(`Line ${lineNumber}: "${line}" has no city count.`);
        return;
      }
      if (numbers.length > 1) {
        errors.push(`Line ${lineNumber}: "${line}" has more than one number - use one city count per line.`);
        return;
      }

      const atCity = Number(numbers[0]);
      if (atCity < 1 || atCity > MAX_CITY_COUNT) {
        errors.push(`Line ${lineNumber}: city count ${atCity} should be between 1 and ${MAX_CITY_COUNT}.`);
        return;
      }

      const nameText = line
        .replace(/\d+/, " ")
        .replace(/[@:|\-\u2013\u2014()\[\],.#]/g, " ")
        .replace(/\b(?:c|city|cities|at|by)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!nameText) {
        errors.push(`Line ${lineNumber}: no project name found.`);
        return;
      }

      const match = findProject(nameText);
      if (!match.project) {
        const hint = match.suggestions.length > 0 ? ` Did you mean: ${match.suggestions.join(", ")}?` : "";
        errors.push(`Line ${lineNumber}: couldn't match "${nameText}" to a project.${hint}`);
        return;
      }

      if (seen.has(match.project.key)) {
        errors.push(`Line ${lineNumber}: ${match.project.name} is already listed on line ${seen.get(match.project.key)}.`);
        return;
      }

      seen.set(match.project.key, lineNumber);
      entries.push({ key: match.project.key, atCity });
    });

  return { entries, errors };
}

// Lowest city count first; projects with the same city count keep the order
// the admin listed them in.
function sortEntries(entries) {
  return entries
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => a.atCity - b.atCity || a.order - b.order);
}

function formatPlanText(entries) {
  return sortEntries(entries)
    .map((entry) => `C${entry.atCity} - ${projectByKey(entry.key)?.name ?? entry.key}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Asking the game which projects a nation has
// ---------------------------------------------------------------------------

// If the game doesn't recognise one of the project field names, the whole
// request fails. Instead of failing, drop the unknown field(s), try again, and
// report which ones were unknown - so we never mistake "unknown" for "not built".
async function queryWithFieldHealing(buildQuery, keys, variables) {
  let remaining = [...keys];
  const unknown = [];

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const data = await queryPNW(buildQuery(remaining), variables);
      return { data, unknown };
    } catch (error) {
      const rejected = [...String(error.message).matchAll(/Cannot query field "([^"]+)" on type "Nation"/g)]
        .map((m) => m[1])
        .filter((field) => remaining.includes(field));
      if (rejected.length === 0) throw error;
      unknown.push(...rejected);
      remaining = remaining.filter((key) => !rejected.includes(key));
    }
  }
  throw new Error("The game's data kept rejecting the project names - please try again later.");
}

async function fetchNationProjects(nationId, keys) {
  const buildQuery = (fields) =>
    `query NationProjects($id: [Int]) { nations(id: $id, first: 1) { data { id nation_name num_cities projects ${fields.join(" ")} } } }`;

  const { data, unknown } = await queryWithFieldHealing(buildQuery, keys, { id: [nationId] });
  const nation = data?.nations?.data?.[0];
  if (!nation) throw new Error(`No nation found with ID ${nationId}.`);

  const built = new Set(keys.filter((key) => !unknown.includes(key) && nation[key] === true));
  return { nation, built, unverified: new Set(unknown) };
}

// Used right after saving a plan: which of these names does the game not know?
async function verifyProjectKeys(keys) {
  const buildQuery = (fields) => `query VerifyProjects { nations(first: 1) { data { id ${fields.join(" ")} } } }`;
  const { unknown } = await queryWithFieldHealing(buildQuery, keys, {});
  return unknown;
}

// ---------------------------------------------------------------------------
// Working out what a nation should buy
// ---------------------------------------------------------------------------

// overdue  = the nation has already passed the city count the project was meant for
// upcoming = the project is due now (nation is at that city count) or later
// A project that is useless at the nation's size (Activity Center above 20
// cities) is skipped completely, so it is never recommended.
function buildRecommendations(numCities, built, unverified, entries) {
  const result = { overdue: [], upcoming: [], built: [], unverified: [], applicable: 0 };

  for (const entry of sortEntries(entries)) {
    const project = projectByKey(entry.key);
    if (!project) continue;
    if (project.maxCities != null && numCities > project.maxCities) continue;

    result.applicable += 1;
    const item = { key: entry.key, name: project.name, atCity: entry.atCity };

    if (unverified.has(entry.key)) result.unverified.push(item);
    else if (built.has(entry.key)) result.built.push(item);
    else if (entry.atCity < numCities) result.overdue.push(item);
    else result.upcoming.push(item);
  }

  return result;
}

module.exports = {
  parsePlanText,
  formatPlanText,
  sortEntries,
  fetchNationProjects,
  verifyProjectKeys,
  buildRecommendations
};
