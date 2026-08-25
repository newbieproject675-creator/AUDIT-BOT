const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

// City-count tiers — same as the existing tier system
const MMR_TIER_CHOICES = [
  { name: "C1-C5 (1 to 5 cities)", value: "C1-C5" },
  { name: "C6-C10 (6 to 10 cities)", value: "C6-C10" },
  { name: "C11-C15 (11 to 15 cities)", value: "C11-C15" },
  { name: "C16-C20 (16 to 20 cities)", value: "C16-C20" },
  { name: "C21+ (21 or more cities)", value: "C21+" }
];

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("set_mmr")
    .setDescription("Set the minimum total military building slots per city for a tier. 5 hangars are always mandatory.")
    .addStringOption((opt) => {
      opt.setName("tier").setDescription("Which city-count tier this applies to").setRequired(true);
      for (const choice of MMR_TIER_CHOICES) opt.addChoices(choice);
      return opt;
    })
    .addIntegerOption((opt) =>
      opt
        .setName("min_slots")
        .setDescription("Minimum total military slots per city (5–18). Must include 5 mandatory hangars.")
        .setMinValue(5)
        .setMaxValue(18)
        .setRequired(true)
    ),

  async execute(interaction) {
    const tier = interaction.options.getString("tier");
    const minSlots = interaction.options.getInteger("min_slots");

    const settings = getSettings(interaction.guildId);
    settings.mmr[tier] = { minSlots };
    saveSettings(interaction.guildId, settings);

    // Show what the minimum could look like in practice
    const remainingSlots = minSlots - 5; // 5 always go to hangars
    const embed = new EmbedBuilder()
      .setTitle("MMR Updated")
      .setColor(0x2ecc71)
      .setDescription(
        `**${tier}** nations now need at least **${minSlots} total military slots** per city.\n\n` +
          `**Mandatory:** 5 hangars (always)\n` +
          `**Remaining:** ${remainingSlots} slot(s) freely distributed across barracks, factories, and drydocks\n\n` +
          `Example valid builds: \`5/0/5/${Math.min(remainingSlots, 3)}\`, ` +
          `\`0/${Math.min(remainingSlots, 5)}/5/0\`, ` +
          `\`${Math.min(Math.floor(remainingSlots / 2), 5)}/${Math.min(Math.ceil(remainingSlots / 2), 5)}/5/0\`\n` +
          `Max possible: \`5/5/5/3\` (18 slots)`
      );

    await interaction.reply({ embeds: [embed] });
  }
};
