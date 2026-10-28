// others.js
//
// Checks 12, 13, 14, 16, 17, 18, 19, 20.
//
// Partial-credit scoring (partialScore 0.0–1.0) applies to:
//   Check 18 (Military Fill) — average fill rate across 4 branches
//   Check 20 (Spy Count) — ratio of actual to required spies
// All other checks remain binary pass/fail.
//
// Check 14 (Resource Control) now has a three-zone warchest system:
//   EXCESS:  nation holds more than target (configured max) → fail, deposit advised
//   PASS:    nation holds between target÷underDivisor and target
//   LOW:     nation holds less than target÷underDivisor → fail, build up warchest
// Both thresholds are configurable via /set_warchest_policy.

const RESOURCE_FIELDS = [
  "money", "food", "coal", "oil", "uranium", "lead", "iron", "bauxite",
  "gasoline", "munitions", "steel", "aluminum"
];

const DAILY_UPKEEP = { soldiers: 1.25, tanks: 50, aircraft: 500, ships: 3375 };

const CAPACITY_PER_BUILDING = { barracks: 3000, factory: 250, hangar: 15, drydock: 5 };

function activeWarCount(wars) {
  return wars.filter((w) => w.turnsleft > 0).length;
}

function isHidden(value) {
  return value === -1 || value === null || value === undefined;
}

