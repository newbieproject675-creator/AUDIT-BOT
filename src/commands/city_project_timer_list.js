const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAllianceNations, isActiveMember } = require("../pnw");
const { getSettings } = require("../db");

const COOLDOWN_TURNS = 120;
const HOURS_PER_TURN = 2;

function turnsRemaining(turnsSinceLast) {
  return Math.max(0, COOLDOWN_TURNS - (turnsSinceLast ?? 0));
}

function formatTimer(turnsSinceLast) {
  const remaining = turnsRemaining(turnsSinceLast);
  if (remaining === 0) return "✅ Ready";
  const hoursLeft = remaining * HOURS_PER_TURN;
  const days = Math.floor(hoursLeft / 24);
  const hours = hoursLeft % 24;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  return `⏳ ${parts.join(" ")}`;
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
  return chunks.length > 0 ? chunks : ["None."];
}

module.exports = {
  minTier: "mentor",
  data: new SlashCommandBuilder()
    .setName("city_project_timer_list")
    .setDescription("List all alliance members with their city and project cooldown status.")
    .addStringOption((opt) =>
      opt
        .setName("filter")
        .setDescription("Which nations to show")
        .addChoices(
          { name: "All members", value: "all" },
          { name: "City ready now", value: "city_ready" },
          { name: "Project ready now", value: "project_ready" },
          { name: "Both ready now", value: "both_ready" }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);
    if (!settings.alliance.id) {
      await interaction.editReply("❌ No alliance registered yet — run /set_alliance first.");
      return;
    }

    const filter = interaction.options.getString("filter") ?? "all";
    await interaction.editReply("⏳ Fetching timer data for all members...");

    let members;
    try {
      const result = await getAllianceNations(settings.alliance.id);
      members = result.members.filter(isActiveMember);
    } catch (error) {
      await interaction.editReply(`❌ Couldn't fetch alliance nations: ${error.message}`);
      return;
    }

    // Apply filter
    let filtered = members;
    if (filter === "city_ready") filtered = members.filter((n) => turnsRemaining(n.turns_since_last_city) === 0);
    else if (filter === "project_ready") filtered = members.filter((n) => turnsRemaining(n.turns_since_last_project) === 0);
    else if (filter === "both_ready") filtered = members.filter(
      (n) => turnsRemaining(n.turns_since_last_city) === 0 && turnsRemaining(n.turns_since_last_project) === 0
    );

    if (filtered.length === 0) {
      await interaction.followUp(`No members match the filter **${filter}** right now.`);
      return;
    }

    // Sort: ready first, then by soonest eligible
    filtered.sort((a, b) => {
      const aCity = turnsRemaining(a.turns_since_last_city);
      const bCity = turnsRemaining(b.turns_since_last_city);
      const aProj = turnsRemaining(a.turns_since_last_project);
      const bProj = turnsRemaining(b.turns_since_last_project);
      // Sort by whichever timer is smaller (more urgent) first
      return Math.min(aCity, aProj) - Math.min(bCity, bProj);
    });

    const lines = filtered.map((nation) => {
      const cityTimer = formatTimer(nation.turns_since_last_city);
      const projTimer = formatTimer(nation.turns_since_last_project);
      return (
        `**${nation.nation_name}** (C${nation.num_cities}) — ` +
        `🏙️ City: ${cityTimer} | 🔬 Project: ${projTimer}`
      );
    });

    const filterLabels = {
      all: "All Members",
      city_ready: "City Ready Now",
      project_ready: "Project Ready Now",
      both_ready: "Both City & Project Ready"
    };

    const readyCity = members.filter((n) => turnsRemaining(n.turns_since_last_city) === 0).length;
    const readyProject = members.filter((n) => turnsRemaining(n.turns_since_last_project) === 0).length;

    const embed = new EmbedBuilder()
      .setTitle(`⏱️ City & Project Timers — ${settings.alliance.name}`)
      .setColor(0x3498db)
      .setDescription(
        `**Filter:** ${filterLabels[filter]} | **Showing:** ${filtered.length} member(s)\n` +
          `🏙️ **${readyCity}** can buy a city now | 🔬 **${readyProject}** can buy a project now`
      );

    chunkLines(lines).forEach((chunk, idx) => {
      embed.addFields({ name: idx === 0 ? "Members" : "\u200b", value: chunk });
    });

    await interaction.followUp({ embeds: [embed] });
  }
};
