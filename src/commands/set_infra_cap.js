const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

// City tiers matching the original spec: C1-C14, C15-C19, C20+
// Each has a configurable maximum infrastructure cap.
const INFRA_TIER_CHOICES = [
  { name: "C1-C14 (cities 1 to 14)", value: "c1_c14" },
  { name: "C15-C19 (cities 15 to 19)", value: "c15_c19" },
  { name: "C20+ (city 20 and above)", value: "c20_plus" }
];

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("set_infra_cap")
    .setDescription("Set the maximum infrastructure allowed per city for a city-count tier.")
    .addStringOption((opt) => {
      opt.setName("tier").setDescription("Which city-count tier to configure").setRequired(true);
      for (const choice of INFRA_TIER_CHOICES) opt.addChoices(choice);
      return opt;
    })
    .addIntegerOption((opt) =>
      opt
        .setName("max_infra")
        .setDescription("Maximum infrastructure allowed, e.g. 1300")
        .setMinValue(1)
        .setRequired(true)
    ),

  async execute(interaction) {
    const tier = interaction.options.getString("tier");
    const maxInfra = interaction.options.getInteger("max_infra");

    const settings = getSettings(interaction.guildId);
    if (!settings.infraCapTiers) {
      settings.infraCapTiers = { c1_c14: 1300, c15_c19: 1500, c20_plus: 2000 };
    }
    settings.infraCapTiers[tier] = maxInfra;
    saveSettings(interaction.guildId, settings);

    const tierLabel = INFRA_TIER_CHOICES.find((c) => c.value === tier)?.name ?? tier;

    const embed = new EmbedBuilder()
      .setTitle("Infrastructure Cap Updated")
      .setColor(0x2ecc71)
      .setDescription(`**${tierLabel}** nations now have a maximum infrastructure cap of **${maxInfra}**.`);

    await interaction.reply({ embeds: [embed] });
  }
};