const checks = [
  {
    key: "check12_colour_bloc",
    label: "Alliance Colour Bloc",
    recommendation: "Change your nation's color to match your alliance's bloc color.",
    run(nation, settings) {
      const isOwnAlliance = String(nation.alliance_id) === String(settings.alliance.id);
      const allianceColourRaw = isOwnAlliance ? settings.alliance.colour : nation._ownAllianceColor;
      const allianceColour = (allianceColourRaw || "").toLowerCase();
      const nationColour = (nation.color || "").toLowerCase();
      if (!allianceColour) return { passed: true, detail: "No alliance colour to compare against — skipping." };
      if (nationColour === "beige") return { passed: true, detail: "Nation is beige (post-war protection) — exempt until it expires." };
      const passed = nationColour === allianceColour;
      return {
        passed,
        detail: passed ? `Nation is on bloc colour (${nation.color}).` : `Nation is ${nation.color}, expected ${allianceColourRaw}.`
      };
    }
  },
  {
    key: "check13_raid_requirement",
    label: "Raid Requirement",
    recommendation: "Declare offensive wars until you meet your alliance's raid requirement.",
    run(nation, settings) {
      const { maxCityTier, requiredOffensiveWars } = settings.raidPolicy;
      if (nation.num_cities > maxCityTier) {
        return { passed: true, detail: `Nations above ${maxCityTier} cities are exempt from the raid requirement.` };
      }
      const activeOffensive = activeWarCount(nation.offensive_wars);
      const passed = activeOffensive >= requiredOffensiveWars;
      return { passed, detail: `${activeOffensive}/${requiredOffensiveWars} active offensive wars.` };
    }
  },
  {
    key: "check14_resource_control",
    label: "Resource Control",
    recommendation: "Adjust resources to stay within your warchest policy.",
    run(nation, settings) {
      const policy = { ...settings.warchestPolicy, ...(settings.memberWarchestOverrides[String(nation.id)] || {}) };

      const hiddenResources = RESOURCE_FIELDS.filter((r) => isHidden(nation[r]));
      if (hiddenResources.length === RESOURCE_FIELDS.length) {
        return { passed: true, detail: "This nation has hidden their resources — can't check this." };
      }

      // Configurable thresholds — how far below or above target triggers a fail.
      // underDivisor: target/N is the low floor (default 4 = 4x below target fails)
      // overMultiplier is removed — anything above target now fails immediately.
      const underDivisor = settings.warchestUnderDivisor ?? 4;

      const excessViolations = [];   // holding MORE than target → deposit in bank
      const lowViolations = [];      // holding LESS than target÷underDivisor → dangerously low

      for (const resource of RESOURCE_FIELDS) {
        if (isHidden(nation[resource])) continue;
        const perCity = policy[resource];
        if (perCity === undefined || perCity === null) continue;

        const target = perCity * nation.num_cities;           // the maximum allowed
        const floor = target / underDivisor;                  // the minimum acceptable

        const actual = nation[resource];

        if (actual > target) {
          excessViolations.push(
            `${resource}: ${actual.toLocaleString()} > max ${target.toLocaleString()} — deposit excess in alliance bank`
          );
        } else if (actual < floor) {
          lowViolations.push(
            `${resource}: ${actual.toLocaleString()} < min ${Math.floor(floor).toLocaleString()} (target ${target.toLocaleString()} ÷ ${underDivisor})`
          );
        }
      }

      const allViolations = [...excessViolations, ...lowViolations];
      return {
        passed: allViolations.length === 0,
        detail: allViolations.length === 0
          ? "All tracked resources within warchest policy."
          : allViolations.join("; ")
      };
    }
  },
  {
    key: "check16_activity",
    label: "Activity Check",
    recommendation: "Log in and take an action in-game.",
    run(nation, settings) {
      const lastActive = new Date(nation.last_active);
      const hoursSince = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
      const limit = settings.activityLimitHours;
      const passed = hoursSince <= limit;
      return { passed, detail: `Last active ${hoursSince.toFixed(1)} hours ago (limit: ${limit} hours).` };
    }
  },
  {
    key: "check17_power_upkeep",
    label: "Power & Upkeep",
    recommendation: "Power the listed cities, and/or earn enough money to cover at least 1 day of military upkeep.",
    run(nation) {
      const unpowered = nation.cities.filter((c) => !c.powered).map((c) => c.name);
      const dailyCost =
        nation.soldiers * DAILY_UPKEEP.soldiers +
        nation.tanks * DAILY_UPKEEP.tanks +
        nation.aircraft * DAILY_UPKEEP.aircraft +
        nation.ships * DAILY_UPKEEP.ships;
      const moneyHidden = isHidden(nation.money);
      const hasUpkeep = moneyHidden || nation.money >= dailyCost;
      const problems = [];
      if (unpowered.length > 0) problems.push(`Unpowered: ${unpowered.join(", ")}`);
      if (!hasUpkeep) problems.push(`Money $${nation.money.toLocaleString()} < 1 day upkeep $${dailyCost.toLocaleString()}`);
      return {
        passed: problems.length === 0,
        detail: problems.length === 0
          ? `All cities powered${moneyHidden ? " (money hidden, upkeep not checked)" : ", at least 1 day of upkeep available"}.`
          : problems.join("; ")
      };
    }
  },
  {
    key: "check18_military_fill",
    label: "Military Fill Check",
    recommendation: "Train more units in the listed categories to use your full capacity.",
    run(nation) {
      const totals = { barracks: 0, factory: 0, hangar: 0, drydock: 0 };
      for (const city of nation.cities) {
        totals.barracks += city.barracks || 0;
        totals.factory += city.factory || 0;
        totals.hangar += city.hangar || 0;
        totals.drydock += city.drydock || 0;
      }
      const capacity = {
        soldiers: totals.barracks * CAPACITY_PER_BUILDING.barracks,
        tanks: totals.factory * CAPACITY_PER_BUILDING.factory,
        aircraft: totals.hangar * CAPACITY_PER_BUILDING.hangar,
        ships: totals.drydock * CAPACITY_PER_BUILDING.drydock
      };
      const fillRate = (current, max) => max === 0 ? 1 : Math.min(1, current / max);
      const rates = {
        soldiers: fillRate(nation.soldiers, capacity.soldiers),
        tanks: fillRate(nation.tanks, capacity.tanks),
        aircraft: fillRate(nation.aircraft, capacity.aircraft),
        ships: fillRate(nation.ships, capacity.ships)
      };
      const avgRate = (rates.soldiers + rates.tanks + rates.aircraft + rates.ships) / 4;
      const passed = avgRate >= 0.999;
      const pct = (r) => (r * 100).toFixed(1);
      const detail =
        `Soldiers ${pct(rates.soldiers)}%, Tanks ${pct(rates.tanks)}%, ` +
        `Aircraft ${pct(rates.aircraft)}%, Ships ${pct(rates.ships)}%` +
        (passed ? "" : ` (avg ${pct(avgRate)}%)`);
      return { passed, partialScore: avgRate, detail };
    }
  },
  {
    key: "check19_map_usage",
    label: "MAP Usage",
    recommendation: "Use your Military Action Points (MAP) to launch attacks instead of letting them sit at the cap.",
    run(nation) {
      const fullWars = nation.offensive_wars
        .filter((w) => w.turnsleft > 0 && w.att_points >= 12)
        .map((w) => `War #${w.id} (${w.att_points}/12 MAP)`);
      return {
        passed: fullWars.length === 0,
        detail: fullWars.length === 0 ? "No active offensive wars have MAP sitting at the cap." : fullWars.join("; ")
      };
    }
  },
  {
    key: "check20_spy_count",
    label: "Spy Count",
    recommendation: "Buy spies daily until you're back at your nation's spy cap.",
    run(nation) {
      const cap = nation.central_intelligence_agency ? 60 : 50;
      const ratio = Math.min(1, nation.spies / cap);
      const passed = nation.spies >= cap;
      return {
        passed,
        partialScore: ratio,
        detail: passed
          ? `Spies are full (${nation.spies}/${cap}).`
          : `Spies are below cap (${nation.spies}/${cap}).`
      };
    }
  }
];

module.exports = { checks };
