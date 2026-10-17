// pnw.js
//
// This file is our "phone line" to the Politics & War game servers.
// Politics & War uses a system called GraphQL — instead of many different
// web addresses for different data, there's ONE address, and you send it
// a "query" describing exactly what fields you want back.
//
// Every field below has been tested against the live API and confirmed
// to work (last confirmed 2026-06-21). If PnW ever renames a field, the
// API's error message will say exactly which one — easy to spot and fix.

// Using Node's own built-in fetch (Node 18+) instead of the node-fetch
// package — it's more reliable on Windows for back-to-back HTTPS requests.

const PNW_API_URL = "https://api.politicsandwar.com/graphql";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryPNW(query, variables = {}, attempt = 1) {
  const apiKey = process.env.PNW_API_KEY;
  if (!apiKey) {
    throw new Error("Missing PNW_API_KEY in your .env file.");
  }

  let response;
  try {
    response = await fetch(`${PNW_API_URL}?api_key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables })
    });
  } catch (networkError) {
    if (attempt < 3) {
      await sleep(attempt * 1000);
      return queryPNW(query, variables, attempt + 1);
    }
    throw new Error(`Network error talking to the PnW API after ${attempt} attempts: ${networkError.message}`);
  }

  const json = await response.json();

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join(" | ");
    throw new Error(`PnW API error: ${messages}`);
  }

  return json.data;
}

const NATION_QUERY = `
  query GetNation($id: [Int]) {
    nations(id: $id, first: 1) {
      data {
        id
        nation_name
        leader_name
        date
        continent
        alliance_id
        alliance_seniority
        alliance_position
        color
        score
        num_cities
        last_active
        vacation_mode_turns
        soldiers
        tanks
        aircraft
        ships
        green_technologies
        mass_irrigation
        recycling_initiative
        activity_center
        center_for_civil_engineering
        arable_land_agency
        research_and_development_center
        projects
        wars_won
        wars_lost
        discord
        discord_id
        spies
        central_intelligence_agency
        money
        food
        coal
        oil
        uranium
        lead
        iron
        bauxite
        gasoline
        munitions
        steel
        aluminum
        offensive_wars {
          id
          turnsleft
          att_points
        }
        defensive_wars {
          id
          turnsleft
        }
        cities {
          id
          name
          infrastructure
          land
          powered
          coal_power
          oil_power
          nuclear_power
          wind_power
          coal_mine
          oil_well
          iron_mine
          bauxite_mine
          lead_mine
          uranium_mine
          farm
          oil_refinery
          steel_mill
          aluminum_refinery
          munitions_factory
          police_station
          hospital
          recycling_center
          subway
          supermarket
          bank
          shopping_mall
          stadium
          barracks
          factory
          hangar
          drydock
        }
      }
    }
  }
`;

async function getNation(nationId) {
  const data = await queryPNW(NATION_QUERY, { id: [nationId] });
  const nation = data?.nations?.data?.[0];
  if (!nation) {
    throw new Error(`No nation found with ID ${nationId}. Double-check the ID.`);
  }

  nation.cities = [...nation.cities].sort((a, b) => Number(a.id) - Number(b.id));

  if (nation.alliance_id && Number(nation.alliance_id) !== 0) {
    try {
      const allianceInfo = await getAllianceColor(nation.alliance_id);
      nation._ownAllianceColor = allianceInfo ? allianceInfo.color : null;
    } catch (error) {
      nation._ownAllianceColor = null;
    }
  }

  return nation;
}

const ALLIANCE_NATIONS_QUERY = `
  query GetAllianceNations($allianceId: [Int], $page: Int) {
    nations(alliance_id: $allianceId, first: 50, page: $page) {
      paginatorInfo {
        hasMorePages
        currentPage
      }
      data {
        id
        nation_name
        leader_name
        date
        continent
        alliance_id
        alliance_seniority
        alliance_position
        color
        score
        num_cities
        last_active
        vacation_mode_turns
        soldiers
        tanks
        aircraft
        ships
        green_technologies
        mass_irrigation
        recycling_initiative
        activity_center
        center_for_civil_engineering
        arable_land_agency
        research_and_development_center
        projects
        wars_won
        wars_lost
        discord
        discord_id
        spies
        central_intelligence_agency
        money
        food
        coal
        oil
        uranium
        lead
        iron
        bauxite
        gasoline
        munitions
        steel
        aluminum
        offensive_wars {
          id
          turnsleft
          att_points
        }
        defensive_wars {
          id
          turnsleft
        }
        cities {
          id
          name
          infrastructure
          land
          powered
          coal_power
          oil_power
          nuclear_power
          wind_power
          coal_mine
          oil_well
          iron_mine
          bauxite_mine
          lead_mine
          uranium_mine
          farm
          oil_refinery
          steel_mill
          aluminum_refinery
          munitions_factory
          police_station
          hospital
          recycling_center
          subway
          supermarket
          bank
          shopping_mall
          stadium
          barracks
          factory
          hangar
          drydock
        }
      }
    }
  }
`;

async function getAllianceNations(allianceId) {
  const allNations = [];
  let page = 1;
  let hasMorePages = true;

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

  try {
    const allianceInfo = await getAllianceColor(allianceId);
    const colour = allianceInfo ? allianceInfo.color : null;
    for (const nation of members) nation._ownAllianceColor = colour;
  } catch (error) {
    for (const nation of members) nation._ownAllianceColor = null;
  }

  return { members, applicantCount: allNations.length - members.length, totalFetched: allNations.length };
}

const NATION_BY_NAME_QUERY = `
  query FindNationByName($name: [String]) {
    nations(nation_name: $name, first: 5) {
      data {
        id
        nation_name
      }
    }
  }
`;

const TITLE_CASE_MINOR_WORDS = new Set([
  "a", "an", "the", "of", "and", "or", "but", "nor", "in", "on", "at", "to", "for", "by", "with"
]);

function titleCase(text) {
  const words = text.toLowerCase().split(" ");
  return words
    .map((word, idx) => {
      if (word.length === 0) return word;
      if (idx > 0 && TITLE_CASE_MINOR_WORDS.has(word)) return word;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

async function findNationIdByName(name) {
  const variants = [...new Set([name, name.toUpperCase(), name.toLowerCase(), titleCase(name)])];
  for (const variant of variants) {
    const data = await queryPNW(NATION_BY_NAME_QUERY, { name: [variant] });
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
  if (!id) {
    throw new Error(
      `Couldn't find a nation named "${trimmed}". Check the spelling/capitalization, or try their nation ID or profile link instead.`
    );
  }
  return id;
}

