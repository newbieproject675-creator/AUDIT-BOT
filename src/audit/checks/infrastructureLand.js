// infrastructureLand.js
//
// Checks 1, 2, 3 — Infrastructure & Land.
// Check 1: infra cap based on nation's total city count (configurable per tier)
// Check 2: all cities must have equal infrastructure
// Check 3: land must be within a configurable ratio range of infrastructure
//          (too little = not enough land for the infra; too much = population
//          density problems). Defaults: land must be between 1.0× and 2.0× infra.

function infraCapFor(nationCityCount, infraCapTiers) {
  const caps = infraCapTiers || { c1_c14: 1300, c15_c19: 1500, c20_plus: 2000 };
  if (nationCityCount <= 14) return caps.c1_c14;
  if (nationCityCount <= 19) return caps.c15_c19;
  return caps.c20_plus;
}

const checks = [
  {
    key: "check1_infra_cap",
    label: "Infrastructure Cap",
    recommendation: "Lower infrastructure in the listed cities to stay within the cap for this nation's tier.",
    run(nation, settings) {
      const cap = infraCapFor(nation.num_cities, settings.infraCapTiers);
      const violations = [];
      nation.cities.forEach((city) => {
        if (city.infrastructure > cap + 0.01) {
          violations.push(`${city.name}: ${city.infrastructure} > cap ${cap}`);
        }
      });
      return {
        passed: violations.length === 0,
        detail: violations.length === 0
          ? `All cities within the ${cap} infra cap (${nation.num_cities}-city nation).`
          : violations.join("; ")
      };
    }
  },

  {
    key: "check2_equal_infra",
    label: "Equal Infrastructure",
    recommendation: "Buy or sell infrastructure so every city has the same amount.",
    run(nation) {
      const infraValues = nation.cities.map((c) => c.infrastructure);
      const max = Math.max(...infraValues);
      const min = Math.min(...infraValues);
      const equal = max - min <= 0.01;
      return {
        passed: equal,
        detail: equal
          ? "All cities have equal infrastructure."
          : `Infrastructure ranges from ${min} to ${max} (should all match).`
      };
    }
  },

  {
    key: "check3_land_ratio",
    label: "Land Ratio",
    recommendation: "Adjust land in the listed cities to stay within the configured land-to-infrastructure ratio.",
    run(nation, settings) {
      // Land must be between minRatio and maxRatio times the city's infrastructure.
      // Too little land = not enough for the infrastructure built.
      // Too much land = population density problems.
      const policy = settings.landRatioPolicy || { minRatio: 1.0, maxRatio: 2.0 };
      const { minRatio, maxRatio } = policy;

      const violations = [];
      nation.cities.forEach((city) => {
        const minLand = city.infrastructure * minRatio;
        const maxLand = city.infrastructure * maxRatio;

        if (city.land < minLand - 0.01) {
          violations.push(
            `${city.name}: land ${city.land.toLocaleString()} < min ${minLand.toLocaleString()} (${minRatio}× infra)`
          );
        } else if (city.land > maxLand + 0.01) {
          violations.push(
            `${city.name}: land ${city.land.toLocaleString()} > max ${maxLand.toLocaleString()} (${maxRatio}× infra)`
          );
        }
      });

      return {
        passed: violations.length === 0,
        detail:
          violations.length === 0
            ? `All cities have land within the ${minRatio}×–${maxRatio}× infra range.`
            : violations.join("; ")
      };
    }
  }
];

module.exports = { checks };
