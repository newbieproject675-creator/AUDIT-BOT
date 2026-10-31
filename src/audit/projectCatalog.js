// projectCatalog.js
//
// Every project the bot knows about:
//   key       = the field name the Politics & War API uses for that project
//   name      = how the project is displayed
//   aliases   = other spellings an admin might type
//   maxCities = (optional) the project is useless above this many cities, so
//               it is NEVER recommended to a bigger nation
//
// Names marked "confirmed" were checked against the live game data earlier in
// this project. The rest follow the same naming pattern, and the newest ones
// are from memory. The bot double-checks every name against the live game
// data when you save your order (/set_project_order), so a wrong name is
// reported straight away instead of causing a wrong recommendation.

const PROJECTS = [
  // --- Confirmed against the live game data ---
  { key: "green_technologies", name: "Green Technologies" },
  { key: "mass_irrigation", name: "Mass Irrigation" },
  { key: "recycling_initiative", name: "Recycling Initiative" },
  { key: "activity_center", name: "Activity Center", maxCities: 20 },
  { key: "center_for_civil_engineering", name: "Center for Civil Engineering", aliases: ["Civil Engineering Center", "CCE"] },
  { key: "arable_land_agency", name: "Arable Land Agency" },
  {
    key: "research_and_development_center",
    name: "Research and Development Center",
    aliases: ["R&D Center", "R and D Center", "Research & Development Center"]
  },
  { key: "central_intelligence_agency", name: "Central Intelligence Agency", aliases: ["CIA"] },

  // --- Same naming pattern as the confirmed ones ---
  { key: "advanced_engineering_corps", name: "Advanced Engineering Corps" },
  { key: "advanced_urban_planning", name: "Advanced Urban Planning" },
  { key: "arms_stockpile", name: "Arms Stockpile" },
  { key: "bauxiteworks", name: "Bauxiteworks" },
  { key: "clinical_research_center", name: "Clinical Research Center" },
  { key: "emergency_gasoline_reserve", name: "Emergency Gasoline Reserve" },
  { key: "fallout_shelter", name: "Fallout Shelter" },
  { key: "intelligence_agency", name: "Intelligence Agency" },
  { key: "international_trade_center", name: "International Trade Center" },
  { key: "iron_dome", name: "Iron Dome" },
  { key: "ironworks", name: "Ironworks" },
  { key: "metropolitan_planning", name: "Metropolitan Planning" },
  { key: "military_salvage", name: "Military Salvage" },
  { key: "missile_launch_pad", name: "Missile Launch Pad" },
  { key: "moon_landing", name: "Moon Landing" },
  { key: "nuclear_research_facility", name: "Nuclear Research Facility" },
  { key: "pirate_economy", name: "Pirate Economy" },
  { key: "propaganda_bureau", name: "Propaganda Bureau" },
  { key: "space_program", name: "Space Program" },
  {
    key: "specialized_police_training_program",
    name: "Specialized Police Training Program",
    aliases: ["Police Training Program"]
  },
  { key: "spy_satellite", name: "Spy Satellite" },
  { key: "telecommunications_satellite", name: "Telecommunications Satellite", aliases: ["Telecommunication Satellite"] },
  { key: "uranium_enrichment_program", name: "Uranium Enrichment Program" },
  { key: "urban_planning", name: "Urban Planning" },
  { key: "vital_defense_system", name: "Vital Defense System" },

  // --- Newer projects, names from memory (not yet verified) ---
  { key: "advanced_pirate_economy", name: "Advanced Pirate Economy" },
  { key: "mars_landing", name: "Mars Landing" },
  { key: "surveillance_network", name: "Surveillance Network" },
  { key: "guiding_satellite", name: "Guiding Satellite" },
  { key: "nuclear_launch_facility", name: "Nuclear Launch Facility" },
  { key: "government_support_agency", name: "Government Support Agency" },
  { key: "bureau_of_domestic_affairs", name: "Bureau of Domestic Affairs" },
  { key: "resource_production_center", name: "Resource Production Center" }
];

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
  return BY_KEY.get(key) || null;
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

module.exports = { PROJECTS, projectByKey, findProject, normalize };
