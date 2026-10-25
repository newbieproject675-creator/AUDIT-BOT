const { SlashCommandBuilder } = require("discord.js");
const { runDailyAuditForGuild } = require("../audit/dailyAudit");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "government",
  data: new SlashCommandBuilder()
    .setName("run_daily_audit")
    .setDescription("Manually trigger the silent daily audit now to start building history data."),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);

    if (!settings.dailyAudit) settings.dailyAudit = { enabled: false, lastRunAt: null };

    if (!settings.alliance.id) {
      await interaction.editReply("❌ No alliance registered yet — run /set_alliance first.");
      return;
    }

    await interaction.editReply("⏳ Running silent audit on all members — this may take a minute...");

    const stats = await runDailyAuditForGuild(settings, interaction.guildId);
    settings.dailyAudit.lastRunAt = new Date().toISOString();
    saveSettings(interaction.guildId, settings);

    await interaction.followUp(
      `✅ Silent audit complete.\n` +
        `**Checked:** ${stats.checked} member(s)\n` +
        `**Saved to history:** ${stats.saved}\n` +
        `**Errors:** ${stats.errors}\n\n` +
        `Total audit history records: **${settings.auditHistory?.length ?? 0}**`
    );
  }
};
