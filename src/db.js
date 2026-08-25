// db.js
//
// This is our "database." Instead of a complicated database server,
// we save one plain text file (in JSON format) per Discord server (guild)
// inside the /data folder. Every time we need to read or change settings,
// we load that file, change it, and save it back.
//
// This keeps things simple and easy to understand for now.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// The default settings every new server starts with.
function defaultSettings() {
  return {
    alliance: { id: null, name: null, colour: null },
    // MMR now varies by city-count tier, since a 3-city nation and a
    // 25-city nation shouldn't need the same number of military buildings.
mmr: {
  "C1-C5":   { minSlots: 5 },
  "C6-C10":  { minSlots: 5 },
  "C11-C15": { minSlots: 5 },
  "C16-C20": { minSlots: 5 },
  "C21+":    { minSlots: 5 }
},
// Configurable infrastructure caps per city-count tier for Check 1.
// Default values match the original hardcoded spec values.
infraCapTiers: {
  c1_c14: 1300,
  c15_c19: 1500,
  c20_plus: 2000
},  
scores: {
      check1_infra_cap: 6,
      check2_equal_infra: 6,
      check3_land_ratio: 6,
      check4_mmr: 8,
      check5_free_slots: 6,
      check6_farm_restriction: 5,
      check7_activity_center: 5,
      check8_civil_arable: 5,
      check9_nuclear_power: 6,
      check10_excess_nuclear: 5,
      check11_project_opportunity: 6,
      check12_colour_bloc: 6,
      check13_raid_requirement: 6,
      check14_resource_control: 8,
      check16_activity: 8,
      check17_power_upkeep: 5,
      check18_military_fill: 9,
      check19_map_usage: 5,
      check20_spy_count: 5
    },
    // How many hours of inactivity before a nation is considered inactive
    // (used by Check 16 and the automatic inactivity DM).
    activityLimitHours: 36,
    // Which nations the Raid Requirement applies to, and how many active
    // offensive wars they need (used by Check 13 and the automatic raid DM).
    raidPolicy: { maxCityTier: 14, requiredOffensiveWars: 4 },
    // The automated DM scheduler is OFF by default — an admin must turn it
    // on deliberately with /set_auto_notify. When on, it periodically checks
    // every member for inactivity, unused raid capacity, and full MAP, and
    // DMs anyone who matches (respecting a per-nation cooldown so the same
    // nation isn't DM'd every single run if the condition persists).
    // excludedTiers: city-count tiers (e.g. "c20_plus") that are skipped
    // entirely by this system — set with /set_auto_notify_tier.
    autoNotify: { enabled: false, intervalHours: 6, cooldownHours: 24, lastRunAt: null, excludedTiers: [] },
    // Separate from the above — this sends EVERY member their own full
    // Grand Audit report on a fixed schedule (e.g. weekly), regardless of
    // whether anything's wrong. Also OFF by default.
    scheduledReports: { enabled: false, intervalDays: 7, lastRunAt: null },
    // Maps each city-count tier to a Discord role ID, e.g. "Initiate C1-C5".
    // Configured with /set_tier_role. Null until an admin sets it.
    tierRoles: { c1_c5: null, c6_c10: null, c11_c15: null, c16_c19: null, c20_plus: null },
    // When on, periodically gives every member the Discord role matching
    // their CURRENT city count (and removes any other tier role they no
    // longer match) — covers both newly-accepted members and existing
    // members who grew without anyone noticing. Off by default.
    tierRoleSync: { enabled: false, intervalHours: 12, lastRunAt: null },
    // Replaces the old single pass/fail cutoff with 4 tiers. A nation's
    // score lands in whichever tier it's high enough for: Excellent (top),
    // Passing, Needs Improvement, or Failing (bottom, below "average").
    gradeThresholds: { excellent: 90, good: 80, average: 70 },
    warchestPolicy: {},
    // Per-nation overrides for specific members, e.g. an officer who's
    // allowed to hold more than the standard policy. Keyed by nation ID
    // (as a string). Set with /set_member_warchest, same per-city shape
    // as the alliance-wide warchestPolicy above.
    memberWarchestOverrides: {},
    // Configurable rotating-council feature (e.g. "Non-permanent UNSC
    // Members"). Picks a fresh set of eligible members on a schedule,
    // assigns them a Discord role for the duration, then rotates them out
    // automatically. Off by default — set up with /set_unsc_config.
    unscRotation: {
      enabled: false,
      seatCount: 10,
      minSeniorityDays: 60,
      intervalDays: 30,
      nonPermanentRoleId: null,
      permanentRoleId: null, // members with this role are always excluded
      pingRoleId: null,
      announceChannelId: null,
      currentTermNationIds: [], // who's currently seated
      termStartedAt: null,
      lastRunAt: null
    },

        // Inactivity demotion feature — manual trigger only, never automatic.
    inactivityDemotion: {
      thresholdDays: 7,
      defaulterRoleId: null,
      // Optional: list of role IDs to always keep (e.g. Permanent UNSC)
      // Everything else except @everyone is removed.
      protectedRoleIds: []
    },
    // Members' personal PnW API keys, encrypted at rest (see crypto.js).
    // Collected via /link_api_key using a private Discord modal — never
    // typed as a visible command option. Keyed by nation ID (as a string).
    // NOTE: actual bank deposits require Politics & War staff to separately
    // whitelist this bot for the bankDeposit mutation — collecting keys
    // here does not by itself enable any real fund movement yet.
    linkedApiKeys: {}, // { "nationId": { encrypted: "...", linkedAt: "isoDate" } }
    resourcePolicy: { upkeepBufferDays: 5 },
    auditChannelId: null,
    roleMap: {}, // { "discordRoleId": "mentor" | "government" | "administrator" }
    auditHistory: [], // { nationId, nationName, date, score, pass, grade, command }
    // Tracks the last time each nation was auto-DM'd for each condition,
    // so the automatic notifier doesn't message the same nation every run.
    lastNotified: {} // { "nationId:condition": isoTimestamp }
  };
}

