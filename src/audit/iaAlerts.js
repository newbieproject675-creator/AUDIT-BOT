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
const { queryPNW } = require("../pnw");

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

// ---------------------------------------------------------------------------
// Inactivity trigger: a nation that has not been active in the game for more
// than `inactivityDays` (default 8) is recommended for removal, separately
// from the audit-failure trigger above. Nations in Vacation Mode are skipped
// (they are away on purpose, and the VM guard deals with long VMs).
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;
const ACTIVITY_QUERY = `
  query AllianceActivity($allianceId: [Int], $page: Int) {
    nations(alliance_id: $allianceId, first: 50, page: $page) {
      paginatorInfo { hasMorePages currentPage }
      data { id nation_name num_cities alliance_position vacation_mode_turns last_active }
    }
  }
`;

async function fetchAllianceActivity(allianceId) {
  const members = [];
  let page = 1;
  let more = true;
  while (more) {
    const data = await queryPNW(ACTIVITY_QUERY, { allianceId: [Number(allianceId)], page });
    const result = data?.nations;
    if (!result) break;
    members.push(...result.data);
    more = result.paginatorInfo?.hasMorePages ?? false;
    page += 1;
  }
  // Applicants aren't members yet.
  return members.filter((n) => (n.alliance_position || "").toUpperCase() !== "APPLICANT");
}

async function runInactivityRecommendations(channel, settings, stats) {
  const config = settings.iaAlerts;
  const days = config.inactivityDays ?? 8;
  const now = Date.now();
  const cooldownMs = (config.cooldownDays ?? 7) * DAY_MS;
  if (!config.lastAlertedNations) config.lastAlertedNations = {};

  const members = await fetchAllianceActivity(settings.alliance.id);
  stats.inactiveChecked = members.length;

  const flagged = [];
  for (const nation of members) {
    if (Number(nation.vacation_mode_turns) > 0) continue;
    const lastActive = new Date(nation.last_active).getTime();
    if (!nation.last_active || Number.isNaN(lastActive)) continue;
    const inactiveDays = (now - lastActive) / DAY_MS;
    if (inactiveDays <= days) continue;

    // A separate key from the audit-failure alerts, so one doesn't hide the other.
    const key = `${nation.id}:inactive`;
    const alertedAt = config.lastAlertedNations[key];
    if (alertedAt && now - new Date(alertedAt).getTime() < cooldownMs) {
      stats.skippedCooldown += 1;
      continue;
    }
    flagged.push({ nation, inactiveDays, lastActive, key });
  }
  if (flagged.length === 0) return;

  flagged.sort((a, b) => b.inactiveDays - a.inactiveDays); // most inactive first

  const lines = flagged.map(
    ({ nation, inactiveDays, lastActive }) =>
      `• [${nation.nation_name}](https://politicsandwar.com/nation/id=${nation.id}) · C${nation.num_cities} — ` +
      `inactive **${Math.floor(inactiveDays)} days** (last active <t:${Math.floor(lastActive / 1000)}:R>)`
  );

  // Group into messages that stay well under Discord's size limits.
  const batches = [];
  let current = [];
  let length = 0;
  flagged.forEach((item, index) => {
    if (current.length > 0 && length + lines[index].length + 1 > 3500) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push({ item, line: lines[index] });
    length += lines[index].length + 1;
  });
  if (current.length > 0) batches.push(current);

  let first = true;
  for (const batch of batches) {
    const embed = new EmbedBuilder()
      .setTitle(first ? "💤 IA Removal Recommendation — inactive nations" : "💤 IA Removal Recommendation — inactive nations (cont.)")
      .setColor(0xe67e22)
      .setDescription(
        (first
          ? `**${flagged.length}** nation(s) have been inactive for more than **${days} days** (Vacation Mode excluded). Removal is recommended.\n\n`
          : "") + batch.map((b) => b.line).join("\n")
      )
      .setFooter({ text: `Threshold: ${days} days of inactivity. Change it with /set_ia_config inactivity_days.` });

    try {
      await channel.send(
        first
          ? { content: `<@&${config.iaRoleId}>`, embeds: [embed], allowedMentions: { roles: [config.iaRoleId] } }
          : { embeds: [embed] }
      );
      first = false;
      for (const { item } of batch) config.lastAlertedNations[item.key] = new Date().toISOString();
      stats.inactiveRecommended += batch.length;
    } catch (error) {
      stats.errors += 1;
      console.error(`[iaAlerts] Couldn't post the inactivity recommendation:`, error.message);
      break;
    }
  }
}

async function runIaAlertsForGuild(client, guild, settings, guildId) {
  const config = settings.iaAlerts;
  const stats = { checked: 0, recommended: 0, skippedCooldown: 0, skippedData: 0, inactiveChecked: 0, inactiveRecommended: 0, errors: 0 };

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

  // Inactivity trigger (on by default). A failure here must not undo the audit part above.
  if (config.inactivityEnabled !== false && settings.alliance?.id) {
    try {
      await runInactivityRecommendations(channel, settings, stats);
    } catch (error) {
      stats.errors += 1;
      console.error("[iaAlerts] Inactivity check failed:", error.message);
    }
  }

  saveSettings(guildId, settings);
  return stats;
}

module.exports = { runIaAlertsForGuild };
