const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "government",

  data: new SlashCommandBuilder()
    .setName("restore_member")
    .setDescription("Restore a previously demoted member's roles.")
    .addUserOption((opt) =>
      opt
        .setName("member")
        .setDescription("Member to restore")
        .setRequired(true)
    ),

  async execute(interaction) {

    const member = interaction.options.getMember("member");

    if (!member) {
      return interaction.reply({
        content: "❌ That member isn't in this server.",
        ephemeral: true
      });
    }

    const settings = getSettings(interaction.guildId);

    if (!settings.demotionLog || settings.demotionLog.length === 0) {
      return interaction.reply({
        content: "❌ No demotion records exist.",
        ephemeral: true
      });
    }

    const log = settings.demotionLog.find(
      entry => entry.discordId === member.id
    );

    if (!log) {
      return interaction.reply({
        content: "❌ That member is not recorded as demoted.",
        ephemeral: true
      });
    }

    const config = settings.inactivityDemotion;

    try {

      // Remove Defaulter role
      if (
        config.defaulterRoleId &&
        member.roles.cache.has(config.defaulterRoleId)
      ) {
        await member.roles.remove(config.defaulterRoleId);
      }

      // Restore previous roles
      if (Array.isArray(log.removedRoleIds) && log.removedRoleIds.length > 0) {

        const validRoles = log.removedRoleIds.filter(id =>
          interaction.guild.roles.cache.has(id)
        );

        if (validRoles.length > 0) {
          await member.roles.add(validRoles);
        }
      }

      // Remove log entry
      settings.demotionLog = settings.demotionLog.filter(
        entry => entry.discordId !== member.id
      );

      saveSettings(interaction.guildId, settings);

      const embed = new EmbedBuilder()
        .setTitle("Member Restored")
        .setColor(0x2ecc71)
        .setDescription(
          `Successfully restored **${member.user.tag}**.\n\n` +
          `Previous roles have been reapplied and the Defaulter role removed.`
        );

      await interaction.reply({ embeds: [embed] });

    } catch (error) {

      console.error(error);

      await interaction.reply({
        content: `❌ Failed to restore member.\n\`${error.message}\``,
        ephemeral: true
      });

    }

  }
};