// iaAlerts.js
//
// Analyses audit history for each member and fires a recommendation to the
// configured IA channel when a nation has been consistently failing above
// the configured failure rate threshold within the configured window.
//
// Key accuracy safeguards:
//   - Requires a minimum number of audits in the window before recommending.
//     A nation with only 1 or 2 audit records can't be recommended — not
//     enough data to be sure.
//   - Uses a rate (e.g. 75% of audits failing) rather than a raw count, so
//     a nation that improved recently doesn't get flagged.
//   - Per-nation cooldown prevents the same nation being pinged repeatedly
//     while they're being handled by IA.

const { EmbedBuilder } = require("discord.js");
const { isPassingGrade } = require("./grading");
const { saveSettings } = require("../db");

function isFailing(record, settings) {
  // Uses the same grade system the rest of the bot uses — "Failing" is
  // whatever grade falls below the configured average threshold.
  return !isPassingGrade(record.grade);
}

function getWindowStart(windowDays) {
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
}

function isOnCooldown(settings, nationId) {
  const lastAlerted = settings.iaAlerts.lastAlertedNations?.[String(nationId)];
  if (!lastAlerted) return false;
  const cooldownMs = settings.iaAlerts.cooldownDays * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(lastAlerted).getTime() < cooldownMs;
}

function analyseNation(nationId, nationName, auditHistory, settings) {
  const config = settings.iaAlerts;
  const windowStart = getWindowStart(config.windowDays);

  // Only look at audits within the configured window
  const recentAudits = auditHistory.filter(
    (r) => String(r.nationId) === String(nationId) && new Date(r.date) >= windowStart
  );

  if (recentAudits.length < config.minAudits) {
    return { recommend: false, reason: "insufficient_data", auditCount: recentAudits.length };
  }

  const failingAudits = recentAudits.filter((r) => isFailing(r, settings));
  const failureRate = Math.round((failingAudits.length / recentAudits.length) * 100);

  if (failureRate < config.failureRateThreshold) {
    return { recommend: false, reason: "below_threshold", failureRate, auditCount: recentAudits.length };
  }

  // Build a brief trend summary showing the last 10 results
  const recent10 = recentAudits.slice(-10).map((r) => (isFailing(r, settings) ? "❌" : "✅")).join(" ");
  const scores = recentAudits.map((r) => r.score ?? 0);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const lowestScore = Math.min(...scores);

  return {
    recommend: true,
    failureRate,
    auditCount: recentAudits.length,
    failingCount: failingAudits.length,
    avgScore,
    lowestScore,
    recent10,
    windowDays: config.windowDays
  };
}

async function runIaAlertsForGuild(client, guild, settings, guildId) {
  const config = settings.iaAlerts;
  const stats = { checked: 0, recommended: 0, skippedCooldown: 0, skippedData: 0 };

  if (!config.iaChannelId || !config.iaRoleId) return stats;

  const channel = guild.channels.cache.get(config.iaChannelId);
  if (!channel) return stats;

  // Get unique nation IDs from history within the window
  const windowStart = getWindowStart(config.windowDays);
  const recentHistory = (settings.auditHistory || []).filter(
    (r) => new Date(r.date) >= windowStart
  );

  const nationMap = new Map();
  for (const record of recentHistory) {
    if (!nationMap.has(String(record.nationId))) {
      nationMap.set(String(record.nationId), record.nationName);
    }
  }

  stats.checked = nationMap.size;

  for (const [nationId, nationName] of nationMap.entries()) {
    if (isOnCooldown(settings, nationId)) {
      stats.skippedCooldown += 1;
      continue;
    }

    const analysis = analyseNation(nationId, nationName, settings.auditHistory || [], settings);

    if (!analysis.recommend) {
      if (analysis.reason === "insufficient_data") stats.skippedData += 1;
      continue;
    }

    // Fire the alert
    const embed = new EmbedBuilder()
      .setTitle(`🚨 IA Removal Recommendation — ${nationName}`)
      .setColor(0xe74c3c)
      .setDescription(
        `**Nation:** ${nationName} (ID: ${nationId})\n` +
          `**Failure rate:** ${analysis.failureRate}% (${analysis.failingCount}/${analysis.auditCount} audits failing)\n` +
          `**Window:** Last ${analysis.windowDays} days\n` +
          `**Average score:** ${analysis.avgScore}% | **Lowest:** ${analysis.lowestScore}%\n\n` +
          `**Recent trend (oldest → newest):**\n${analysis.recent10}\n\n` +
          `This nation has been consistently failing audit standards. IA review is recommended.\n` +
          `View full history with \`/audit_history nation:${nationId}\``
      )
      .setFooter({
        text: `Threshold: ${config.failureRateThreshold}% failure rate over ${config.windowDays} days (min ${config.minAudits} audits required)`
      });

    try {
      await channel.send({ content: `<@&${config.iaRoleId}>`, embeds: [embed] });
      stats.recommended += 1;

      // Mark this nation as alerted so we don't ping again during the cooldown
      if (!settings.iaAlerts.lastAlertedNations) settings.iaAlerts.lastAlertedNations = {};
      settings.iaAlerts.lastAlertedNations[String(nationId)] = new Date().toISOString();
    } catch (error) {
      console.error(`[iaAlerts] Failed to post alert for nation ${nationId}:`, error.message);
    }
  }

  saveSettings(guildId, settings);
  return stats;
}

module.exports = { runIaAlertsForGuild };
