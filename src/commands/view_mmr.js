const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings } = require("../db");

module.exports = {
  minTier: "member",
  data: new SlashCommandBuilder()
    .setName("view_mmr")
    .setDescription("View the current minimum military slot requirements per city-count tier."),

  async execute(interaction) {
    const settings = getSettings(interaction.guildId);

    const lines = Object.entries(settings.mmr).map(([tier, req]) => {
      const minSlots = req.minSlots ?? "Not set";
      const remaining = typeof req.minSlots === "number" ? req.minSlots - 5 : "?";
      return `**${tier}**: ${minSlots} total slots (5 hangars mandatory + ${remaining} free)`;
    });

    const embed = new EmbedBuilder()
      .setTitle("Current MMR Requirements")
      .setColor(0x3498db)
      .setDescription(
        lines.join("\n") +
          "\n\n**Rules:**\n" +
          "• Every city must have **exactly 5 hangars**\n" +
          "• Total military buildings (barracks + factory + hangar + drydock) must meet the tier minimum\n" +
          "• Remaining slots after hangars are freely distributed (max: 5/5/5/3 = 18 total)"
      );

    await interaction.reply({ embeds: [embed] });
  }
};
