const { SlashCommandBuilder } = require("discord.js");
const { getNation } = require("../pnw");

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("api_test")
    .setDescription("[Debug] Dump raw nation data from the PnW API.")
    .addIntegerOption((opt) =>
      opt.setName("nation_id").setDescription("The Politics & War nation ID to test").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const nation = await getNation(interaction.options.getInteger("nation_id"));
      await interaction.editReply(
        `✅ API test succeeded:\n\`\`\`json\n${JSON.stringify(nation, null, 2)}\n\`\`\``
      );
    } catch (error) {
      await interaction.editReply(
        `❌ API test failed:\n\`\`\`${error.message}\`\`\`\nCopy this whole message and send it back so it can be fixed.`
      );
    }
  }
};
