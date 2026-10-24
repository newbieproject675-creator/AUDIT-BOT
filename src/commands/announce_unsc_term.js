const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAllianceNations } = require("../pnw");
const { resolveGuildMember } = require("../audit/resolveDiscordUser");
const { getSettings } = require("../db");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  minTier: "government",
  data: new SlashCommandBuilder()
    .setName("announce_unsc_term")
    .setDescription("Post the current UNSC term members without triggering a new selection."),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);
    const config = settings.unscRotation;

    if (!config.nonPermanentRoleId) {
      await interaction.editReply("❌ No non-permanent role configured — run /set_unsc_config first.");
      return;
    }

    if (!settings.alliance.id) {
      await interaction.editReply("❌ No alliance registered yet — run /set_alliance first.");
      return;
    }

    // Get who currently has the non-permanent role in Discord — this is the
    // ground truth of who's actually seated, regardless of saved rosters.
    const role = interaction.guild.roles.cache.get(config.nonPermanentRoleId);
    if (!role) {
      await interaction.editReply("❌ The configured non-permanent role no longer exists in this server.");
      return;
    }

    const seatedMembers = [...role.members.values()];

    if (seatedMembers.length === 0) {
      await interaction.editReply("No members currently have the non-permanent UNSC role.");
      return;
    }

    // Try to match each Discord member back to their PnW nation for display
    await interaction.editReply("⏳ Building announcement...");

    let nations = [];
    try {
      const result = await getAllianceNations(settings.alliance.id);
      nations = result.members;
    } catch (error) {
      // Non-fatal — we can still announce with Discord usernames only
    }

    // Build a lookup of Discord member → nation name
    const nationByDiscordId = {};
    const nationByUsername = {};
    for (const nation of nations) {
      if (nation.discord_id) nationByDiscordId[String(nation.discord_id)] = nation;
      if (nation.discord) nationByUsername[nation.discord.toLowerCase()] = nation;
    }

    const lines = seatedMembers.map((member) => {
      const nation =
        nationByDiscordId[member.id] ||
        nationByUsername[member.user.username.toLowerCase()];
      const nationName = nation ? `**${nation.nation_name}**` : `**${member.displayName}**`;
      return `${nationName} — <@${member.id}>`;
    });

    const termInfo = config.termStartedAt
      ? `Term started <t:${Math.floor(new Date(config.termStartedAt).getTime() / 1000)}:R>`
      : "Term start date not recorded";

    const embed = new EmbedBuilder()
      .setTitle("🪐 Current Non-Permanent UNSC Members")
      .setColor(0x3498db)
      .setDescription(lines.join("\n") + `\n\n${termInfo}. Term length: ${config.intervalDays} days.`)
      .setFooter({ text: `${seatedMembers.length} seat(s) currently filled.` });

    const pingContent = config.pingRoleId ? `<@&${config.pingRoleId}>` : null;

    // Post to the configured announce channel if set, otherwise reply here
    if (config.announceChannelId) {
      const channel = interaction.guild.channels.cache.get(config.announceChannelId);
      if (channel) {
        await channel.send({ content: pingContent, embeds: [embed] });
        await interaction.editReply(`✅ Announcement posted in <#${config.announceChannelId}>.`);
        return;
      }
    }

    await interaction.editReply({ content: pingContent, embeds: [embed] });
  }
};
