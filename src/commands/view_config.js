const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings } = require("../db");

function roleDisplay(guild, roleId) {
  if (!roleId) return "Not set";
  const role = guild.roles.cache.get(roleId);
  return role ? role.name : `Unknown (${roleId})`;
}

function channelDisplay(guild, channelId) {
  if (!channelId) return "Not set";
  const channel = guild.channels.cache.get(channelId);
  return channel ? `#${channel.name}` : `Unknown (${channelId})`;
}

function yesNo(val) {
  return val ? "Yes" : "No";
}

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("view_config")
    .setDescription("Show a complete summary of every current bot setting."),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const s = getSettings(interaction.guildId);
    const guild = interaction.guild;

    // ── Alliance ──────────────────────────────────────────────────────────
    const allianceEmbed = new EmbedBuilder()
      .setTitle("⚙️ Full Bot Configuration")
      .setColor(0x3498db)
      .setDescription("Here is every setting currently configured for this server.")
      .addFields({
        name: "🌐 Alliance",
        value:
          `**Name:** ${s.alliance.name || "Not set"}\n` +
          `**ID:** ${s.alliance.id || "Not set"}\n` +
          `**Colour:** ${s.alliance.colour || "Not set"}`
      });

    // ── Grades & Scoring ──────────────────────────────────────────────────
    const { excellent, good, average } = s.gradeThresholds || {};
    allianceEmbed.addFields({
      name: "🎯 Grade Thresholds",
      value:
        `🟢 Excellent: ${excellent}%+ | 🟢 Passing: ${good}%+ | 🟡 Needs Improvement: ${average}%+ | 🔴 Failing: below ${average}%`
    });

    // ── Infra Caps ────────────────────────────────────────────────────────
    const caps = s.infraCapTiers || {};
    allianceEmbed.addFields({
      name: "🏗️ Infrastructure Caps",
      value:
        `C1-C14: ${caps.c1_c14 ?? 1300} | C15-C19: ${caps.c15_c19 ?? 1500} | C20+: ${caps.c20_plus ?? 2000}`
    });

    // ── MMR ───────────────────────────────────────────────────────────────
    const mmrLines = Object.entries(s.mmr || {}).map(([tier, req]) => {
      const slots = req.minSlots ?? "Not set";
      return `${tier}: ${slots} slots`;
    });
    allianceEmbed.addFields({ name: "⚔️ MMR (Min Military Slots + 5 mandatory hangars)", value: mmrLines.join(" | ") || "Not configured" });

    // ── Warchest ──────────────────────────────────────────────────────────
    const warchestLines = Object.entries(s.warchestPolicy || {}).map(
      ([res, perCity]) => `${res}: ${perCity}/city`
    );
    allianceEmbed.addFields({
      name: "💰 Warchest Policy (per city)",
      value: warchestLines.length > 0 ? warchestLines.join("\n") : "Not configured"
    });

    // ── Activity & Raid ───────────────────────────────────────────────────
    allianceEmbed.addFields({
      name: "⏰ Activity & Raid Policy",
      value:
        `**Activity limit:** ${s.activityLimitHours ?? 36} hours\n` +
          `**Raid policy:** ≤C${s.raidPolicy?.maxCityTier ?? 14} nations need ${s.raidPolicy?.requiredOffensiveWars ?? 4} offensive wars`
    });

    // ── Role Mapping ──────────────────────────────────────────────────────
    const roleMapLines = Object.entries(s.roleMap || {}).map(([id, tier]) => {
      const role = guild.roles.cache.get(id);
      return `${role ? role.name : id} → ${tier}`;
    });
    allianceEmbed.addFields({
      name: "🔐 Permission Role Mapping",
      value: roleMapLines.length > 0 ? roleMapLines.join("\n") : "None configured"
    });

    // Second embed — automated systems
    const autoEmbed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .addFields(
        {
          name: "📣 Auto-Notify",
          value:
            `**Enabled:** ${yesNo(s.autoNotify?.enabled)}\n` +
              `**Interval:** every ${s.autoNotify?.intervalHours ?? 6}h\n` +
              `**Cooldown:** ${s.autoNotify?.cooldownHours ?? 24}h\n` +
              `**Excluded tiers:** ${s.autoNotify?.excludedTiers?.join(", ") || "None"}`
        },
        {
          name: "📅 Scheduled Reports",
          value:
            `**Enabled:** ${yesNo(s.scheduledReports?.enabled)}\n` +
              `**Interval:** every ${s.scheduledReports?.intervalDays ?? 7} days\n` +
              `**Last run:** ${s.scheduledReports?.lastRunAt ? new Date(s.scheduledReports.lastRunAt).toLocaleDateString() : "Never"}`
        },
        {
          name: "🎭 Tier Role Sync",
          value:
            `**Enabled:** ${yesNo(s.tierRoleSync?.enabled)}\n` +
              `**Interval:** every ${s.tierRoleSync?.intervalHours ?? 12}h\n` +
              Object.entries(s.tierRoles || {})
                .map(([tier, id]) => `${tier}: ${roleDisplay(guild, id)}`)
                .join("\n")
        }
      );

    // Third embed — UNSC & misc
    const unsc = s.unscRotation || {};
    const miscEmbed = new EmbedBuilder()
      .setColor(0x2c3e50)
      .addFields(
        {
          name: "🪐 UNSC Rotation",
          value:
            `**Enabled:** ${yesNo(unsc.enabled)}\n` +
              `**Seats:** ${unsc.seatCount ?? 10}\n` +
              `**Min seniority:** ${unsc.minSeniorityDays ?? 60} days\n` +
              `**Term length:** ${unsc.intervalDays ?? 30} days\n` +
              `**Non-permanent role:** ${roleDisplay(guild, unsc.nonPermanentRoleId)}\n` +
              `**Permanent role (excluded):** ${roleDisplay(guild, unsc.permanentRoleId)}\n` +
              `**Ping role:** ${roleDisplay(guild, unsc.pingRoleId)}\n` +
              `**Announce channel:** ${channelDisplay(guild, unsc.announceChannelId)}\n` +
              `**Last run:** ${unsc.lastRunAt ? new Date(unsc.lastRunAt).toLocaleDateString() : "Never"}\n` +
              `**Term started:** ${unsc.termStartedAt ? new Date(unsc.termStartedAt).toLocaleDateString() : "Not recorded"}`
        },
        {
          name: "🚫 Inactivity Demotion",
          value:
            `**Threshold:** ${s.inactivityDemotion?.thresholdDays ?? 7} days\n` +
              `**Defaulter role:** ${roleDisplay(guild, s.inactivityDemotion?.defaulterRoleId)}\n` +
              `**Protected roles:** ${
                s.inactivityDemotion?.protectedRoleIds?.length > 0
                  ? s.inactivityDemotion.protectedRoleIds.map((id) => roleDisplay(guild, id)).join(", ")
                  : "None"
              }`
        },
        {
          name: "📢 Audit Channel",
          value: channelDisplay(guild, s.auditChannelId)
        }
      );

    await interaction.editReply({ embeds: [allianceEmbed, autoEmbed, miscEmbed] });
  }
};
