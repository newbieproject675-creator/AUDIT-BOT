// mmrCheck.js — Check 4: MMR with proportional/partial-credit scoring.
//
// A city is compliant if it has exactly 5 hangars AND total military
// buildings (barracks + factory + hangar + drydock) >= the configured
// minimum for the tier.
//
// Scoring: proportional to compliant cities.
//   partialScore = compliant cities / total cities
// So 19/20 compliant cities earns 95% of max points, not zero.

function mmrTierFor(numCities) {
  if (numCities <= 5) return "C1-C5";
  if (numCities <= 10) return "C6-C10";
  if (numCities <= 15) return "C11-C15";
  if (numCities <= 20) return "C16-C20";
  return "C21+";
}

function isCityCompliant(city, minSlots) {
  const hangarOk = city.hangar === 5;
  const total = (city.barracks || 0) + (city.factory || 0) + (city.hangar || 0) + (city.drydock || 0);
  return hangarOk && total >= minSlots;
}

const check4 = {
  key: "check4_mmr",
  label: "MMR Requirement",
  recommendation:
    "Each city must have exactly 5 hangars, and total military buildings must meet the minimum for your tier.",
  run(nation, settings) {
    const tier = mmrTierFor(nation.num_cities);
    const tierConfig = settings.mmr[tier];
    const minSlots = tierConfig?.minSlots;

    if (minSlots === undefined || minSlots === null) {
      return { passed: true, partialScore: 1, detail: `No MMR configured for tier ${tier} — skipping.` };
    }

    const totalCities = nation.cities.length;
    if (totalCities === 0) {
      return { passed: true, partialScore: 1, detail: "No cities to check." };
    }

    const violations = [];
    let compliantCount = 0;

    for (const city of nation.cities) {
      if (isCityCompliant(city, minSlots)) {
        compliantCount += 1;
      } else {
        const hangarViolation = city.hangar !== 5;
        const total = (city.barracks || 0) + (city.factory || 0) + (city.hangar || 0) + (city.drydock || 0);
        const totalViolation = total < minSlots;
        const reasons = [];
        if (hangarViolation) reasons.push(`hangars: ${city.hangar}/5 required`);
        if (totalViolation) reasons.push(`total: ${total}/${minSlots} slots`);
        violations.push(`${city.name}: ${reasons.join(", ")}`);
      }
    }

    const partialScore = compliantCount / totalCities;
    const passed = compliantCount === totalCities;

    const detail = passed
      ? `All ${totalCities} cities meet the ${minSlots}-slot MMR for tier ${tier}.`
      : `${compliantCount}/${totalCities} cities compliant (tier ${tier}, min ${minSlots} slots, 5 hangars mandatory): ` +
        violations.join("; ");

    return { passed, partialScore, detail };
  }
};

module.exports = { check4, mmrTierFor };
