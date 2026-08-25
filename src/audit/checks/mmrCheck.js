// The MMR check now works differently from the original per-building check:
//
// 1. Every city must have EXACTLY 5 hangars — non-negotiable.
// 2. The total of (barracks + factory + hangar + drydock) per city must be
//    >= the configured minimum for the nation's city-count tier.
//
// Members can freely distribute the remaining slots (after the 5 mandatory
// hangars) across barracks, factories, and drydocks however they like —
// as long as the total meets the minimum. This makes the policy flexible
// while keeping aircraft builds strong.
//
// Example for 18-slot minimum:
//   5/5/5/3 = 18 ✅   0/8/5/5 → impossible (max 5 per type)
//   5/5/5/2 = 17 ❌   0/5/5/3 = 13 ❌ (if min is 18)
//   0/13/5/0 → impossible   3/5/5/3 = 16 ❌ (if min is 18)

function mmrTierFor(numCities) {
  if (numCities <= 5) return "C1-C5";
  if (numCities <= 10) return "C6-C10";
  if (numCities <= 15) return "C11-C15";
  if (numCities <= 20) return "C16-C20";
  return "C21+";
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
      return { passed: true, detail: `No MMR configured for tier ${tier} — skipping.` };
    }

    const cityViolations = [];

    for (const city of nation.cities) {
      const hangarViolation = city.hangar !== 5;
      const total = (city.barracks || 0) + (city.factory || 0) + (city.hangar || 0) + (city.drydock || 0);
      const totalViolation = total < minSlots;

      if (hangarViolation || totalViolation) {
        const reasons = [];
        if (hangarViolation) reasons.push(`hangars: ${city.hangar}/5 required`);
        if (totalViolation) reasons.push(`total: ${total}/${minSlots} slots`);
        cityViolations.push(`${city.name}: ${reasons.join(", ")}`);
      }
    }

    return {
      passed: cityViolations.length === 0,
      detail:
        cityViolations.length === 0
          ? `All cities meet the ${minSlots}-slot MMR for tier ${tier} (5 hangars + ${minSlots - 5} free).`
          : `Tier ${tier} (min ${minSlots} slots, 5 hangars mandatory): ` + cityViolations.join("; ")
    };
  }
};

module.exports = { check4, mmrTierFor };
