// projectPlan.js
//
// The brains of the project-order feature:
//   - DEFAULT_PLAN_TEXT   TUN's project order, built into the bot
//   - parsePlanText       reads the list an admin pastes into /set_project_order
//   - fetchNationProjects asks the game which planned projects a nation has built
//   - verifyProjectKeys   checks every planned project name exists in the game data
//   - buildRecommendations works out what is overdue and what comes next
//
// A plan entry looks like:
//   { key: "bauxiteworks", fromCity: 12, atCity: 20, continents: ["af"] }
//     fromCity  = the project becomes available at this city count
//     atCity    = the project is meant to be bought by this city count; a nation
//                 above it is "overdue"
//     continents = (optional) only recommended to nations on these continents
//
// If an admin has saved their own plan (settings.projectPlan) it is used;
// otherwise the built-in default below is used.

const { queryPNW } = require("../pnw");
const { projectByKey, canonicalKey, findProject, continentCode, CONTINENT_NAMES } = require("./projectCatalog");

const MAX_CITY_COUNT = 200;

// TUN's project order. The same format works in /set_project_order, so it can
// be edited there at any time (the form opens with the current order filled in).
const DEFAULT_PLAN_TEXT = `
C1-C10 - Activity Center
C1-C10 - Intelligence Agency
C1-C10 - Propaganda Bureau
C1-C10 - Research and Development Center
C1-C10 - Center for Civil Engineering
C1-C10 - Arable Land Agency
C1-C10 - Advanced Engineering Corps
C12-C20 - Government Support Agency
C12-C20 - Bauxiteworks [Africa]
C12-C20 - Ironworks [North America]
C12-C20 - Missile Launch Pad
C12-C20 - Iron Dome
C21-C28 - Nuclear Research Facility
C21-C28 - Bureau of Domestic Affairs
C21-C28 - Clinical Research Center
C21-C28 - International Trade Center
C21-C28 - Specialized Police Training Program
C21-C28 - Vital Defense System
C30-C34 - Military Research Center
C30-C34 - Military Doctrine
C30-C34 - Emergency Gasoline Reserve
C30-C34 - Pirate Economy
C30-C34 - Space Program
C30-C34 - Telecommunications Satellite
C30-C34 - Advanced Pirate Economy
C35-C45 - Green Technologies
C35-C45 - Spy Satellite
C35-C45 - Fallout Shelter
C35-C45 - Mass Irrigation
C35-C45 - Arms Stockpile
C35-C45 - Uranium Enrichment Program
`;

// ---------------------------------------------------------------------------
// Reading a list
// ---------------------------------------------------------------------------

// One project per line, in almost any layout:
//   "C1-C10 - Intelligence Agency"   "C10 - Urban Planning"   "10: Urban Planning"
//   "C12-C20 - Bauxiteworks [Africa]"   (the [ ] part limits it to those continents)
// One number = a single city count; two numbers = a range. Blank lines and
// lines starting with # are ignored.
// Returns { entries, errors }. If there are ANY errors nothing should be saved.
function parsePlanText(text) {
  const entries = [];
  const errors = [];
  const seen = new Map(); // project key -> line number

  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const lineNumber = index + 1;
      let line = rawLine.trim();
      if (!line || line.startsWith("#")) return;

      // [Africa] or [North America, Europe]
      let continents = null;
      const bracket = line.match(/\[([^\]]*)\]/);
      if (bracket) {
        const codes = [];
        let unknownName = null;
        for (const part of bracket[1].split(/,|\/|\bor\b/i)) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const code = continentCode(trimmed);
          if (code) codes.push(code);
          else if (!unknownName) unknownName = trimmed;
        }
        if (unknownName) {
          errors.push(
            `Line ${lineNumber}: unknown continent "${unknownName}" - use Africa, North America, South America, Europe, Asia, Australia or Antarctica.`
          );
          return;
        }
        if (codes.length === 0) {
          errors.push(`Line ${lineNumber}: the [ ] part is empty.`);
          return;
        }
        continents = [...new Set(codes)];
        line = line.replace(bracket[0], " ").trim();
      }

      const numbers = line.match(/\d+/g) || [];
      if (numbers.length === 0) {
        errors.push(`Line ${lineNumber}: "${rawLine.trim()}" has no city count.`);
        return;
      }
      if (numbers.length > 2) {
        errors.push(`Line ${lineNumber}: "${rawLine.trim()}" has too many numbers - use one city count or one range like C12-C20.`);
        return;
      }

      const fromCity = Number(numbers[0]);
      const atCity = numbers.length === 2 ? Number(numbers[1]) : fromCity;
      if (atCity < fromCity) {
        errors.push(`Line ${lineNumber}: the range ${fromCity}-${atCity} goes backwards.`);
        return;
      }
      if (fromCity < 1 || atCity > MAX_CITY_COUNT) {
        errors.push(`Line ${lineNumber}: city counts should be between 1 and ${MAX_CITY_COUNT}.`);
        return;
      }

      const nameText = line
        .replace(/\d+/g, " ")
        .replace(/[@:|\-\u2013\u2014()\[\],.#]/g, " ")
        .replace(/\b(?:c|city|cities|at|by|to)\b/gi, " ")
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
      entries.push({ key: match.project.key, fromCity, atCity, ...(continents ? { continents } : {}) });
    });

  return { entries, errors };
}

// Earliest deadline first; projects with the same range keep the order the
// admin listed them in.
function sortEntries(entries) {
  return entries
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => a.atCity - b.atCity || (a.fromCity ?? a.atCity) - (b.fromCity ?? b.atCity) || a.order - b.order);
}

