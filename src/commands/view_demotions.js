const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings } = require("../db");

function discordTimestamp(iso) {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:F>`;
}

module.exports = {
  minTier: "government",

  data: new SlashCommandBuilder()
    .setName("view_defaulters")
    .setDescription("View all members currently marked as Defaulters."),

  async execute(interaction) {

    const settings = getSettings(interaction.guildId);

    const demotions = settings.demotionLog ?? [];

    if (demotions.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Current Defaulters")
            .setColor(0x2ecc71)
            .setDescription("There are currently **no demoted members**.")
        ]
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Current Defaulters (${demotions.length})`)
      .setColor(0xe67e22)
      .setDescription(
    "These members are currently marked as **Defaulters** due to prolonged inactivity.\nUse `/restore_member` to restore their previous roles."
);

    for (const entry of demotions.slice(0, 25)) {

      const restoredRoles = Array.isArray(entry.removedRoleIds)
        ? entry.removedRoleIds.length
        : 0;

      embed.addFields({
        name: entry.nationName,
        value:
          `👤 <@${entry.discordId}>\n` +
          `📅 Demoted: ${discordTimestamp(entry.demotedAt)}\n` +
          `😴 Inactive: **${entry.inactiveDays} days**\n` +
          `🎭 Saved Roles: **${restoredRoles}**`
      });
    }

    if (demotions.length > 25) {
      embed.setFooter({
        text: `Showing first 25 of ${demotions.length} demoted members.`
      });
    }

    await interaction.reply({
      embeds: [embed]
    });

  }
};