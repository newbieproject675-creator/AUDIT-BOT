const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { resolveNationInput } = require("../audit/resolveNationInput");
const { fetchNationProjects, buildRecommendations } = require("../audit/projectPlan");
const { getSettings } = require("../db");

const MAX_OVERDUE_SHOWN = 20;

function cityWord(count) {
  return count === 1 ? "city" : "cities";
}

module.exports = {
  minTier: "member",
  data: new SlashCommandBuilder()
    .setName("next_project")
    .setDescription("Show which projects a nation should buy next, overdue ones first.")
    .addStringOption((opt) =>
      opt.setName("nation").setDescription("Nation ID, name, profile link, or @mention").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("How many upcoming projects to show (overdue ones are always listed). Default 3.")
        .setMinValue(1)
        .setMaxValue(10)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);
    const entries = settings.projectPlan?.entries || [];
    if (entries.length === 0) {
      await interaction.editReply("❌ No project order has been set yet. An administrator can set one with `/set_project_order`.");
      return;
    }

    let nationId;
    try {
      nationId = await resolveNationInput(interaction.client, settings, interaction.options.getString("nation"));
    } catch (error) {
      await interaction.editReply(`❌ ${error.message}`);
      return;
    }

    let nation, built, unverified;
    try {
      ({ nation, built, unverified } = await fetchNationProjects(nationId, [...new Set(entries.map((e) => e.key))]));
    } catch (error) {
      await interaction.editReply(`❌ Couldn't fetch that nation's projects: ${error.message}`);
      return;
    }

    const cities = nation.num_cities;
    const upcomingToShow = interaction.options.getInteger("count") ?? 3;
    const rec = buildRecommendations(cities, built, unverified, entries);

    const lines = [
      `**${nation.nation_name}** · C${cities} · ${nation.projects} project(s) built in total`,
      `Plan progress: **${rec.built.length}/${rec.applicable}** planned projects built`
    ];

    if (rec.overdue.length > 0) {
      lines.push("", "⚠️ **Overdue — buy these first**");
      for (const item of rec.overdue.slice(0, MAX_OVERDUE_SHOWN)) {
        const gap = cities - item.atCity;
        lines.push(`• **${item.name}** — was due at C${item.atCity} (overdue by ${gap} ${cityWord(gap)})`);
      }
      if (rec.overdue.length > MAX_OVERDUE_SHOWN) {
        lines.push(`…and ${rec.overdue.length - MAX_OVERDUE_SHOWN} more overdue.`);
      }
    }

    if (rec.upcoming.length > 0) {
      lines.push("", "🟢 **Up next**");
      for (const item of rec.upcoming.slice(0, upcomingToShow)) {
        const gap = item.atCity - cities;
        lines.push(
          gap === 0
            ? `• **${item.name}** — due now (C${item.atCity})`
            : `• **${item.name}** — due at C${item.atCity} (in ${gap} ${cityWord(gap)})`
        );
      }
      if (rec.upcoming.length > upcomingToShow) {
        lines.push(`…and ${rec.upcoming.length - upcomingToShow} more later in the plan.`);
      }
    }

    if (rec.overdue.length === 0 && rec.upcoming.length === 0 && rec.unverified.length === 0) {
      lines.push("", "🎉 Every project in the plan has already been built.");
    }

    if (rec.unverified.length > 0) {
      lines.push(
        "",
        `⚠️ Couldn't check: ${rec.unverified.map((i) => i.name).join(", ")}. The game's data didn't recognise ` +
          "these, so they're left out - please tell an administrator."
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 Next Projects — ${nation.nation_name}`)
      .setColor(rec.overdue.length > 0 ? 0xe67e22 : 0x2ecc71)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Based on /view_project_order. Free project slots and cooldowns aren't checked." });

    await interaction.editReply({ embeds: [embed] });
  }
};
