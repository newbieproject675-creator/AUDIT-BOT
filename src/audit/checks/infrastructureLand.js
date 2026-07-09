// infrastructureLand.js
//
// Checks 1, 2, 3 from the spec (Section 7, Infrastructure & Land).
// Check 1's infrastructure caps are configurable via /set_infra_cap
// and are based on the nation's total city count.

function infraCapFor(nationCityCount, infraCapTiers) {
  // Uses the nation's total city count to determine the cap.
  const caps = infraCapTiers || {
    c1_c14: 1300,
    c15_c19: 1500,
    c20_plus: 2000
  };

  if (nationCityCount <= 14) return caps.c1_c14;
  if (nationCityCount <= 19) return caps.c15_c19;
  return caps.c20_plus;
}

const checks = [
  {
    key: "check1_infra_cap",
    label: "Infrastructure Cap",
    recommendation: "Lower infrastructure in the listed cities to stay within the cap for your nation's city tier.",
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
    recommendation: "Buy or sell land in the listed cities so Land = Infrastructure + 500.",
    run(nation) {
      const violations = [];

      nation.cities.forEach((city) => {
        const expectedLand = city.infrastructure + 500;

        if (Math.abs(city.land - expectedLand) > 0.01) {
          violations.push(
            `${city.name}: land ${city.land}, expected ${expectedLand.toFixed(2)}`
          );
        }
      });

      return {
        passed: violations.length === 0,
        detail: violations.length === 0
          ? "All cities meet the land ratio."
          : violations.join("; ")
      };
    }
  }
];

module.exports = { checks };