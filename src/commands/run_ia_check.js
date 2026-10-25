const { SlashCommandBuilder } = require("discord.js");
const { runIaAlertsForGuild } = require("../audit/iaAlerts");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "government",
  data: new SlashCommandBuilder()
    .setName("run_ia_check")
    .setDescription("Manually run the IA recommendation check now instead of waiting for the schedule."),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);

    if (!settings.iaAlerts.iaChannelId || !settings.iaAlerts.iaRoleId) {
      await interaction.editReply("❌ IA channel or role not configured — run /set_ia_config first.");
      return;
    }

    if ((settings.auditHistory || []).length === 0) {
      await interaction.editReply(
        "❌ No audit history on file yet. Enable the silent daily audit with `/set_ia_config daily_audit_enabled:True` " +
          "and wait at least a few days for data to accumulate before running this."
      );
      return;
    }

    await interaction.editReply("⏳ Analysing audit history...");

    const stats = await runIaAlertsForGuild(interaction.client, interaction.guild, settings, interaction.guildId);
    settings.iaAlerts.lastRunAt = new Date().toISOString();
    saveSettings(interaction.guildId, settings);

    await interaction.followUp(
      `✅ IA check complete.\n` +
        `**Analysed:** ${stats.checked} nation(s) with recent history\n` +
        `**Recommendations posted:** ${stats.recommended}\n` +
        `**Skipped (on cooldown):** ${stats.skippedCooldown}\n` +
        `**Skipped (insufficient data):** ${stats.skippedData}`
    );
  }
};
