const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { getSettings } = require("../db");

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("export_settings")
    .setDescription("Download your current bot configuration as a backup file."),

  async execute(interaction) {
    const settings = getSettings(interaction.guildId);

    // Export everything EXCEPT audit history and encrypted API keys —
    // history can be huge and keys should never leave the server unencrypted.
    const exportData = {
      _exportedAt: new Date().toISOString(),
      _exportedBy: interaction.user.username,
      _version: "1.0",
      alliance: settings.alliance,
      mmr: settings.mmr,
      scores: settings.scores,
      gradeThresholds: settings.gradeThresholds,
      warchestPolicy: settings.warchestPolicy,
      resourcePolicy: settings.resourcePolicy,
      memberWarchestOverrides: settings.memberWarchestOverrides,
      infraCapTiers: settings.infraCapTiers,
      activityLimitHours: settings.activityLimitHours,
      raidPolicy: settings.raidPolicy,
      roleMap: settings.roleMap,
      tierRoles: settings.tierRoles,
      tierRoleSync: { ...settings.tierRoleSync, lastRunAt: null },
      autoNotify: { ...settings.autoNotify, lastRunAt: null },
      scheduledReports: { ...settings.scheduledReports, lastRunAt: null },
      unscRotation: { ...settings.unscRotation, lastRunAt: null, currentTermNationIds: settings.unscRotation?.currentTermNationIds ?? [] },
      auditChannelId: settings.auditChannelId,
lastNotified: settings.lastNotified,

// Inactivity Management
inactivityDemotion: settings.inactivityDemotion,
demotionLog: settings.demotionLog
    };

    const json = JSON.stringify(exportData, null, 2);
    const buffer = Buffer.from(json, "utf8");
    const filename = `tun-audit-settings-${interaction.guildId}-${new Date().toISOString().split("T")[0]}.json`;
    const attachment = new AttachmentBuilder(buffer, { name: filename });

    await interaction.reply({
      content:
        "✅ Here's your configuration backup. Keep this file safe.\n" +
        "⚠️ This file contains **role IDs, channel IDs, and alliance settings** — don't share it publicly.\n" +
        "Audit history and encrypted API keys are **not** included (they stay on the server).",
      files: [attachment],
      ephemeral: true
    });
  }
};
