const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  sortEntries,
  rangeLabel,
  continentLabel,
  hasSavedPlan,
  getPlanEntries,
  verifyProjectKeys
} = require("../audit/projectPlan");
const { projectByKey } = require("../audit/projectCatalog");
const { getSettings } = require("../db");

module.exports = {
  minTier: "member",
  data: new SlashCommandBuilder()
    .setName("view_project_order")
    .setDescription("Show the order projects should be bought in, by city range."),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);
    const entries = getPlanEntries(settings);

    if (entries.length === 0) {
      await interaction.editReply("No project order is available. An administrator can set one with `/set_project_order`.");
      return;
    }

    // Group projects that share a city range, in order.
    const groups = new Map();
    for (const entry of sortEntries(entries)) {
      const from = entry.fromCity ?? entry.atCity;
      const label = rangeLabel(from, entry.atCity);
      if (!groups.has(label)) groups.set(label, []);
      const name = projectByKey(entry.key)?.name ?? entry.key;
      groups.get(label).push(entry.continents?.length ? `${name} *(${continentLabel(entry.continents)} only)*` : name);
    }
    const lines = [...groups].map(([label, names]) => `**${label}**\n${names.map((n) => `• ${n}`).join("\n")}`);

    // Check every project name against the live game data.
    let verification = "";
    try {
      const unknown = await verifyProjectKeys([...new Set(entries.map((e) => e.key))]);
      verification =
        unknown.length === 0
          ? "✅ All project names match the game's data."
          : `⚠️ The game's data doesn't recognise: ${unknown
              .map((key) => projectByKey(key)?.name ?? key)
              .join(", ")}. These are left out of recommendations until fixed.`;
    } catch (error) {
      verification = "";
    }

    const notes = [];
    if (!hasSavedPlan(settings)) notes.push("This is the built-in order. An administrator can change it with /set_project_order.");
    if (entries.some((e) => e.key === "activity_center")) {
      notes.push("Activity Center is never recommended to nations above 20 cities.");
    }
    if (settings.projectPlan?.updatedAt) {
      notes.push(`Last updated <t:${Math.floor(new Date(settings.projectPlan.updatedAt).getTime() / 1000)}:R>.`);
    }

    const embed = new EmbedBuilder()
      .setTitle("📋 Project Buying Order")
      .setColor(0x3498db)
      .setDescription(
        "Projects are meant to be bought within their city range. A nation above the range that hasn't bought one has it flagged as overdue, first.\n\n" +
          lines.join("\n\n") +
          (verification ? `\n\n${verification}` : "") +
          (notes.length ? `\n\n*${notes.join(" ")}*` : "")
      );

    await interaction.editReply({ embeds: [embed] });
  }
};
