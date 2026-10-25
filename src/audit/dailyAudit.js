// dailyAudit.js
//
// Runs a silent Grand Audit on every active alliance member once per day.
// No DMs, no channel posts — just saves results to auditHistory so the
// IA alert system has enough data points to make accurate recommendations.
// The more data points we have, the less likely a nation gets flagged just
// because they happened to fail on the day we checked.

const { getAllianceNations, isActiveMember } = require("../pnw");
const { runGrandAudit } = require("./grandAudit");
const { buildHistoryRecord } = require("./runAudit");
const { saveSettings } = require("../db");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDailyAuditForGuild(settings, guildId) {
  const stats = { checked: 0, saved: 0, errors: 0 };

  if (!settings.alliance.id) return stats;

  const { members } = await getAllianceNations(settings.alliance.id);
  const activeMembers = members.filter(isActiveMember);
  stats.checked = activeMembers.length;

  for (const nation of activeMembers) {
    try {
      const { percent, grade } = await runGrandAudit(nation, settings);

      // Build a history record and save it — same format as manual audits
      // so the IA alert system can analyse everything in one place.
      const record = buildHistoryRecord(nation, percent, grade, "daily_audit");

      if (!settings.auditHistory) settings.auditHistory = [];
      settings.auditHistory.push(record);

      // Cap history at 2000 entries to prevent the file growing forever.
      // At ~70 members × 365 days = ~25,550 entries/year without a cap.
      // 2000 entries = ~28 days of daily audits for a 70-member alliance.
      if (settings.auditHistory.length > 2000) {
        settings.auditHistory = settings.auditHistory.slice(-2000);
      }

      stats.saved += 1;
    } catch (error) {
      stats.errors += 1;
      console.error(`[dailyAudit] Error auditing nation ${nation.id} (${nation.nation_name}):`, error.message);
    }

    await sleep(200); // be polite to the PnW API
  }

  saveSettings(guildId, settings);
  return stats;
}

module.exports = { runDailyAuditForGuild };
