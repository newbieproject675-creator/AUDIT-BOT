const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings } = require("../db");

module.exports = {
  minTier: "member",
  data: new SlashCommandBuilder()
    .setName("view_infra_cap")
    .setDescription("View the current maximum infrastructure cap for each city-count tier."),

  async execute(interaction) {
    const settings = getSettings(interaction.guildId);
    const caps = settings.infraCapTiers || { c1_c14: 1300, c15_c19: 1500, c20_plus: 2000 };

    const embed = new EmbedBuilder()
      .setTitle("Infrastructure Cap Settings")
      .setColor(0x3498db)
      .setDescription(
        `**C1-C14** (cities 1–14): ${caps.c1_c14} max infra\n` +
          `**C15-C19** (cities 15–19): ${caps.c15_c19} max infra\n` +
          `**C20+** (city 20 and above): ${caps.c20_plus} max infra\n\n` +
          "Use `/set_infra_cap` to change any of these."
      );

    await interaction.reply({ embeds: [embed] });
  }
};
