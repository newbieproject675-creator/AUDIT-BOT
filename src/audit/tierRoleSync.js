// tierRoleSync.js
//
// Keeps Discord tier roles (e.g. "Initiate C1-C5") in sync with each
// member's ACTUAL current city count. Running this covers two cases with
// the exact same mechanism:
//   1. A new member just got accepted and needs their first tier role.
//   2. An existing member quietly grew past a tier boundary and nobody
//      remembered to update their role.
//
// Every run just makes everyone's role match reality, regardless of why
// it was wrong before.
//
// Members whose roles were removed by the VM guard are skipped, so this
// doesn't hand their tier role straight back while they're in VM.

const { getAllianceNations } = require("../pnw");
const { resolveGuildMember } = require("./resolveDiscordUser");
const { tierKeyFor } = require("./tiers");
const { loadVmGuard } = require("./vmGuardStore");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTierRoleSyncForGuild(client, guild, settings) {
  const stats = {
    checked: 0,
    updated: 0,
    alreadyCorrect: 0,
    skippedNoDiscord: 0,
    skippedNoRoleConfigured: 0,
    skippedVmStripped: 0,
    roleErrors: 0
  };

  if (!settings.alliance.id) return stats;

  const { members } = await getAllianceNations(settings.alliance.id);
  stats.checked = members.length;

  // Nations whose roles are currently removed by the VM guard.
  let strippedIds = new Set();
  try {
    strippedIds = new Set(Object.keys(loadVmGuard(guild.id).stripped));
  } catch (error) {
    console.error("[tierRoleSync] Couldn't read the VM guard data:", error.message);
  }

  // Every role ID currently configured across all 5 tiers — used to spot
  // and remove a STALE tier role someone has from a tier they've outgrown.
  const allConfiguredRoleIds = Object.values(settings.tierRoles).filter(Boolean);

  for (const nation of members) {
    if (strippedIds.has(String(nation.id))) {
      stats.skippedVmStripped += 1;
      continue;
    }

    const tierKey = tierKeyFor(nation.num_cities);
    const correctRoleId = tierKey ? settings.tierRoles[tierKey] : null;

    if (!correctRoleId) {
      stats.skippedNoRoleConfigured += 1;
      continue;
    }

    const member = await resolveGuildMember(guild, nation);
    if (!member) {
      stats.skippedNoDiscord += 1;
      continue;
    }

    const hasCorrectRole = member.roles.cache.has(correctRoleId);
    const staleRoleIds = allConfiguredRoleIds.filter((id) => id !== correctRoleId && member.roles.cache.has(id));

    if (hasCorrectRole && staleRoleIds.length === 0) {
      stats.alreadyCorrect += 1;
      continue;
    }

    try {
      if (!hasCorrectRole) await member.roles.add(correctRoleId);
      for (const staleId of staleRoleIds) await member.roles.remove(staleId);
      stats.updated += 1;
    } catch (error) {
      // Most commonly: the bot's own role isn't positioned above the tier
      // roles, or it's missing the Manage Roles permission.
      stats.roleErrors += 1;
    }

    await sleep(300); // be polite to Discord's rate limits
  }

  return stats;
}

module.exports = { runTierRoleSyncForGuild };
