// buildsProjects.js
//
// Checks 4 through 11 from the spec (Section 7, Builds & Projects).
// Check 4 (MMR) now uses a flexible slot-based system:
//   - 5 hangars mandatory per city
//   - Total military slots must meet the configured minimum for the tier
//   - Remaining slots freely distributed across barracks/factory/drydock

const { check4 } = require("./mmrCheck");

const BUILDING_FIELDS = [
  "coal_power", "oil_power", "nuclear_power", "wind_power",
  "coal_mine", "oil_well", "iron_mine", "bauxite_mine", "lead_mine", "uranium_mine", "farm",
  "oil_refinery", "steel_mill", "aluminum_refinery", "munitions_factory",
  "police_station", "hospital", "recycling_center", "subway",
  "supermarket", "bank", "shopping_mall", "stadium",
  "barracks", "factory", "hangar", "drydock"
];

function totalBuilt(city) {
  return BUILDING_FIELDS.reduce((sum, field) => sum + (city[field] || 0), 0);
}

const checks = [
  // Check 4: new slot-based MMR with mandatory 5 hangars
  check4,

  {
    key: "check5_free_slots",
    label: "No Free Building Slots",
    recommendation: "Build something in every empty slot in the listed cities (50 infrastructure = 1 slot).",
    run(nation) {
      const violations = [];
      nation.cities.forEach((city) => {
        const totalSlots = Math.floor(city.infrastructure / 50);
        const built = totalBuilt(city);
        if (built < totalSlots) {
          violations.push(`${city.name}: ${built}/${totalSlots} slots used`);
        }
      });
      return {
        passed: violations.length === 0,
        detail: violations.length === 0 ? "No free building slots found." : violations.join("; ")
      };
    }
  },

  {
    key: "check6_farm_restriction",
    label: "Farm Restriction",
    recommendation: "Sell farms in the listed cities, or get Green Technologies, Mass Irrigation, and Recycling Initiative.",
    run(nation) {
      const allowedToFarm = nation.green_technologies && nation.mass_irrigation && nation.recycling_initiative;
      if (allowedToFarm) {
        return { passed: true, detail: "Nation has all 3 required projects — farms are allowed." };
      }
      const violations = nation.cities.filter((c) => c.farm > 0).map((c) => `${c.name}: ${c.farm} farm(s)`);
      return {
        passed: violations.length === 0,
        detail:
          violations.length === 0
            ? "Nation lacks the required projects, but correctly has no farms."
            : `Nation lacks Green Technologies/Mass Irrigation/Recycling Initiative but has farms: ${violations.join("; ")}`
      };
    }
  },

  {
    key: "check7_activity_center",
    label: "Activity Center",
    recommendation: "Build the Activity Center project.",
    run(nation) {
      if (nation.num_cities >= 21) {
        return { passed: true, detail: "Nation is C21+, Activity Center not required." };
      }
      return {
        passed: !!nation.activity_center,
        detail: nation.activity_center ? "Activity Center is built." : "Activity Center is missing."
      };
    }
  },

  {
    key: "check8_civil_arable",
    label: "Civil Engineering & Arable Land",
    recommendation: "Build the Center for Civil Engineering and Arable Land Agency projects.",
    run(nation) {
      if (nation.num_cities < 10 || nation.num_cities > 20) {
        return { passed: true, detail: "Only required for nations between C10 and C20." };
      }
      const missing = [];
      if (!nation.center_for_civil_engineering) missing.push("Center for Civil Engineering");
      if (!nation.arable_land_agency) missing.push("Arable Land Agency");
      return {
        passed: missing.length === 0,
        detail: missing.length === 0 ? "Both projects are built." : `Missing: ${missing.join(", ")}`
      };
    }
  },

  {
    key: "check9_nuclear_power",
    label: "Nuclear Power Requirement",
    recommendation: "Build a Nuclear Power Plant in the listed cities.",
    run(nation) {
      const violations = nation.cities.filter((c) => c.nuclear_power < 1).map((c) => c.name);
      return {
        passed: violations.length === 0,
        detail: violations.length === 0 ? "Every city has a Nuclear Power Plant." : `Missing in: ${violations.join(", ")}`
      };
    }
  },

  {
    key: "check10_excess_nuclear",
    label: "No Excess Nuclear Plants",
    recommendation: "Sell the extra Nuclear Power Plant(s) in the listed cities.",
    run(nation) {
      const violations = nation.cities
        .filter((c) => c.infrastructure <= 2000 && c.nuclear_power > 1)
        .map((c) => `${c.name}: ${c.nuclear_power} plants`);
      return {
        passed: violations.length === 0,
        detail: violations.length === 0 ? "No excess Nuclear Plants found." : violations.join("; ")
      };
    }
  },

  {
    key: "check11_project_opportunity",
    label: "Project Opportunity",
    recommendation: "Build a National Project — your nation has at least one unused, guaranteed project slot.",
    run(nation) {
      const totalInfra = nation.cities.reduce((sum, c) => sum + c.infrastructure, 0);
      const combinedWars = (nation.wars_won || 0) + (nation.wars_lost || 0);

      let guaranteedSlots = 1 + Math.floor(totalInfra / 5000);
      if (combinedWars >= 100) guaranteedSlots += 1;
      if (nation.research_and_development_center) guaranteedSlots += 1;

      const passed = nation.projects >= guaranteedSlots;

      return {
        passed,
        detail: passed
          ? `${nation.projects} project(s) built, meets the guaranteed minimum of ${guaranteedSlots}.`
          : `Only ${nation.projects} project(s) built, but at least ${guaranteedSlots} guaranteed slot(s) should be filled.`
      };
    }
  }
];

module.exports = { checks, BUILDING_FIELDS, totalBuilt };
