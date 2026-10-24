const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { resolveNationInput } = require("../audit/resolveNationInput");
const { getNation } = require("../pnw");
const { getSettings } = require("../db");

// In PnW, 1 turn = 2 hours. City/project cooldown = 10 days = 120 turns.
const COOLDOWN_TURNS = 120;
const HOURS_PER_TURN = 2;

function formatCountdown(turnsSinceLast) {
  const turnsRemaining = COOLDOWN_TURNS - turnsSinceLast;
  if (turnsRemaining <= 0) return { ready: true, text: "✅ Ready now!" };
  const hoursLeft = turnsRemaining * HOURS_PER_TURN;
  const days = Math.floor(hoursLeft / 24);
  const hours = hoursLeft % 24;
  const readyAt = new Date(Date.now() + hoursLeft * 60 * 60 * 1000);
  const readyTimestamp = Math.floor(readyAt.getTime() / 1000);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  return {
    ready: false,
    text: `⏳ ${parts.join(" ")} remaining (ready <t:${readyTimestamp}:R> on <t:${readyTimestamp}:F>)`
  };
}

module.exports = {
  minTier: "member",
  data: new SlashCommandBuilder()
    .setName("city_project_timer")
    .setDescription("Check when a nation can next buy a city or project.")
    .addStringOption((opt) =>
      opt.setName("nation").setDescription("Nation ID, name, profile link, or @mention").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const settings = getSettings(interaction.guildId);
    let nationId;
    try {
      nationId = await resolveNationInput(interaction.client, settings, interaction.options.getString("nation"));
    } catch (error) {
      await interaction.editReply(`❌ ${error.message}`);
      return;
    }

    let nation;
    try {
      nation = await getNation(nationId);
    } catch (error) {
      await interaction.editReply(`❌ Couldn't fetch that nation: ${error.message}`);
      return;
    }

    const cityStatus = formatCountdown(nation.turns_since_last_city ?? 0);
    const projectStatus = formatCountdown(nation.turns_since_last_project ?? 0);

    const embed = new EmbedBuilder()
      .setTitle(`⏱️ City & Project Timer — ${nation.nation_name}`)
      .setColor(cityStatus.ready && projectStatus.ready ? 0x2ecc71 : 0xe67e22)
      .setDescription(`**Cities:** ${nation.num_cities} | **Projects:** ${nation.projects}`)
      .addFields(
        {
          name: "🏙️ Next City",
          value:
            `${cityStatus.text}\n` +
            `Turns since last city: ${nation.turns_since_last_city ?? 0}/${COOLDOWN_TURNS}`
        },
        {
          name: "🔬 Next Project",
          value:
            `${projectStatus.text}\n` +
            `Turns since last project: ${nation.turns_since_last_project ?? 0}/${COOLDOWN_TURNS}`
        }
      )
      .setFooter({ text: "1 turn = 2 hours • Cooldown = 120 turns (10 days)" });

    await interaction.editReply({ embeds: [embed] });
  }
};
