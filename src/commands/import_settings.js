const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

// Fields we're willing to restore from a backup file.
// Audit history and encrypted API keys are deliberately excluded —
// history stays on the server, and keys should never be in a backup file.
const RESTORABLE_FIELDS = [
  "alliance", "mmr", "scores", "gradeThresholds", "passingScore",
  "warchestPolicy", "resourcePolicy", "memberWarchestOverrides",
  "infraCapTiers", "activityLimitHours", "raidPolicy",
  "roleMap", "tierRoles", "tierRoleSync", "autoNotify",
  "scheduledReports", "unscRotation", "auditChannelId", "lastNotified"
];

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("import_settings")
    .setDescription("Restore bot configuration from a previously exported backup file.")
    .addAttachmentOption((opt) =>
      opt.setName("backup_file").setDescription("The .json backup file exported with /export_settings").setRequired(true)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("confirm")
        .setDescription("False = preview what would be restored (safe). True = actually restore it.")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const confirm = interaction.options.getBoolean("confirm");
    const attachment = interaction.options.getAttachment("backup_file");

    if (!attachment.name.endsWith(".json")) {
      await interaction.editReply("❌ That doesn't look like a backup file — it should be a `.json` file exported with `/export_settings`.");
      return;
    }

    // Fetch and parse the backup file
    let importData;
    try {
      const response = await fetch(attachment.url);
      const text = await response.text();
      importData = JSON.parse(text);
    } catch (error) {
      await interaction.editReply(`❌ Couldn't read that file: ${error.message}`);
      return;
    }

    // Basic validation — check it looks like one of our exports
    if (!importData._exportedAt || !importData._version) {
      await interaction.editReply(
        "❌ This doesn't look like a valid TUN Audit Bot backup file. " +
          "Make sure you're uploading a file that was exported with `/export_settings`."
      );
      return;
    }

    const fieldsFound = RESTORABLE_FIELDS.filter((f) => importData[f] !== undefined);
    const exportDate = new Date(importData._exportedAt).toLocaleDateString();

    if (!confirm) {
      const embed = new EmbedBuilder()
        .setTitle("Preview — Import Settings (nothing changed yet)")
        .setColor(0x3498db)
        .setDescription(
          `This backup was exported on **${exportDate}** by **${importData._exportedBy ?? "unknown"}**.\n\n` +
            `**${fieldsFound.length}** configuration field(s) would be restored:\n` +
            fieldsFound.map((f) => `• ${f}`).join("\n") +
            "\n\n**NOT restored** (always kept as-is):\n• auditHistory\n• linkedApiKeys\n\n" +
            "Re-run this command with `confirm: True` to actually apply the restore."
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Apply the restore — keep existing history and API keys
    const currentSettings = getSettings(interaction.guildId);
    const merged = { ...currentSettings };

    for (const field of fieldsFound) {
      merged[field] = importData[field];
    }

    // Always preserve these from the live settings, never from the backup
    merged.auditHistory = currentSettings.auditHistory;
    merged.linkedApiKeys = currentSettings.linkedApiKeys;

    saveSettings(interaction.guildId, merged);

    const embed = new EmbedBuilder()
      .setTitle("✅ Settings Restored")
      .setColor(0x2ecc71)
      .setDescription(
        `Successfully restored **${fieldsFound.length}** configuration field(s) from the backup exported on **${exportDate}**.\n\n` +
          "Your audit history and linked API keys were not affected.\n\n" +
          "⚠️ If any role or channel IDs in the backup no longer exist in this server, commands that use them will need to be reconfigured with the correct IDs."
      );

    await interaction.editReply({ embeds: [embed] });
  }
};
