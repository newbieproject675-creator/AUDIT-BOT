// projectCatalog.js
//
// Every project the bot knows about, taken from TUN's list of the projects
// currently in the game (plus two TUN confirmed that the list missed):
//   key       = the field name the Politics & War API uses for that project
//   name      = how the project is displayed
//   aliases   = other spellings an admin might type
//   maxCities = (optional) the project is useless above this many cities, so
//               it is NEVER recommended to a bigger nation
//
// The project NAMES are confirmed by the current in-game list. The API field
// names marked "confirmed" were checked against the live game data earlier in
// this project; the rest follow the same naming pattern. The bot double-checks
// every name against the live game data (/set_project_order and
// /view_project_order), so a wrong field name is reported straight away
// instead of causing a wrong recommendation.

const PROJECTS = [
  { key: "green_technologies", name: "Green Technologies" }, // confirmed
  { key: "advanced_engineering_corps", name: "Advanced Engineering Corps" },
  { key: "arms_stockpile", name: "Arms Stockpile" },
  { key: "uranium_enrichment_program", name: "Uranium Enrichment Program" },
  { key: "iron_works", name: "Ironworks", aliases: ["Iron Works"] },
  { key: "emergency_gasoline_reserve", name: "Emergency Gasoline Reserve" },
  { key: "bauxite_works", name: "Bauxiteworks", aliases: ["Bauxite Works"] },
  { key: "mass_irrigation", name: "Mass Irrigation" }, // confirmed
  { key: "center_for_civil_engineering", name: "Center for Civil Engineering", aliases: ["Civil Engineering Center", "CCE"] }, // confirmed
  { key: "arable_land_agency", name: "Arable Land Agency" }, // confirmed
  { key: "nuclear_research_facility", name: "Nuclear Research Facility" },
  { key: "nuclear_launch_facility", name: "Nuclear Launch Facility" },
  { key: "guiding_satellite", name: "Guiding Satellite" },
  { key: "activity_center", name: "Activity Center", maxCities: 20 }, // confirmed
  { key: "mars_landing", name: "Mars Landing" },
  { key: "clinical_research_center", name: "Clinical Research Center" },
  { key: "fallout_shelter", name: "Fallout Shelter" },
  { key: "government_support_agency", name: "Government Support Agency" },
  { key: "international_trade_center", name: "International Trade Center" },
  { key: "iron_dome", name: "Iron Dome" },
  { key: "military_salvage", name: "Military Salvage" },
  { key: "recycling_initiative", name: "Recycling Initiative" }, // confirmed
  { key: "missile_launch_pad", name: "Missile Launch Pad" },
  { key: "moon_landing", name: "Moon Landing" },
  {
    key: "research_and_development_center", // confirmed
    name: "Research and Development Center",
    aliases: ["R&D Center", "R and D Center", "Research & Development Center"]
  },
  { key: "pirate_economy", name: "Pirate Economy" },
  { key: "propaganda_bureau", name: "Propaganda Bureau" },
  { key: "advanced_pirate_economy", name: "Advanced Pirate Economy" },
  { key: "surveillance_network", name: "Surveillance Network" },
  { key: "bureau_of_domestic_affairs", name: "Bureau of Domestic Affairs" },
  // The in-game "Intelligence Agency" is the project the game's data calls
  // central_intelligence_agency (confirmed; it's the one that raises the spy cap to 60).
  {
    key: "central_intelligence_agency",
    name: "Intelligence Agency",
    aliases: ["Central Intelligence Agency", "CIA"]
  },
  { key: "vital_defense_system", name: "Vital Defense System" },
  { key: "telecommunications_satellite", name: "Telecommunications Satellite", aliases: ["Telecommunication Satellite"] },
  { key: "spy_satellite", name: "Spy Satellite" },
  {
    key: "specialized_police_training_program",
    name: "Specialized Police Training Program",
    aliases: ["Police Training Program"]
  },
  { key: "space_program", name: "Space Program" },

  // Real in-game projects (TUN confirmed a nation has both built) that were
  // missing from the list above. Their field names follow the usual pattern
  // and are checked against the live game data.
  { key: "military_research_center", name: "Military Research Center" },
  { key: "military_doctrine", name: "Military Doctrine" }
];

// Older plan entries saved under a key that turned out to be wrong.
const LEGACY_KEYS = {
  intelligence_agency: "central_intelligence_agency",
  ironworks: "iron_works",
  bauxiteworks: "bauxite_works"
};

function canonicalKey(key) {
  return LEGACY_KEYS[key] || key;
}

// The game's continent codes. Africa ("af") is confirmed; the others follow
// the same pattern. Spellings like "North America" or "NA" are all accepted.
const CONTINENT_NAMES = {
  af: "Africa",
  na: "North America",
  sa: "South America",
  eu: "Europe",
  as: "Asia",
  au: "Australia",
  an: "Antarctica"
};
const CONTINENT_LOOKUP = {
  af: "af", africa: "af",
  na: "na", northamerica: "na",
  sa: "sa", southamerica: "sa",
  eu: "eu", europe: "eu",
  as: "as", asia: "as",
  au: "au", australia: "au", oceania: "au",
  an: "an", antarctica: "an"
};

function continentCode(text) {
  return CONTINENT_LOOKUP[String(text || "").toLowerCase().replace(/[^a-z]/g, "")] || null;
}

// "Urban Planning", "urban planning" and "URBAN-PLANNING" all become "urbanplanning".
function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_KEY = new Map(PROJECTS.map((p) => [p.key, p]));

// Every spelling we accept for a project, pre-normalised for matching.
const LOOKUP = PROJECTS.map((project) => ({
  project,
  forms: [project.name, project.key, ...(project.aliases || [])].map(normalize)
}));

function projectByKey(key) {
  return BY_KEY.get(canonicalKey(key)) || null;
}

function editDistance(a, b) {
  const grid = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) grid[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return grid[a.length][b.length];
}

// Turns whatever an admin typed into a project.
// Returns { project } on a match, or { project: null, suggestions: [names] }.
function findProject(text) {
  const wanted = normalize(text);
  if (!wanted) return { project: null, suggestions: [] };

  // 1. Exact match on the name, the game-data key, or an alias.
  const exact = LOOKUP.find((entry) => entry.forms.includes(wanted));
  if (exact) return { project: exact.project };

  // 2. A distinctive part of a name, e.g. "civil engineering" - only if it
  //    points to exactly one project.
  if (wanted.length >= 5) {
    const partial = LOOKUP.filter((entry) => entry.forms.some((form) => form.includes(wanted)));
    if (partial.length === 1) return { project: partial[0].project };
    if (partial.length > 1) return { project: null, suggestions: partial.slice(0, 3).map((e) => e.project.name) };
  }

  // 3. Probably a typo: suggest the closest names.
  const closest = LOOKUP.map((entry) => ({
    name: entry.project.name,
    distance: Math.min(...entry.forms.map((form) => editDistance(wanted, form)))
  }))
    .filter((c) => c.distance <= Math.max(3, Math.floor(wanted.length * 0.35)))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((c) => c.name);

  return { project: null, suggestions: closest };
}

module.exports = {
  PROJECTS,
  projectByKey,
  canonicalKey,
  findProject,
  normalize,
  continentCode,
  CONTINENT_NAMES
};
