const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

const RESOURCE_CHOICES = [
  { name: "Money", value: "money" },
  { name: "Food", value: "food" },
  { name: "Coal", value: "coal" },
  { name: "Oil", value: "oil" },
  { name: "Uranium", value: "uranium" },
  { name: "Lead", value: "lead" },
  { name: "Iron", value: "iron" },
  { name: "Bauxite", value: "bauxite" },
  { name: "Gasoline", value: "gasoline" },
  { name: "Munitions", value: "munitions" },
  { name: "Steel", value: "steel" },
  { name: "Aluminum", value: "aluminum" }
];

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("set_warchest_policy")
    .setDescription("Set the maximum per-city warchest target for a resource, and configure the low-warchest floor.")
    .addStringOption((opt) => {
      opt.setName("resource").setDescription("Which resource to configure").setRequired(true);
      for (const choice of RESOURCE_CHOICES) opt.addChoices(choice);
      return opt;
    })
    .addNumberOption((opt) =>
      opt.setName("amount_per_city").setDescription("Maximum allowed amount per city (the target ceiling)")
    )
    .addNumberOption((opt) =>
      opt
        .setName("under_divisor")
        .setDescription("How many times below target triggers a low-warchest fail. Default 4 (target÷4 is the floor).")
        .setMinValue(1)
    ),

  async execute(interaction) {
    const resource = interaction.options.getString("resource");
    const amountPerCity = interaction.options.getNumber("amount_per_city");
    const underDivisor = interaction.options.getNumber("under_divisor");

    if (amountPerCity === null && underDivisor === null) {
      await interaction.reply({ content: "❌ Provide at least one of: amount_per_city or under_divisor.", ephemeral: true });
      return;
    }

    const settings = getSettings(interaction.guildId);

    if (amountPerCity !== null) settings.warchestPolicy[resource] = amountPerCity;
    if (underDivisor !== null) settings.warchestUnderDivisor = underDivisor;

    saveSettings(interaction.guildId, settings);

    const currentDivisor = settings.warchestUnderDivisor ?? 4;
    const currentTarget = settings.warchestPolicy[resource];

    const embed = new EmbedBuilder()
      .setTitle("Warchest Policy Updated")
      .setColor(0x2ecc71)
      .setDescription(
        `**Resource:** ${resource}\n` +
          (amountPerCity !== null ? `**Target (max):** ${amountPerCity.toLocaleString()} per city\n` : "") +
          (underDivisor !== null ? `**Low-warchest divisor:** ${underDivisor}\n` : "") +
          `\n**How Check 14 now works for ${resource}:**\n` +
          (currentTarget
            ? `• Below ${Math.floor(currentTarget / currentDivisor).toLocaleString()}/city (target ÷ ${currentDivisor}) → ❌ Dangerously low warchest\n` +
              `• ${Math.floor(currentTarget / currentDivisor).toLocaleString()} to ${currentTarget.toLocaleString()}/city → ✅ Pass\n` +
              `• Above ${currentTarget.toLocaleString()}/city → ❌ Excess — deposit in alliance bank`
            : "Set an amount_per_city to see the thresholds.")
      );

    await interaction.reply({ embeds: [embed] });
  }
};