function isActiveMember(nation) {
  return !(nation.vacation_mode_turns > 0);
}

async function verifyPersonalApiKey(apiKey) {
  const response = await fetch(`${PNW_API_URL}?api_key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ nations(first: 1) { data { id } } }" })
  });
  const json = await response.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((e) => e.message).join(" | "));
  }
  return true;
}

async function getAllianceName(allianceId) {
  const data = await queryPNW(`query GetAllianceName($id: [Int]) { alliances(id: $id, first: 1) { data { id name } } }`, {
    id: [allianceId]
  });
  const alliance = data?.alliances?.data?.[0];
  return alliance ? alliance.name : `Alliance ${allianceId}`;
}

async function getAllianceColor(allianceId) {
  if (!allianceId) return null;
  const data = await queryPNW(`query GetAllianceColor($id: [Int]) { alliances(id: $id, first: 1) { data { id name color } } }`, {
    id: [allianceId]
  });
  const alliance = data?.alliances?.data?.[0];
  return alliance ? { name: alliance.name, color: alliance.color } : null;
}

async function findAllianceIdByName(name) {
  const variants = [...new Set([name, name.toUpperCase(), name.toLowerCase(), titleCase(name)])];
  for (const variant of variants) {
    const data = await queryPNW(`query FindAllianceByName($name: [String]) { alliances(name: $name, first: 5) { data { id name } } }`, {
      name: [variant]
    });
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
  if (!id) {
    throw new Error(`Couldn't find an alliance named "${trimmed}". Check the spelling, or try the alliance ID or page link instead.`);
  }
  return id;
}

// TEMPORARY — used only by /api_test to check for city/project cooldown fields.
const NATION_TEST_TIMER_QUERY = `
  query GetNationTimerTest($id: [Int]) {
    nations(id: $id, first: 1) {
      data {
        id
        nation_name
        num_cities
        city_timer
        project_timer
        turns_since_last_city
        turns_since_last_project
      }
    }
  }
`;

async function getNationTestTimer(nationId) {
  const data = await queryPNW(NATION_TEST_TIMER_QUERY, { id: [nationId] });
  const nation = data?.nations?.data?.[0];
  if (!nation) throw new Error(`No nation found with ID ${nationId}.`);
  return nation;
}

module.exports = {
  queryPNW,
  getNation,
  getAllianceNations,
  resolveNationId,
  isActiveMember,
  verifyPersonalApiKey,
  getAllianceName,
  getAllianceColor,
  resolveAllianceId,
  getNationTestTimer
};
