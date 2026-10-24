const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("set_unsc_last_run")
    .setDescription("Set when the last UNSC rotation happened to prevent unwanted re-runs.")
    .addStringOption((opt) =>
      opt
        .setName("date")
        .setDescription("Date of the last rotation in YYYY-MM-DD format, e.g. 2026-06-01")
        .setRequired(true)
    ),

  async execute(interaction) {
    const dateInput = interaction.options.getString("date");
    const parsed = new Date(dateInput + "T00:00:00Z");

    if (isNaN(parsed.getTime())) {
      await interaction.reply({
        content: "❌ Couldn't understand that date. Use YYYY-MM-DD format, e.g. 2026-06-01.",
        ephemeral: true
      });
      return;
    }
    if (parsed.getTime() > Date.now()) {
      await interaction.reply({
        content: "❌ That date is in the future.",
        ephemeral: true
      });
      return;
    }

    const settings = getSettings(interaction.guildId);
    settings.unscRotation.lastRunAt = parsed.toISOString();
    saveSettings(interaction.guildId, settings);

    const nextRotation = new Date(parsed.getTime() + settings.unscRotation.intervalDays * 24 * 60 * 60 * 1000);

    const embed = new EmbedBuilder()
      .setTitle("UNSC Last Run Date Set")
      .setColor(0x2ecc71)
      .setDescription(
        `Last rotation recorded as **${dateInput}**.\n` +
          `Next automatic rotation due around **${nextRotation.toISOString().split("T")[0]}**.\n\n` +
          "No roles were changed — this only updates the schedule."
      );

    await interaction.reply({ embeds: [embed] });
  }
};
