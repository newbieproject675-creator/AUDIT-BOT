const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAllianceNations, isActiveMember } = require("../pnw");
const { resolveGuildMember } = require("../audit/resolveDiscordUser");
const { getSettings, saveSettings } = require("../db");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function daysSinceActive(nation) {
  const lastActive = new Date(nation.last_active);
  return (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
}

function chunkLines(lines, maxLength = 1000) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if ((current + "\n" + line).length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : ["None"];
}

module.exports = {
  minTier: "government",
  data: new SlashCommandBuilder()
    .setName("demote_inactive")
    .setDescription("Remove all roles from inactive members and assign them the Defaulter role.")
    .addBooleanOption((opt) =>
      opt
        .setName("confirm")
        .setDescription("False = preview only (safe). True = actually demote.")
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("threshold_days")
        .setDescription("Override the configured threshold for this run only, e.g. 7")
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const confirm = interaction.options.getBoolean("confirm");
    const settings = getSettings(interaction.guildId);

    if (!settings.alliance.id) {
      await interaction.editReply("❌ No alliance registered yet — run /set_alliance first.");
      return;
    }

    const config = settings.inactivityDemotion ?? { thresholdDays: 7, defaulterRoleId: null, protectedRoleIds: [] };
    const thresholdDays = interaction.options.getInteger("threshold_days") ?? config.thresholdDays;

    if (confirm && !config.defaulterRoleId) {
      await interaction.editReply("❌ No Defaulter role configured yet — run /set_demotion_config first.");
      return;
    }

    await interaction.editReply("⏳ Checking all members for inactivity...");

    let members;
    try {
      const result = await getAllianceNations(settings.alliance.id);
      members = result.members;
    } catch (error) {
      await interaction.editReply(`❌ Couldn't fetch alliance nations: ${error.message}`);
      return;
    }

    // Find inactive members and resolve their Discord accounts
    const toProcess = [];
    const noDiscord = [];
    const vmSkipped = [];

    for (const nation of members) {
      // Skip VM nations — they're deliberately paused, not truly inactive
      if (!isActiveMember(nation)) {
        vmSkipped.push(nation);
        continue;
      }

      const days = daysSinceActive(nation);
      if (days < thresholdDays) continue;

      const member = await resolveGuildMember(interaction.guild, nation);
      if (!member) {
        noDiscord.push({ nation, days });
        continue;
      }

      toProcess.push({ nation, member, days: Math.floor(days) });
      await sleep(100);
    }

    if (toProcess.length === 0 && noDiscord.length === 0) {
      await interaction.followUp(`✅ No members have been inactive for more than **${thresholdDays} days**. Nothing to do.`);
      return;
    }

    if (!confirm) {
      // Preview mode — show who would be demoted, no changes made
      const willDemoteLines = toProcess.map(
        ({ nation, member, days }) =>
          `⚠️ **${nation.nation_name}** — ${days} days inactive — <@${member.id}>`
      );
      const noDiscordLines = noDiscord.map(
        ({ nation, days }) => `⏭️ **${nation.nation_name}** — ${days.toFixed(1)} days inactive — no Discord found`
      );

      const embed = new EmbedBuilder()
        .setTitle(`Preview — Demote Inactive (nothing changed)`)
        .setColor(0xf1c40f)
        .setDescription(
          `**${toProcess.length}** member(s) would be demoted (inactive ${thresholdDays}+ days).\n` +
            `**${noDiscord.length}** would be skipped (no Discord linked).\n` +
            `**${vmSkipped.length}** skipped (Vacation Mode).\n\n` +
            "Re-run with `confirm: True` to actually apply."
        );

      chunkLines(willDemoteLines).forEach((chunk, idx) => {
        embed.addFields({ name: idx === 0 ? "Would demote" : "\u200b", value: chunk });
      });
      chunkLines(noDiscordLines).forEach((chunk, idx) => {
        embed.addFields({ name: idx === 0 ? "Would skip (no Discord)" : "\u200b", value: chunk });
      });

      await interaction.followUp({ embeds: [embed] });
      return;
    }

    // Confirm mode — actually demote
    await interaction.followUp(`⏳ Demoting **${toProcess.length}** member(s)...`);

    const demoted = [];
    const errors = [];
    const everyoneId = interaction.guild.id; // @everyone role ID = guild ID

    for (const { nation, member, days } of toProcess) {
      try {
        // Collect roles to remove and remember them for restoration
const rolesToRemove = member.roles.cache
  .filter(
    (role) =>
      role.id !== everyoneId &&
      role.id !== config.defaulterRoleId &&
      !config.protectedRoleIds.includes(role.id)
  );

const removedRoleIds = rolesToRemove.map(role => role.id);

        // Remove all non-protected roles
        if (removedRoleIds.length > 0) {
  await member.roles.remove(removedRoleIds);
}

        // Assign the defaulter role
        await member.roles.add(config.defaulterRoleId);

        demoted.push({
  nation,
  member,
  days,
  removedRoleIds
});
      } catch (error) {
        errors.push({ nation, error: error.message });
        console.error(`Failed to demote ${nation.nation_name}:`, error.message);
      }
      await sleep(500); // be polite to Discord's rate limits
    }

    // Save a log of who was demoted and when
if (!settings.demotionLog) settings.demotionLog = [];

for (const { nation, member, days, removedRoleIds } of demoted) {

  // Remove any previous log for this nation
  settings.demotionLog = settings.demotionLog.filter(
    entry => entry.nationId !== Number(nation.id)
  );

  settings.demotionLog.push({
    nationId: Number(nation.id),
    nationName: nation.nation_name,
    discordId: member.id,
    inactiveDays: days,
    demotedAt: new Date().toISOString(),
    removedRoleIds
  });

}
    // Keep only the last 200 log entries
    if (settings.demotionLog.length > 200) {
      settings.demotionLog = settings.demotionLog.slice(-200);
    }
    saveSettings(interaction.guildId, settings);

    const resultLines = demoted.map(
      ({ nation, member, days }) => `✅ **${nation.nation_name}** (${days}d inactive) — <@${member.id}>`
    );
    const errorLines = errors.map(({ nation, error }) => `❌ **${nation.nation_name}** — ${error}`);
    const skippedLines = noDiscord.map(
      ({ nation, days }) => `⏭️ **${nation.nation_name}** — ${days.toFixed(1)}d inactive, no Discord`
    );

    const embed = new EmbedBuilder()
      .setTitle("Inactivity Demotion Complete")
      .setColor(0xe74c3c)
      .setDescription(
        `Demoted **${demoted.length}** member(s). ` +
          `${errors.length > 0 ? `❌ ${errors.length} error(s). ` : ""}` +
          `⏭️ ${noDiscord.length} skipped (no Discord). ` +
          `🌴 ${vmSkipped.length} skipped (VM).`
      );

    chunkLines(resultLines).forEach((chunk, idx) => {
      embed.addFields({ name: idx === 0 ? "Demoted" : "\u200b", value: chunk });
    });
    if (errorLines.length > 0) {
      chunkLines(errorLines).forEach((chunk, idx) => {
        embed.addFields({ name: idx === 0 ? "Errors" : "\u200b", value: chunk });
      });
    }
    if (skippedLines.length > 0) {
      chunkLines(skippedLines).forEach((chunk, idx) => {
        embed.addFields({ name: idx === 0 ? "Skipped" : "\u200b", value: chunk });
      });
    }

    await interaction.followUp({ embeds: [embed] });
  }
};