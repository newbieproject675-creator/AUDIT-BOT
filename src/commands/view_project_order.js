const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { sortEntries } = require("../audit/projectPlan");
const { projectByKey } = require("../audit/projectCatalog");
const { getSettings } = require("../db");

module.exports = {
  minTier: "member",
  data: new SlashCommandBuilder()
    .setName("view_project_order")
    .setDescription("Show the order projects should be bought in, by city count."),

  async execute(interaction) {
    const settings = getSettings(interaction.guildId);
    const entries = settings.projectPlan?.entries || [];

    if (entries.length === 0) {
      await interaction.reply("No project order has been set yet. An administrator can set one with `/set_project_order`.");
      return;
    }

    const groups = new Map();
    for (const entry of sortEntries(entries)) {
      if (!groups.has(entry.atCity)) groups.set(entry.atCity, []);
      groups.get(entry.atCity).push(projectByKey(entry.key)?.name ?? entry.key);
    }

    const lines = [...groups].map(([city, names]) => `**C${city}** — ${names.join(", ")}`);

    const notes = [];
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
        `A project is due once a nation reaches its city count. If a nation has passed it without buying it, it's "overdue" and recommended first.\n\n` +
          lines.join("\n") +
          (notes.length ? `\n\n*${notes.join(" ")}*` : "")
      );

    await interaction.reply({ embeds: [embed] });
  }
};
