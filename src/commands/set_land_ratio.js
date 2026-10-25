const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("set_land_ratio")
    .setDescription("Configure the min and max land-to-infrastructure ratio for Check 3.")
    .addNumberOption((opt) =>
      opt
        .setName("min_ratio")
        .setDescription("Minimum land as a multiple of infra, e.g. 1.0 means land must be at least equal to infra")
        .setMinValue(0.1)
    )
    .addNumberOption((opt) =>
      opt
        .setName("max_ratio")
        .setDescription("Maximum land as a multiple of infra, e.g. 2.0 means land can be at most double infra")
        .setMinValue(0.1)
    ),

  async execute(interaction) {
    const minRatio = interaction.options.getNumber("min_ratio");
    const maxRatio = interaction.options.getNumber("max_ratio");

    if (minRatio !== null && maxRatio !== null && minRatio >= maxRatio) {
      await interaction.reply({ content: "❌ Min ratio must be less than max ratio.", ephemeral: true });
      return;
    }

    const settings = getSettings(interaction.guildId);
    if (!settings.landRatioPolicy) settings.landRatioPolicy = { minRatio: 1.0, maxRatio: 2.0 };

    if (minRatio !== null) settings.landRatioPolicy.minRatio = minRatio;
    if (maxRatio !== null) settings.landRatioPolicy.maxRatio = maxRatio;

    saveSettings(interaction.guildId, settings);

    const { minRatio: min, maxRatio: max } = settings.landRatioPolicy;

    const embed = new EmbedBuilder()
      .setTitle("Land Ratio Policy Updated")
      .setColor(0x2ecc71)
      .setDescription(
        `**Minimum ratio:** ${min}× infra (land must be ≥ infra × ${min})\n` +
          `**Maximum ratio:** ${max}× infra (land must be ≤ infra × ${max})\n\n` +
          `**Example for a city with 1,500 infra:**\n` +
          `• Minimum land: ${(1500 * min).toLocaleString()}\n` +
          `• Maximum land: ${(1500 * max).toLocaleString()}\n` +
          `• Any land value between those two numbers passes.`
      );

    await interaction.reply({ embeds: [embed] });
  }
};