function filePathFor(guildId) {
  return path.join(DATA_DIR, `${guildId}.json`);
}

function getSettings(guildId) {
  const file = filePathFor(guildId);
  if (!fs.existsSync(file)) {
    const fresh = defaultSettings();
    fs.writeFileSync(file, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  const raw = fs.readFileSync(file, "utf8");
  const settings = JSON.parse(raw);

  // Migration: older versions stored one flat MMR instead of 5 tiers.
  // If we spot the old shape, carry that value into every tier as a
  // starting point — you'll likely want to adjust the tiers individually
  // with /set_mmr afterward.
  if (settings.mmr && !settings.mmr["C1-C5"]) {
    const oldFlat = settings.mmr;
    settings.mmr = {
      "C1-C5": { ...oldFlat },
      "C6-C10": { ...oldFlat },
      "C11-C15": { ...oldFlat },
      "C16-C20": { ...oldFlat },
      "C21+": { ...oldFlat }
    };
    saveSettings(guildId, settings);
  }

  // Migration: older versions stored one flat passingScore instead of 4
  // grade tiers. If we spot the old shape, use it as the "average" cutoff
  // (the old pass/fail line) and pick sensible tiers above it.
  if (!settings.gradeThresholds) {
    const oldPassingScore = settings.passingScore ?? 70;
    settings.gradeThresholds = {
      excellent: Math.min(100, oldPassingScore + 20),
      good: Math.min(100, oldPassingScore + 10),
      average: oldPassingScore
    };
    saveSettings(guildId, settings);
  }

  // Migration: add fields introduced after a server's settings were
  // already created, using the same defaults a brand-new server would get.
  let migrated = false;
  if (settings.activityLimitHours === undefined) {
    settings.activityLimitHours = 36;
    migrated = true;
  }
  if (!settings.raidPolicy) {
    settings.raidPolicy = { maxCityTier: 14, requiredOffensiveWars: 4 };
    migrated = true;
  }
  if (!settings.autoNotify) {
    settings.autoNotify = { enabled: false, intervalHours: 6, cooldownHours: 24, lastRunAt: null, excludedTiers: [] };
    migrated = true;
  }
  if (settings.autoNotify && settings.autoNotify.excludedTiers === undefined) {
    settings.autoNotify.excludedTiers = [];
    migrated = true;
  }
  if (!settings.scheduledReports) {
    settings.scheduledReports = { enabled: false, intervalDays: 7, lastRunAt: null };
    migrated = true;
  }
  if (!settings.tierRoles) {
    settings.tierRoles = { c1_c5: null, c6_c10: null, c11_c15: null, c16_c19: null, c20_plus: null };
    migrated = true;
  }
  if (!settings.tierRoleSync) {
    settings.tierRoleSync = { enabled: false, intervalHours: 12, lastRunAt: null };
    migrated = true;
  }
  if (!settings.memberWarchestOverrides) {
    settings.memberWarchestOverrides = {};
    migrated = true;
  }
  if (!settings.unscRotation) {
    settings.unscRotation = {
      enabled: false,
      seatCount: 10,
      minSeniorityDays: 60,
      intervalDays: 30,
      nonPermanentRoleId: null,
      permanentRoleId: null,
      pingRoleId: null,
      announceChannelId: null,
      currentTermNationIds: [],
      termStartedAt: null,
      lastRunAt: null
    };
    migrated = true;
  }
  if (!settings.linkedApiKeys) {
    settings.linkedApiKeys = {};
    migrated = true;
  }
  if (settings.scores && settings.scores.check19_map_usage === undefined) {
    settings.scores.check19_map_usage = 5;
    migrated = true;
  }
  if (settings.scores && settings.scores.check20_spy_count === undefined) {
    settings.scores.check20_spy_count = 5;
    migrated = true;
  }
  if (!settings.lastNotified) {
    settings.lastNotified = {};
    migrated = true;
  }
if (!settings.infraCapTiers) {
  settings.infraCapTiers = { c1_c14: 1300, c15_c19: 1500, c20_plus: 2000 };
  migrated = true;
}

if (!settings.inactivityDemotion) {
  settings.inactivityDemotion = {
    thresholdDays: 7,
    defaulterRoleId: null,
    protectedRoleIds: []
  };
  migrated = true;
}
// Migration: convert old barracks/factory/hangar/drydock MMR to new slot-based system
if (settings.mmr && settings.mmr["C1-C5"] && settings.mmr["C1-C5"].barracks !== undefined) {
  for (const tier of Object.keys(settings.mmr)) {
    const old = settings.mmr[tier];
    const oldTotal = (old.barracks || 0) + (old.factory || 0) + (old.hangar || 0) + (old.drydock || 0);
    settings.mmr[tier] = { minSlots: Math.max(oldTotal, 5) };
  }
  migrated = true;
}
  if (migrated) saveSettings(guildId, settings);

  return settings;
}

function saveSettings(guildId, settings) {
  const file = filePathFor(guildId);
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

module.exports = { getSettings, saveSettings, defaultSettings };
