const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings } = require("../db");

module.exports = {
  minTier: "government",

  data: new SlashCommandBuilder()
    .setName("defaulter_status")
    .setDescription("View the current inactivity demotion system configuration."),

  async execute(interaction) {

    const settings = getSettings(interaction.guildId);

    const config = settings.inactivityDemotion ?? {
      thresholdDays: 7,
      defaulterRoleId: null,
      protectedRoleIds: []
    };

    const demotionLog = settings.demotionLog ?? [];

    const embed = new EmbedBuilder()
      .setTitle("Defaulter System Status")
      .setColor(0x3498db)
      .addFields(
        {
          name: "Threshold",
          value: `**${config.thresholdDays}** day(s)`,
          inline: true
        },
        {
          name: "Defaulter Role",
          value: config.defaulterRoleId
            ? `<@&${config.defaulterRoleId}>`
            : "Not Configured",
          inline: true
        },
        {
          name: "Current Defaulters",
          value: `${demotionLog.length}`,
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

    if (demotionLog.length > 0) {

      const latest = demotionLog.reduce((a, b) =>
        new Date(a.demotedAt) > new Date(b.demotedAt) ? a : b
      );

      embed.addFields({
        name: "Last Demotion",
        value:
          `**${latest.nationName}**\n<t:${Math.floor(new Date(latest.demotedAt).getTime() / 1000)}:F>`
      });

    } else {

      embed.addFields({
        name: "Last Demotion",
        value: "None"
      });

    }

    await interaction.reply({
      embeds: [embed]
    });

  }
};