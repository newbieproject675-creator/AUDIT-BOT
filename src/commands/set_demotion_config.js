const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "administrator",

  data: new SlashCommandBuilder()
    .setName("set_demotion_config")
    .setDescription("Configure the inactivity demotion system.")
    .addRoleOption((opt) =>
      opt
        .setName("defaulter_role")
        .setDescription("Role assigned to inactive members")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("threshold_days")
        .setDescription("Days of inactivity before demotion")
        .setMinValue(1)
        .setRequired(false)
    )
    .addRoleOption((opt) =>
      opt
        .setName("protected_role")
        .setDescription("Role that should never be removed during demotion")
        .setRequired(false)
    ),

  async execute(interaction) {

    const settings = getSettings(interaction.guildId);

    if (!settings.inactivityDemotion) {
      settings.inactivityDemotion = {
        thresholdDays: 7,
        defaulterRoleId: null,
        protectedRoleIds: []
      };
    }

    const config = settings.inactivityDemotion;

    const defaulterRole = interaction.options.getRole("defaulter_role");
    const thresholdDays = interaction.options.getInteger("threshold_days");
    const protectedRole = interaction.options.getRole("protected_role");

    if (!defaulterRole && thresholdDays === null && !protectedRole) {
      return interaction.reply({
        content: "❌ You must provide at least one option to update.",
        ephemeral: true
      });
    }

    if (defaulterRole) {
      config.defaulterRoleId = defaulterRole.id;
    }

    if (thresholdDays !== null) {
      config.thresholdDays = thresholdDays;
    }

    if (protectedRole) {

      if (protectedRole.id === config.defaulterRoleId) {
        return interaction.reply({
          content: "❌ The Defaulter role cannot also be a protected role.",
          ephemeral: true
        });
      }

      if (!config.protectedRoleIds.includes(protectedRole.id)) {
        config.protectedRoleIds.push(protectedRole.id);
      }
    }

    saveSettings(interaction.guildId, settings);

    const embed = new EmbedBuilder()
      .setTitle("Inactivity Demotion Configuration Updated")
      .setColor(0x2ecc71)
      .addFields(
        {
          name: "Threshold",
          value: `${config.thresholdDays} day(s)`,
          inline: true
        },
        {
          name: "Defaulter Role",
          value: config.defaulterRoleId
            ? `<@&${config.defaulterRoleId}>`
            : "Not configured",
          inline: true
        },
        {
          name: "Protected Roles",
          value:
            config.protectedRoleIds.length > 0
              ? config.protectedRoleIds.map(id => `<@&${id}>`).join("\n")
              : "None"
        }
      );

    await interaction.reply({ embeds: [embed] });
  }
};