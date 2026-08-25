const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "administrator",

  data: new SlashCommandBuilder()
    .setName("remove_protected_role")
    .setDescription("Remove a protected role from the inactivity demotion system.")
    .addRoleOption((opt) =>
      opt
        .setName("role")
        .setDescription("Protected role to remove")
        .setRequired(true)
    ),

  async execute(interaction) {

    const role = interaction.options.getRole("role");

    const settings = getSettings(interaction.guildId);

    if (!settings.inactivityDemotion) {
      return interaction.reply({
        content: "❌ The inactivity demotion system has not been configured yet.",
        ephemeral: true
      });
    }

    const config = settings.inactivityDemotion;

    if (!config.protectedRoleIds.includes(role.id)) {
      return interaction.reply({
        content: `${role} is not currently a protected role.`,
        ephemeral: true
      });
    }

    config.protectedRoleIds = config.protectedRoleIds.filter(
      id => id !== role.id
    );

    saveSettings(interaction.guildId, settings);

    const embed = new EmbedBuilder()
      .setTitle("Protected Role Removed")
      .setColor(0xe67e22)
      .setDescription(
        `${role} has been removed from the protected role list.`
      );

    if (config.protectedRoleIds.length > 0) {
      embed.addFields({
        name: "Remaining Protected Roles",
        value: config.protectedRoleIds
          .map(id => `<@&${id}>`)
          .join("\n")
      });
    } else {
      embed.addFields({
        name: "Remaining Protected Roles",
        value: "None"
      });
    }

    await interaction.reply({
      embeds: [embed]
    });

  }
};