// runAudit.js
//
// Shared engine used by every audit command. Runs checks, totals points,
// determines grade, builds the embed, and returns a history record.
//
// Partial-credit scoring: checks that return a numeric `partialScore`
// (0.0–1.0) get that fraction of their max points instead of the binary
// 0-or-max. Checks 4 (MMR), 18 (Military Fill), and 20 (Spy Count) use
// this. All other checks remain binary pass/fail as before.

const { EmbedBuilder } = require("discord.js");
const { getGrade, isPassingGrade } = require("./grading");

function runChecks(nation, checkList, settings) {
  return checkList.map((check) => {
    const result = check.run(nation, settings);
    const maxPoints = settings.scores[check.key] ?? 0;

    // If the check returned a partialScore (0.0–1.0), use proportional
    // points. Otherwise fall back to binary pass/fail as always.
    let earnedPoints;
    if (typeof result.partialScore === "number") {
      const ratio = Math.min(1, Math.max(0, result.partialScore));
      earnedPoints = Math.round(maxPoints * ratio * 100) / 100;
    } else {
      earnedPoints = result.passed ? maxPoints : 0;
    }

    return {
      key: check.key,
      label: check.label,
      recommendation: check.recommendation,
      passed: result.passed,
      detail: result.detail,
      maxPoints,
      earnedPoints
    };
  });
}

function buildReportEmbed(nation, results, settings, reportTitle, options = {}) {
  const maxDetailLength = options.maxDetailLength ?? 1000;

  const maxPossible = results.reduce((sum, r) => sum + r.maxPoints, 0);
  const earned = results.reduce((sum, r) => sum + r.earnedPoints, 0);
  const percent = maxPossible === 0 ? 0 : Math.round((earned / maxPossible) * 1000) / 10;
  const grade = getGrade(percent, settings.gradeThresholds);
  const pass = isPassingGrade(grade);

  const embed = new EmbedBuilder()
    .setTitle(`${reportTitle} — ${nation.nation_name}`)
    .setColor(grade.color)
    .addFields(
      { name: "Cities", value: String(nation.num_cities), inline: true },
      { name: "Score", value: `${percent}% (${earned}/${maxPossible} pts)`, inline: true },
      { name: "Grade", value: `${grade.emoji} ${grade.label}`, inline: true }
    );

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    let fieldText = r.detail;
    if (!r.passed) {
      fieldText += `\n*Recommendation: ${r.recommendation}*`;
    }
    if (fieldText.length > maxDetailLength) fieldText = fieldText.slice(0, maxDetailLength) + "...";

    // Show decimal points when partial credit applies (e.g. 6.30/7 pts)
    const earnedDisplay = Number.isInteger(r.earnedPoints) ? r.earnedPoints : r.earnedPoints.toFixed(2);
    embed.addFields({
      name: `${icon} ${r.label} (${earnedDisplay}/${r.maxPoints} pts)`,
      value: fieldText
    });
  }

  return { embed, percent, pass, grade, earned, maxPossible };
}

function buildHistoryRecord(nation, percent, pass, command, grade) {
  return {
    nationId: Number(nation.id),
    nationName: nation.nation_name,
    date: new Date().toISOString().split("T")[0],
    score: percent,
    pass,
    grade: grade ? grade.label : undefined,
    command
  };
}

module.exports = { runChecks, buildReportEmbed, buildHistoryRecord };
