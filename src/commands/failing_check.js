const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAllianceNations, getAllianceName, resolveAllianceId, isActiveMember } = require("../pnw");
const { ALL_CHECKS } = require("../audit/grandAudit");
const { runChecks } = require("../audit/runAudit");
const { resolveDiscordUser } = require("../audit/resolveDiscordUser");
const { getSettings } = require("../db");

// The check list is built from the real audit checks, so when a check is
// added or renamed it shows up here automatically. Discord allows at most
// 25 choices on one option; we currently have 19 checks.
const CHECK_CHOICES = ALL_CHECKS.slice(0, 25).map((check) => {
  const number = (check.key.match(/^check(\d+)_/) || [])[1];
  return { name: `${number ? number + " - " : ""}${check.label}`.slice(0, 100), value: check.key };
});

// Discord counts the 6000-character cap across ALL embeds in one message,
// so every embed below is sent as its own message to stay safely under it.
const MAX_PAGES = 10;
const MAX_DETAIL_LENGTH = 140;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPoints(points) {
  return Number.isInteger(points) ? String(points) : points.toFixed(2);
}

function shorten(text, maxLength) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength - 3) + "..." : clean;
}

function chunkLines(lines, maxLength = 3500) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if (current && (current + "\n" + line).length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = {
  minTier: "mentor",
  data: new SlashCommandBuilder()
    .setName("failing_check")
    .setDescription("List members who are not at full marks for one specific audit check.")
    .addStringOption((opt) => {
      opt.setName("check").setDescription("Which audit check to look for failures in").setRequired(true);
      for (const choice of CHECK_CHOICES) opt.addChoices(choice);
      return opt;
    })
    .addStringOption((opt) =>
      opt.setName("alliance").setDescription("Check a different alliance by ID, name, or link. Leave blank for your home alliance.")
    )
    .addBooleanOption((opt) =>
      opt.setName("tag_members").setDescription("Also show each nation's Discord mention (slower)")
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);
    const check = ALL_CHECKS.find((c) => c.key === interaction.options.getString("check"));
    if (!check) {
      await interaction.editReply("❌ That audit check wasn't recognised.");
      return;
    }
    const tagMembers = interaction.options.getBoolean("tag_members") ?? false;

    // Same alliance handling as the other bulk commands: ID, name, or link.
    const allianceInput = interaction.options.getString("alliance");
    let targetAllianceId;
    if (allianceInput) {
      try {
        targetAllianceId = await resolveAllianceId(allianceInput);
      } catch (error) {
        await interaction.editReply(`❌ ${error.message}`);
        return;
      }
    } else {
      targetAllianceId = settings.alliance.id;
    }
    if (!targetAllianceId) {
      await interaction.editReply("❌ No alliance registered yet — run /set_alliance first, or provide an alliance.");
      return;
    }

    const allianceName =
      Number(targetAllianceId) === Number(settings.alliance.id)
        ? settings.alliance.name || `Alliance ${targetAllianceId}`
        : await getAllianceName(targetAllianceId);

    await interaction.editReply(`⏳ Checking **${allianceName}** members for **${check.label}**...`);

    let members;
    try {
      const result = await getAllianceNations(targetAllianceId);
      members = result.members;
    } catch (error) {
      await interaction.editReply(`❌ Couldn't fetch alliance nations: ${error.message}`);
      return;
    }

    // Vacation Mode nations are paused, not non-compliant, so they're skipped.
    const active = members.filter(isActiveMember);
    const vmCount = members.length - active.length;

    const failing = [];
    let errorCount = 0;
    for (const nation of active) {
      try {
        // runChecks gives the same earned/max points the full audit uses.
        const [result] = runChecks(nation, [check], settings);
        if (!result.passed) failing.push({ nation, result, tag: null });
      } catch (error) {
        errorCount += 1;
        console.error(`[failing_check] ${check.key} failed for nation ${nation.id}:`, error.message);
      }
    }

    if (failing.length === 0) {
      await interaction.editReply(
        `✅ Every active member of **${allianceName}** is at full marks for **${check.label}**.` +
          (errorCount > 0 ? `\n⚠️ ${errorCount} nation(s) couldn't be checked.` : "")
      );
      return;
    }

    // Worst first: lowest share of points, then alphabetical.
    const share = ({ result }) => (result.maxPoints > 0 ? result.earnedPoints / result.maxPoints : 0);
    failing.sort((a, b) => share(a) - share(b) || a.nation.nation_name.localeCompare(b.nation.nation_name));

    if (tagMembers) {
      for (const entry of failing) {
        try {
          const user = await resolveDiscordUser(interaction.client, interaction.guild, entry.nation);
          entry.tag = user
            ? `<@${user.id}>`
            : entry.nation.discord
              ? `${entry.nation.discord} (not in server)`
              : "no Discord linked";
        } catch (error) {
          entry.tag = "no Discord linked";
        }
        await sleep(100);
      }
    }

    const lines = failing.map(({ nation, result, tag }) => {
      return (
        `• **${nation.nation_name}** (C${nation.num_cities}) — ` +
        `${formatPoints(result.earnedPoints)}/${result.maxPoints} pts${tag ? ` — ${tag}` : ""}\n` +
        `   ↳ ${shorten(result.detail, MAX_DETAIL_LENGTH)}`
      );
    });

    const summary =
      `**${failing.length}** of **${active.length}** active members are not at full marks for **${check.label}**.\n` +
      `*What to fix: ${check.recommendation}*` +
      (vmCount > 0 ? `\n🌴 ${vmCount} member(s) in Vacation Mode were skipped.` : "") +
      (errorCount > 0 ? `\n⚠️ ${errorCount} nation(s) couldn't be checked.` : "");

    const chunks = chunkLines(lines);
    const shown = chunks.slice(0, MAX_PAGES);

    const embeds = shown.map((chunk, idx) =>
      new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `❌ ${check.label} — ${allianceName}`
            : `❌ ${check.label} — ${allianceName} (cont. ${idx + 1}/${shown.length})`
        )
        .setColor(0xe74c3c)
        .setDescription(idx === 0 ? `${summary}\n\n${chunk}` : chunk)
    );

    if (chunks.length > shown.length) {
      embeds[embeds.length - 1].setFooter({
        text: `List cut off after ${shown.length} pages — use /export_audit_report for the full picture.`
      });
    }

    await interaction.editReply({ content: "", embeds: [embeds[0]] });
    for (let i = 1; i < embeds.length; i++) {
      await interaction.followUp({ embeds: [embeds[i]] });
    }
  }
};
