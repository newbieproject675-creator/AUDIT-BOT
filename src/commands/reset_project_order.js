const { SlashCommandBuilder } = require("discord.js");
const { hasSavedPlan, getPlanEntries } = require("../audit/projectPlan");
const { getSettings, saveSettings } = require("../db");

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("reset_project_order")
    .setDescription("Delete your saved project order and go back to the bot's built-in order.")
    .addBooleanOption((opt) =>
      opt
        .setName("confirm")
        .setDescription("False = just explain what would happen. True = actually delete the saved order.")
        .setRequired(true)
    ),

  async execute(interaction) {
    const confirm = interaction.options.getBoolean("confirm");
    const settings = getSettings(interaction.guildId);

    if (!hasSavedPlan(settings)) {
      await interaction.reply("There's no saved project order to delete - the bot is already using its built-in order.");
      return;
    }

    const savedCount = settings.projectPlan.entries.length;
    const builtInCount = getPlanEntries({}).length;

    if (!confirm) {
      await interaction.reply(
        `This would delete your saved project order (**${savedCount}** projects) and switch the bot back to its built-in order (**${builtInCount}** projects).\n` +
          "Nothing has been changed yet - run the command again with `confirm: True` to do it."
      );
      return;
    }

    delete settings.projectPlan;
    saveSettings(interaction.guildId, settings);

    await interaction.reply(
      `✅ Your saved project order was deleted. The bot is back on its built-in order (**${builtInCount}** projects).\n` +
        "Use `/view_project_order` to see it, or `/set_project_order` to customise it again."
    );
  }
};
