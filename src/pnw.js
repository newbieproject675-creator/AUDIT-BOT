// pnw.js
const PNW_API_URL = "https://api.politicsandwar.com/graphql";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryPNW(query, variables = {}, attempt = 1) {
  const apiKey = process.env.PNW_API_KEY;
  if (!apiKey) throw new Error("Missing PNW_API_KEY in your .env file.");
  let response;
  try {
    response = await fetch(`${PNW_API_URL}?api_key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables })
    });
  } catch (networkError) {
    if (attempt < 3) { await sleep(attempt * 1000); return queryPNW(query, variables, attempt + 1); }
    throw new Error(`Network error talking to the PnW API after ${attempt} attempts: ${networkError.message}`);
  }
  const json = await response.json();
  if (json.errors && json.errors.length > 0) throw new Error(`PnW API error: ${json.errors.map((e) => e.message).join(" | ")}`);
  return json.data;
}

const NATION_QUERY = `
  query GetNation($id: [Int]) {
    nations(id: $id, first: 1) {
      data {
        id nation_name leader_name date continent
        alliance_id alliance_seniority alliance_position color score num_cities
        last_active vacation_mode_turns soldiers tanks aircraft ships
        green_technologies mass_irrigation recycling_initiative activity_center
        center_for_civil_engineering arable_land_agency research_and_development_center
        projects wars_won wars_lost discord discord_id spies central_intelligence_agency
        turns_since_last_city turns_since_last_project
        money food coal oil uranium lead iron bauxite gasoline munitions steel aluminum
        offensive_wars { id turnsleft att_points }
        defensive_wars { id turnsleft }
        cities {
          id name infrastructure land powered
          coal_power oil_power nuclear_power wind_power
          coal_mine oil_well iron_mine bauxite_mine lead_mine uranium_mine farm
          oil_refinery steel_mill aluminum_refinery munitions_factory
          police_station hospital recycling_center subway supermarket bank shopping_mall stadium
          barracks factory hangar drydock
        }
      }
    }
  }
`;

async function getNation(nationId) {
  const data = await queryPNW(NATION_QUERY, { id: [nationId] });
  const nation = data?.nations?.data?.[0];
  if (!nation) throw new Error(`No nation found with ID ${nationId}. Double-check the ID.`);
  nation.cities = [...nation.cities].sort((a, b) => Number(a.id) - Number(b.id));
  if (nation.alliance_id && Number(nation.alliance_id) !== 0) {
    try { const ai = await getAllianceColor(nation.alliance_id); nation._ownAllianceColor = ai ? ai.color : null; }
    catch { nation._ownAllianceColor = null; }
  }
  return nation;
}

const ALLIANCE_NATIONS_QUERY = `
  query GetAllianceNations($allianceId: [Int], $page: Int) {
    nations(alliance_id: $allianceId, first: 50, page: $page) {
      paginatorInfo { hasMorePages currentPage }
      data {
        id nation_name leader_name date continent
        alliance_id alliance_seniority alliance_position color score num_cities
        last_active vacation_mode_turns soldiers tanks aircraft ships
        green_technologies mass_irrigation recycling_initiative activity_center
        center_for_civil_engineering arable_land_agency research_and_development_center
        projects wars_won wars_lost discord discord_id spies central_intelligence_agency
        turns_since_last_city turns_since_last_project
        money food coal oil uranium lead iron bauxite gasoline munitions steel aluminum
        offensive_wars { id turnsleft att_points }
        defensive_wars { id turnsleft }
        cities {
          id name infrastructure land powered
          coal_power oil_power nuclear_power wind_power
          coal_mine oil_well iron_mine bauxite_mine lead_mine uranium_mine farm
          oil_refinery steel_mill aluminum_refinery munitions_factory
          police_station hospital recycling_center subway supermarket bank shopping_mall stadium
          barracks factory hangar drydock
        }
      }
    }
  }
`;

async function getAllianceNations(allianceId) {
  const allNations = [];
  let page = 1, hasMorePages = true;
  while (hasMorePages) {
    const data = await queryPNW(ALLIANCE_NATIONS_QUERY, { allianceId: [allianceId], page });
    const result = data?.nations;
    if (!result) break;
    for (const nation of result.data) {
      nation.cities = [...nation.cities].sort((a, b) => Number(a.id) - Number(b.id));
      allNations.push(nation);
    }
    hasMorePages = result.paginatorInfo?.hasMorePages ?? false;
    page += 1;
  }
  const members = allNations.filter((n) => (n.alliance_position || "").toUpperCase() !== "APPLICANT");
  try { const ai = await getAllianceColor(allianceId); const colour = ai ? ai.color : null; for (const n of members) n._ownAllianceColor = colour; }
  catch { for (const n of members) n._ownAllianceColor = null; }
  return { members, applicantCount: allNations.length - members.length, totalFetched: allNations.length };
}

const NATION_BY_NAME_QUERY = `query FindNationByName($name: [String]) { nations(nation_name: $name, first: 5) { data { id nation_name } } }`;
const TITLE_CASE_MINOR_WORDS = new Set(["a","an","the","of","and","or","but","nor","in","on","at","to","for","by","with"]);

function titleCase(text) {
  return text.toLowerCase().split(" ").map((w, i) => {
    if (!w.length) return w;
    if (i > 0 && TITLE_CASE_MINOR_WORDS.has(w)) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).join(" ");
}

async function findNationIdByName(name) {
  const variants = [...new Set([name, name.toUpperCase(), name.toLowerCase(), titleCase(name)])];
  for (const v of variants) {
    const data = await queryPNW(NATION_BY_NAME_QUERY, { name: [v] });
    const match = data?.nations?.data?.[0];
    if (match) return Number(match.id);
  }
  return null;
}

async function resolveNationId(input) {
  const trimmed = String(input).trim();
  const linkMatch = trimmed.match(/id=(\d+)/);
  if (linkMatch) return Number(linkMatch[1]);
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const id = await findNationIdByName(trimmed);
  if (!id) throw new Error(`Couldn't find a nation named "${trimmed}". Check the spelling/capitalization, or try their nation ID or profile link instead.`);
  return id;
}

function isActiveMember(nation) { return !(nation.vacation_mode_turns > 0); }

async function verifyPersonalApiKey(apiKey) {
  const response = await fetch(`${PNW_API_URL}?api_key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ nations(first: 1) { data { id } } }" })
  });
  const json = await response.json();
  if (json.errors && json.errors.length > 0) throw new Error(json.errors.map((e) => e.message).join(" | "));
  return true;
}

async function getAllianceName(allianceId) {
  const data = await queryPNW(`query GetAllianceName($id: [Int]) { alliances(id: $id, first: 1) { data { id name } } }`, { id: [allianceId] });
  const alliance = data?.alliances?.data?.[0];
  return alliance ? alliance.name : `Alliance ${allianceId}`;
}

async function getAllianceColor(allianceId) {
  if (!allianceId) return null;
  const data = await queryPNW(`query GetAllianceColor($id: [Int]) { alliances(id: $id, first: 1) { data { id name color } } }`, { id: [allianceId] });
  const alliance = data?.alliances?.data?.[0];
  return alliance ? { name: alliance.name, color: alliance.color } : null;
}

async function findAllianceIdByName(name) {
  const variants = [...new Set([name, name.toUpperCase(), name.toLowerCase(), titleCase(name)])];
  for (const v of variants) {
    const data = await queryPNW(`query FindAllianceByName($name: [String]) { alliances(name: $name, first: 5) { data { id name } } }`, { name: [v] });
    const match = data?.alliances?.data?.[0];
    if (match) return Number(match.id);
  }
  return null;
}

async function resolveAllianceId(input) {
  const trimmed = String(input).trim();
  const linkMatch = trimmed.match(/id=(\d+)/);
  if (linkMatch) return Number(linkMatch[1]);
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const id = await findAllianceIdByName(trimmed);
  if (!id) throw new Error(`Couldn't find an alliance named "${trimmed}". Check the spelling, or try the alliance ID or page link instead.`);
  return id;
}


// TEMPORARY — used only by /api_test to check for colour change timer field.
const NATION_TEST_COLOUR_QUERY = `
  query GetNationColourTest($id: [Int]) {
    nations(id: $id, first: 1) {
      data {
        id
        nation_name
        color
        turns_since_last_city
        turns_since_last_project
        turns_since_last_color
        color_turns
        last_color_change
      }
    }
  }
`;

async function getNationTestColour(nationId) {
  const data = await queryPNW(NATION_TEST_COLOUR_QUERY, { id: [nationId] });
  const nation = data?.nations?.data?.[0];
  if (!nation) throw new Error(`No nation found with ID ${nationId}.`);
  return nation;
}

module.exports = {
  queryPNW, getNation, getAllianceNations, resolveNationId,
  isActiveMember, verifyPersonalApiKey, getAllianceName,
  getAllianceColor, resolveAllianceId, getNationTestColour
};
