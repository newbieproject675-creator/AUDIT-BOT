const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags
} = require("discord.js");
const { parsePlanText, formatPlanText, verifyProjectKeys } = require("../audit/projectPlan");
const { projectByKey } = require("../audit/projectCatalog");
const { getSettings, saveSettings } = require("../db");

const MODAL_CUSTOM_ID = "set_project_order_modal";
const INPUT_CUSTOM_ID = "project_order_input";

// If a pasted list has a typo, nothing is saved - but the text is kept here
// so the next /set_project_order opens with it already filled in, and only
// the broken lines need fixing. (Cleared on a successful save or bot restart.)
const unsavedDrafts = new Map();

module.exports = {
  minTier: "administrator",
  modalCustomId: MODAL_CUSTOM_ID,
  data: new SlashCommandBuilder()
    .setName("set_project_order")
    .setDescription("Set the order projects should be bought in, by city count (opens a form)."),

  async execute(interaction) {
    const settings = getSettings(interaction.guildId);
    const saved = formatPlanText(settings.projectPlan?.entries || []);
    const prefill = unsavedDrafts.get(interaction.user.id) ?? saved;

    const input = new TextInputBuilder()
      .setCustomId(INPUT_CUSTOM_ID)
      .setLabel("One project per line: city count - name")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("C5 - Center for Civil Engineering\nC10 - Urban Planning")
      .setRequired(true)
      .setMaxLength(4000);
    if (prefill) input.setValue(prefill.slice(0, 4000));

    const modal = new ModalBuilder()
      .setCustomId(MODAL_CUSTOM_ID)
      .setTitle("Project Order")
      .addComponents(new ActionRowBuilder().addComponents(input));

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const text = interaction.fields.getTextInputValue(INPUT_CUSTOM_ID);
    const { entries, errors } = parsePlanText(text);

    if (errors.length > 0) {
      unsavedDrafts.set(interaction.user.id, text);
      const shown = errors.slice(0, 12).map((e) => `• ${e}`).join("\n");
      const more = errors.length > 12 ? `\n…and ${errors.length - 12} more.` : "";
      await interaction.editReply(
        `❌ **Nothing was saved.** Please fix these lines:\n${shown}${more}\n\n` +
          "Run `/set_project_order` again - your text will still be there, so you only need to fix the lines above."
      );
      return;
    }

    if (entries.length === 0) {
      await interaction.editReply("❌ The list was empty, so nothing was saved.");
      return;
    }

    const settings = getSettings(interaction.guildId);
    settings.projectPlan = { entries, updatedAt: new Date().toISOString() };
    saveSettings(interaction.guildId, settings);
    unsavedDrafts.delete(interaction.user.id);

    // Double-check every project name against the live game data.
    let verification;
    try {
      const unknown = await verifyProjectKeys([...new Set(entries.map((e) => e.key))]);
      if (unknown.length === 0) {
        verification = "✅ Every project name matched the game's data.";
      } else {
        const names = unknown.map((key) => `**${projectByKey(key)?.name ?? key}** (\`${key}\`)`).join(", ");
        verification =
          `⚠️ The game's data didn't recognise: ${names}.\n` +
          "They're saved, but they'll be left out of recommendations (and flagged) until the name is corrected - " +
          "send this message to whoever maintains the bot.";
      }
    } catch (error) {
      verification =
        `⚠️ Saved, but I couldn't double-check the names against the game right now (${error.message}). ` +
        "`/next_project` checks them each time it runs.";
    }

    const cityCounts = new Set(entries.map((e) => e.atCity)).size;
    await interaction.editReply(
      `✅ Saved **${entries.length}** project(s) across **${cityCounts}** city count(s).\n${verification}\n\n` +
        "Use `/view_project_order` to see it, and `/next_project` to check a nation."
    );
  }
};