// "C12-C20" for a range, "C10" for a single city count.
function rangeLabel(fromCity, atCity) {
  return fromCity === atCity ? `C${atCity}` : `C${fromCity}\u2013C${atCity}`;
}

function continentLabel(continents) {
  return continents.map((code) => CONTINENT_NAMES[code] || code).join(", ");
}

// The text shown in the /set_project_order form (parses back into the same plan).
function formatPlanText(entries) {
  return sortEntries(entries)
    .map((entry) => {
      const from = entry.fromCity ?? entry.atCity;
      const range = from === entry.atCity ? `C${entry.atCity}` : `C${from}-C${entry.atCity}`;
      const where = entry.continents?.length ? ` [${continentLabel(entry.continents)}]` : "";
      return `${range} - ${projectByKey(entry.key)?.name ?? entry.key}${where}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Which plan is in use
// ---------------------------------------------------------------------------

const parsedDefault = parsePlanText(DEFAULT_PLAN_TEXT);
if (parsedDefault.errors.length > 0) {
  // Should never happen; logged instead of crashing the bot.
  console.error("[projectPlan] The built-in default plan has problems:", parsedDefault.errors);
}
const DEFAULT_ENTRIES = parsedDefault.entries;

function hasSavedPlan(settings) {
  return Array.isArray(settings.projectPlan?.entries) && settings.projectPlan.entries.length > 0;
}

function getPlanEntries(settings) {
  const entries = hasSavedPlan(settings) ? settings.projectPlan.entries : DEFAULT_ENTRIES;
  // Plans saved earlier may hold an old project key; swap in the corrected one.
  return entries.map((entry) => ({ ...entry, key: canonicalKey(entry.key) }));
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
  const hints = {}; // rejected field -> the game's own "did you mean" suggestions

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const data = await queryPNW(buildQuery(remaining), variables);
      return { data, unknown, hints };
    } catch (error) {
      const rejected = [];
      for (const part of String(error.message).replace(/^PnW API error:\s*/, "").split(" | ")) {
        const match = part.trim().match(/^Cannot query field "([^"]+)" on type "Nation"\.?(?:\s*Did you mean (.*?)\??)?\s*$/);
        if (!match || !remaining.includes(match[1])) continue;
        rejected.push(match[1]);
        if (match[2]) hints[match[1]] = [...match[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      }
      if (rejected.length === 0) throw error;
      unknown.push(...rejected);
      remaining = remaining.filter((key) => !rejected.includes(key));
    }
  }
  throw new Error("The game's data kept rejecting the project names - please try again later.");
}

async function fetchNationProjects(nationId, keys) {
  const buildQuery = (fields) =>
    `query NationProjects($id: [Int]) { nations(id: $id, first: 1) { data { id nation_name num_cities continent projects ${fields.join(" ")} } } }`;

  const { data, unknown, hints } = await queryWithFieldHealing(buildQuery, keys, { id: [nationId] });
  const nation = data?.nations?.data?.[0];
  if (!nation) throw new Error(`No nation found with ID ${nationId}.`);

  const built = new Set(keys.filter((key) => !unknown.includes(key) && nation[key] === true));
  return { nation, built, unverified: new Set(unknown), hints };
}

// Which of these project names does the game not know? Returns the list of
// unknown field names; the game's suggestions (if any) are on list.hints.
async function verifyProjectKeys(keys) {
  const buildQuery = (fields) => `query VerifyProjects { nations(first: 1) { data { id ${fields.join(" ")} } } }`;
  const { unknown, hints } = await queryWithFieldHealing(buildQuery, keys, {});
  unknown.hints = hints;
  return unknown;
}

// ---------------------------------------------------------------------------
// Working out what a nation should buy
// ---------------------------------------------------------------------------

// overdue  = the nation is already ABOVE the city count the project was meant for
// upcoming = everything else still to buy; inRange tells you whether the
//            nation has reached the project's range yet (buy now) or not
// Skipped completely (never recommended): a project that is useless at the
// nation's size (Activity Center above 20 cities), and a project limited to
// other continents.
function buildRecommendations({ numCities, continent }, built, unverified, entries) {
  const nationContinent = continentCode(continent);
  const result = { overdue: [], upcoming: [], built: [], unverified: [], otherContinent: [], applicable: 0 };

  for (const entry of sortEntries(entries)) {
    const project = projectByKey(entry.key);
    if (!project) {
      // Not a project we recognise: flag it instead of silently dropping it.
      result.applicable += 1;
      result.unverified.push({
        key: entry.key,
        name: entry.key,
        fromCity: entry.fromCity ?? entry.atCity,
        atCity: entry.atCity,
        inRange: false
      });
      continue;
    }
    if (project.maxCities != null && numCities > project.maxCities) continue;
    if (entry.continents?.length && !entry.continents.includes(nationContinent)) {
      result.otherContinent.push(project.name);
      continue;
    }

    const fromCity = entry.fromCity ?? entry.atCity;
    const item = { key: entry.key, name: project.name, fromCity, atCity: entry.atCity, inRange: numCities >= fromCity };
    result.applicable += 1;

    if (unverified.has(entry.key)) result.unverified.push(item);
    else if (built.has(entry.key)) result.built.push(item);
    else if (numCities > entry.atCity) result.overdue.push(item);
    else result.upcoming.push(item);
  }

  return result;
}

module.exports = {
  DEFAULT_PLAN_TEXT,
  parsePlanText,
  formatPlanText,
  sortEntries,
  rangeLabel,
  continentLabel,
  hasSavedPlan,
  getPlanEntries,
  fetchNationProjects,
  verifyProjectKeys,
  buildRecommendations
};
