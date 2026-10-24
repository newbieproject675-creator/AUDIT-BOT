// scheduler.js
//
// A single timer that wakes up periodically (every 15 minutes) and checks
// every guild the bot is in, for FOUR independent jobs:
//   1. autoNotify        — DMs nations that currently have a problem.
//   2. scheduledReports  — DMs every member their own Grand Audit report.
//   3. tierRoleSync      — keeps each member's Discord tier role in sync.
//   4. unscRotation      — rotates the non-permanent council seats.
//
// IMPORTANT: A startup grace period prevents any job from firing immediately
// when the bot restarts. Without this, jobs would re-run on every restart
// because Node.js re-evaluates "is this due?" from scratch each time.
// The grace period gives the bot 5 minutes to fully start up before any
// scheduled job is allowed to run.

const { getSettings, saveSettings } = require("./db");
const { runAutoNotifyForGuild } = require("./audit/autoNotify");
const { runScheduledReportsForGuild } = require("./audit/scheduledReports");
const { runTierRoleSyncForGuild } = require("./audit/tierRoleSync");
const { runUnscRotation } = require("./audit/unscRotation");

const TICK_INTERVAL_MS = 15 * 60 * 1000; // check every 15 minutes
const STARTUP_GRACE_MS = 5 * 60 * 1000;  // don't run anything for 5 minutes after startup
const currentlyRunning = new Set();

// The moment this module was first loaded — used for the grace period check.
const BOT_START_TIME = Date.now();

function isDue(lastRunAtIso, intervalMs) {
  const lastRunAt = lastRunAtIso ? new Date(lastRunAtIso) : null;
  return !lastRunAt || Date.now() - lastRunAt.getTime() >= intervalMs;
}

function isGracePeriodOver() {
  return Date.now() - BOT_START_TIME >= STARTUP_GRACE_MS;
}

async function runAutoNotifyJob(client, guild, settings) {
  const lockKey = `${guild.id}:autoNotify`;
  if (currentlyRunning.has(lockKey)) return;
  if (!settings.autoNotify?.enabled || !settings.alliance.id) return;
  if (!isDue(settings.autoNotify.lastRunAt, settings.autoNotify.intervalHours * 60 * 60 * 1000)) return;

  currentlyRunning.add(lockKey);
  try {
    console.log(`[autoNotify] Starting scheduled run for guild ${guild.id} (${guild.name})...`);
    const stats = await runAutoNotifyForGuild(client, guild, settings);
    settings.autoNotify.lastRunAt = new Date().toISOString();
    saveSettings(guild.id, settings);
    console.log(
      `[autoNotify] Finished guild ${guild.id}: checked ${stats.checked}, sent ${stats.dmsSent}, ` +
        `failed ${stats.dmsFailed}, no Discord linked ${stats.skippedNoDiscord}, on cooldown ${stats.skippedCooldown}`
    );
  } catch (error) {
    console.error(`[autoNotify] Error running scheduled notify for guild ${guild.id}:`, error);
  } finally {
    currentlyRunning.delete(lockKey);
  }
}

async function runScheduledReportsJob(client, guild, settings) {
  const lockKey = `${guild.id}:scheduledReports`;
  if (currentlyRunning.has(lockKey)) return;
  if (!settings.scheduledReports?.enabled || !settings.alliance.id) return;
  if (!isDue(settings.scheduledReports.lastRunAt, settings.scheduledReports.intervalDays * 24 * 60 * 60 * 1000)) return;

  currentlyRunning.add(lockKey);
  try {
    console.log(`[scheduledReports] Starting scheduled run for guild ${guild.id} (${guild.name})...`);
    const stats = await runScheduledReportsForGuild(client, guild, settings);
    settings.scheduledReports.lastRunAt = new Date().toISOString();
    saveSettings(guild.id, settings);
    console.log(
      `[scheduledReports] Finished guild ${guild.id}: checked ${stats.checked}, sent ${stats.dmsSent}, ` +
        `failed ${stats.dmsFailed}, no Discord linked ${stats.skippedNoDiscord}`
    );
  } catch (error) {
    console.error(`[scheduledReports] Error running scheduled reports for guild ${guild.id}:`, error);
  } finally {
    currentlyRunning.delete(lockKey);
  }
}

async function runTierRoleSyncJob(client, guild, settings) {
  const lockKey = `${guild.id}:tierRoleSync`;
  if (currentlyRunning.has(lockKey)) return;
  if (!settings.tierRoleSync?.enabled || !settings.alliance.id) return;
  if (!isDue(settings.tierRoleSync.lastRunAt, settings.tierRoleSync.intervalHours * 60 * 60 * 1000)) return;

  currentlyRunning.add(lockKey);
  try {
    console.log(`[tierRoleSync] Starting scheduled run for guild ${guild.id} (${guild.name})...`);
    const stats = await runTierRoleSyncForGuild(client, guild, settings);
    settings.tierRoleSync.lastRunAt = new Date().toISOString();
    saveSettings(guild.id, settings);
    console.log(
      `[tierRoleSync] Finished guild ${guild.id}: checked ${stats.checked}, updated ${stats.updated}, ` +
        `already correct ${stats.alreadyCorrect}, role errors ${stats.roleErrors}`
    );
  } catch (error) {
    console.error(`[tierRoleSync] Error running tier role sync for guild ${guild.id}:`, error);
  } finally {
    currentlyRunning.delete(lockKey);
  }
}

async function runUnscRotationJob(client, guild, settings) {
  const lockKey = `${guild.id}:unscRotation`;
  if (currentlyRunning.has(lockKey)) return;
  if (!settings.unscRotation?.enabled || !settings.alliance.id) return;
  if (!isDue(settings.unscRotation.lastRunAt, settings.unscRotation.intervalDays * 24 * 60 * 60 * 1000)) return;

  currentlyRunning.add(lockKey);
  try {
    console.log(`[unscRotation] Starting scheduled rotation for guild ${guild.id} (${guild.name})...`);
    const summary = await runUnscRotation(client, guild, settings);
    settings.unscRotation.lastRunAt = new Date().toISOString();
    saveSettings(guild.id, settings);
    console.log(
      `[unscRotation] Finished guild ${guild.id}: removed ${summary.outgoingRemoved}, seated ${summary.newlySeated.length}, ` +
        `eligible ${summary.eligibleCount}, excluded ${summary.excludedCount}, errors ${summary.outgoingErrors}`
    );
  } catch (error) {
    console.error(`[unscRotation] Error running rotation for guild ${guild.id}:`, error);
  } finally {
    currentlyRunning.delete(lockKey);
  }
}

async function tick(client) {
  // Don't run ANY scheduled job during the startup grace period.
  // This prevents jobs from firing on every bot restart.
  if (!isGracePeriodOver()) {
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    const settings = getSettings(guild.id);
    await runAutoNotifyJob(client, guild, settings);
    await runScheduledReportsJob(client, guild, settings);
    await runTierRoleSyncJob(client, guild, settings);
    await runUnscRotationJob(client, guild, settings);
  }
}

function startScheduler(client) {
  setInterval(() => {
    tick(client).catch((error) => console.error("[scheduler] Unexpected scheduler error:", error));
  }, TICK_INTERVAL_MS);
  console.log(
    `✅ Scheduler started (5-minute startup grace period, then checks every 15 minutes for guilds with any scheduled job enabled).`
  );
}

module.exports = { startScheduler };
