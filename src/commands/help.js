const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

// ── Category definitions ────────────────────────────────────────────────────
// Each category has a label (shown on the button), a colour, an emoji, and
// an explicit list of commands. Commands appear in the order listed here.
// Adding a new command? Just add its name to the relevant category list below.

const CATEGORIES = [
  {
    id: "audit",
    label: "Audit Commands",
    emoji: "🔍",
    color: 0x3498db,
    commands: [
      "grand_audit", "infrastructure_land", "build_slots_project",
      "others", "my_audit", "audit_history"
    ]
  },
  {
    id: "alliance",
    label: "Alliance-Wide",
    emoji: "📊",
    color: 0x9b59b6,
    commands: [
      "government_audit", "mentor_dashboard", "failing_nations",
      "leaderboard", "tier_audit", "alliance_status",
      "export_audit_report", "auto_grand_audit",
      "member_list", "unlinked_members", "alliance_test"
    ]
  },
  {
    id: "notifications",
    label: "Notifications",
    emoji: "📣",
    color: 0xe67e22,
    commands: [
      "notify_failing_nations",
      "set_auto_notify", "set_auto_notify_tier", "view_auto_notify_tiers", "run_auto_notify",
      "set_scheduled_reports", "run_scheduled_reports"
    ]
  },

{
  id: "defaulters",
  label: "Defaulter System",
  emoji: "🚫",
  color: 0xc0392b,
  commands: [
    "set_demotion_config",
    "remove_protected_role",
    "defaulter_status",
    "demote_inactive",
    "restore_member",
    "view_defaulters"
  ]
},

  {
    id: "tier_roles",
    label: "Tier Roles",
    emoji: "🎭",
    color: 0x1abc9c,
    commands: [
      "set_tier_role", "view_tier_roles",
      "set_tier_role_sync", "run_tier_role_sync"
    ]
  },
  {
    id: "unsc",
    label: "UNSC Rotation",
    emoji: "🪐",
    color: 0x2c3e50,
    commands: [
      "set_unsc_config", "view_unsc_config",
      "preview_unsc_rotation", "run_unsc_rotation"
    ]
  },
  {
    id: "config",
    label: "Configuration",
    emoji: "⚙️",
    color: 0x95a5a6,
    commands: [
      "set_alliance", "set_mmr", "view_mmr",
      "set_audit_score", "view_scores",
      "set_grade_thresholds", "view_grade_thresholds",
      "set_warchest_policy", "set_resource_policy",
      "set_member_warchest", "view_member_warchest", "remove_member_warchest",
      "set_audit_channel", "set_activity_limit", "set_raid_policy",
      "set_role", "remove_role", "list_roles",
      "reset_audit_settings", "prune_audit_history"
    ]
  },
  {
    id: "api_keys",
    label: "API Key Tools",
    emoji: "🔑",
    color: 0xe74c3c,
    commands: [
      "link_api_key", "unlink_api_key", "api_key_status"
    ]
  },
  {
    id: "utility",
    label: "Utility",
    emoji: "🛠️",
    color: 0x7f8c8d,
    commands: [
      "help", "api_test", "view_mmr", "view_scores",
      "view_grade_thresholds", "view_tier_roles",
      "view_auto_notify_tiers", "view_member_warchest", "view_unsc_config"
    ]
  }
];

// Button custom IDs for each category
function buttonId(categoryId) {
  return `help_cat_${categoryId}`;
}

// The intro embed shown on first /help
function buildIntroEmbed() {
  return new EmbedBuilder()
    .setTitle("📖 TUN Audit Bot — Help")
    .setColor(0x3498db)
    .setDescription(
      "Click a category button below to see its commands.\n\n" +
        "💡 **Nation fields** accept an ID, name, profile link, or @mention.\n" +
        "💡 **Alliance fields** accept an ID, name, or page link — case-insensitive.\n" +
        "💡 **Permission tiers**: 🟢 Member · 🟡 Mentor · 🔵 Government · 🔴 Administrator"
    );
}

// Builds the category embed for a chosen category
function buildCategoryEmbed(category, commandMap) {
  const TIER_EMOJI = { member: "🟢", mentor: "🟡", government: "🔵", administrator: "🔴" };

  const lines = category.commands
    .filter((name) => commandMap[name])
    .map((name) => {
      const cmd = commandMap[name];
      return `${TIER_EMOJI[cmd.tier] ?? "⚪"} **/${name}** — ${cmd.desc}`;
    });

  return new EmbedBuilder()
    .setTitle(`${category.emoji} ${category.label}`)
    .setColor(category.color)
    .setDescription(lines.join("\n") || "No commands in this category.");
}

// Discord allows max 5 buttons per ActionRow and max 5 rows per message (25 total).
// We have 8 categories — fits in 2 rows of 4 and 4.
function buildButtonRows(activeCategoryId) {
  const rows = [];
  const CHUNK_SIZE = 4;
  for (let i = 0; i < CATEGORIES.length; i += CHUNK_SIZE) {
    const chunk = CATEGORIES.slice(i, i + CHUNK_SIZE);
    const row = new ActionRowBuilder().addComponents(
      chunk.map((cat) =>
        new ButtonBuilder()
          .setCustomId(buttonId(cat.id))
          .setLabel(cat.label)
          .setEmoji(cat.emoji)
          .setStyle(cat.id === activeCategoryId ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );
    rows.push(row);
  }
  return rows;
}

// Build the command lookup map from all loaded command files
function buildCommandMap(commands) {
  const map = {};
  for (const command of commands.values()) {
    map[command.data.name] = {
      desc: command.data.description,
      tier: command.minTier ?? "member"
    };
  }
  return map;
}

// ── Module export ───────────────────────────────────────────────────────────

module.exports = {
  minTier: "member",
  buttonPrefix: "help_cat_",

  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show every command the bot has and what it does."),

  async execute(interaction) {
    const { loadCommands } = require("../loadCommands");
    const commands = loadCommands();
    const commandMap = buildCommandMap(commands);

    await interaction.reply({
      embeds: [buildIntroEmbed()],
      components: buildButtonRows(null),
      flags: MessageFlags.Ephemeral
    });

    // Store command map on the interaction for button handler use — but
    // since each button interaction is a separate event, we re-build from
    // the live command list each time (always up to date, no stale cache).
  },

  // Called from index.js when a help category button is clicked
  async handleButton(interaction) {
    const categoryId = interaction.customId.replace("help_cat_", "");
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return;

    const { loadCommands } = require("../loadCommands");
    const commands = loadCommands();
    const commandMap = buildCommandMap(commands);

    await interaction.update({
      embeds: [buildCategoryEmbed(category, commandMap)],
      components: buildButtonRows(categoryId)
    });
  }
};
