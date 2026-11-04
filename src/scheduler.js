// scheduler.js — 5 scheduled jobs, all share one 15-minute tick.
// Startup grace period prevents any job from firing on bot restart.

const { getSettings, saveSettings } = require("./db");
const { runAutoNotifyForGuild } = require("./audit/autoNotify");
const { runScheduledReportsForGuild } = require("./audit/scheduledReports");
const { runTierRoleSyncForGuild } = require("./audit/tierRoleSync");
const { runUnscRotation } = require("./audit/unscRotation");
const { runDailyAuditForGuild } = require("./audit/dailyAudit");
const { runIaAlertsForGuild } = require("./audit/iaAlerts");
const { runCooldownAlertsForGuild } = require("./audit/cooldownAlerts");

const TICK_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_GRACE_MS = 5 * 60 * 1000;
const currentlyRunning = new Set();
const BOT_START_TIME = Date.now();

function isDue(lastRunAtIso, intervalMs) {
  const lastRunAt = lastRunAtIso ? new Date(lastRunAtIso) : null;
  return !lastRunAt || Date.now() - lastRunAt.getTime() >= intervalMs;
}

function isGracePeriodOver() {
  return Date.now() - BOT_START_TIME >= STARTUP_GRACE_MS;
}

async function runJob(lockKey, label, fn) {
  if (currentlyRunning.has(lockKey)) return;
  currentlyRunning.add(lockKey);
  try {
    console.log(`[${label}] Starting scheduled run...`);
    const result = await fn();
    console.log(`[${label}] Done:`, JSON.stringify(result));
  } catch (error) {
    console.error(`[${label}] Error:`, error.message);
  } finally {
    currentlyRunning.delete(lockKey);
  }
}

// Like runJob, but for a job that runs on EVERY tick: it stays silent in the
// logs unless it actually posted something or hit a problem.
async function runQuietJob(lockKey, label, fn) {
  if (currentlyRunning.has(lockKey)) return;
  currentlyRunning.add(lockKey);
  try {
    const result = await fn();
    if (result && (result.alertsSent > 0 || result.errors > 0)) {
      console.log(`[${label}]`, JSON.stringify(result));
    }
  } catch (error) {
    console.error(`[${label}] Error:`, error.message);
  } finally {
    currentlyRunning.delete(lockKey);
  }
}

async function tick(client) {
  if (!isGracePeriodOver()) return;

  for (const guild of client.guilds.cache.values()) {
    const settings = getSettings(guild.id);

    if (settings.autoNotify?.enabled && settings.alliance.id &&
        isDue(settings.autoNotify.lastRunAt, settings.autoNotify.intervalHours * 3600000)) {
      await runJob(`${guild.id}:autoNotify`, "autoNotify", async () => {
        const stats = await runAutoNotifyForGuild(client, guild, settings);
        settings.autoNotify.lastRunAt = new Date().toISOString();
        saveSettings(guild.id, settings);
        return stats;
      });
    }

    if (settings.scheduledReports?.enabled && settings.alliance.id &&
        isDue(settings.scheduledReports.lastRunAt, settings.scheduledReports.intervalDays * 86400000)) {
      await runJob(`${guild.id}:scheduledReports`, "scheduledReports", async () => {
        const stats = await runScheduledReportsForGuild(client, guild, settings);
        settings.scheduledReports.lastRunAt = new Date().toISOString();
        saveSettings(guild.id, settings);
        return stats;
      });
    }

    if (settings.tierRoleSync?.enabled && settings.alliance.id &&
        isDue(settings.tierRoleSync.lastRunAt, settings.tierRoleSync.intervalHours * 3600000)) {
      await runJob(`${guild.id}:tierRoleSync`, "tierRoleSync", async () => {
        const stats = await runTierRoleSyncForGuild(client, guild, settings);
        settings.tierRoleSync.lastRunAt = new Date().toISOString();
        saveSettings(guild.id, settings);
        return stats;
      });
    }

    if (settings.unscRotation?.enabled && settings.alliance.id &&
        isDue(settings.unscRotation.lastRunAt, settings.unscRotation.intervalDays * 86400000)) {
      await runJob(`${guild.id}:unscRotation`, "unscRotation", async () => {
        const summary = await runUnscRotation(client, guild, settings);
        settings.unscRotation.lastRunAt = new Date().toISOString();
        saveSettings(guild.id, settings);
        return summary;
      });
    }

    // Daily audit — runs once every 24 hours silently
    if (settings.dailyAudit?.enabled && settings.alliance.id &&
        isDue(settings.dailyAudit.lastRunAt, 24 * 3600000)) {
      await runJob(`${guild.id}:dailyAudit`, "dailyAudit", async () => {
        const stats = await runDailyAuditForGuild(settings, guild.id);
        settings.dailyAudit.lastRunAt = new Date().toISOString();
        saveSettings(guild.id, settings);
        return stats;
      });
    }

    // IA alerts — runs once per day, after daily audit has a chance to run
    if (settings.iaAlerts?.enabled && settings.alliance.id &&
        isDue(settings.iaAlerts.lastRunAt, 24 * 3600000)) {
      await runJob(`${guild.id}:iaAlerts`, "iaAlerts", async () => {
        const stats = await runIaAlertsForGuild(client, guild, settings, guild.id);
        settings.iaAlerts.lastRunAt = new Date().toISOString();
        saveSettings(guild.id, settings);
        return stats;
      });
    }

    // Cooldown alerts - checked every tick so a ready nation is announced
    // within ~15 minutes of its cooldown ending.
    const cooldown = settings.cooldownAlerts;
    if ((cooldown?.projectEnabled || cooldown?.cityEnabled) && cooldown.roleId && cooldown.channelId &&
        cooldown.nations?.length > 0) {
      await runQuietJob(`${guild.id}:cooldownAlerts`, "cooldownAlerts", async () => {
        const stats = await runCooldownAlertsForGuild(client, guild, settings);
        settings.cooldownAlerts.lastRunAt = new Date().toISOString();
        saveSettings(guild.id, settings);
        return stats;
      });
    }
  }
}

function startScheduler(client) {
  setInterval(() => {
    tick(client).catch((error) => console.error("[scheduler] Unexpected error:", error));
  }, TICK_INTERVAL_MS);
  console.log("✅ Scheduler started (5-minute startup grace, then checks every 15 minutes).");
}

module.exports = { startScheduler };
