const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require("discord.js");
const { getSettings, saveSettings } = require("../db");

const IA_DEFAULTS = {
  enabled: false,
  windowDays: 28,
  minAudits: 7,
  failureRateThreshold: 75,
  iaRoleId: null,
  iaChannelId: null,
  cooldownDays: 7,
  lastRunAt: null,
  lastAlertedNations: {}
};

const DA_DEFAULTS = { enabled: false, lastRunAt: null };

module.exports = {
  minTier: "administrator",
  data: new SlashCommandBuilder()
    .setName("set_ia_config")
    .setDescription("Configure the IA removal recommendation system.")
    .addBooleanOption((opt) => opt.setName("enabled").setDescription("Turn IA alerts on or off"))
    .addBooleanOption((opt) => opt.setName("daily_audit_enabled").setDescription("Turn the silent daily audit on or off"))
    .addIntegerOption((opt) => opt.setName("window_days").setDescription("How many days of history to analyse, e.g. 28").setMinValue(7))
    .addIntegerOption((opt) => opt.setName("min_audits").setDescription("Minimum audits required before a recommendation, e.g. 7").setMinValue(1))
    .addIntegerOption((opt) => opt.setName("failure_rate").setDescription("% of audits failing to trigger a recommendation, e.g. 75").setMinValue(1).setMaxValue(100))
    .addIntegerOption((opt) => opt.setName("cooldown_days").setDescription("Days before re-alerting on the same nation, e.g. 7").setMinValue(1))
    .addRoleOption((opt) => opt.setName("ia_role").setDescription("The IA Minister role to ping"))
    .addChannelOption((opt) => opt.setName("ia_channel").setDescription("Channel to post recommendations in").addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    const settings = getSettings(interaction.guildId);

    // Initialise blocks if missing (handles guilds that existed before
    // these settings were added and haven't run db.js migration yet)
    if (!settings.iaAlerts) settings.iaAlerts = { ...IA_DEFAULTS };
    if (!settings.iaAlerts.lastAlertedNations) settings.iaAlerts.lastAlertedNations = {};
    if (!settings.dailyAudit) settings.dailyAudit = { ...DA_DEFAULTS };

    const ia = settings.iaAlerts;
    const da = settings.dailyAudit;

    const enabled = interaction.options.getBoolean("enabled");
    const dailyEnabled = interaction.options.getBoolean("daily_audit_enabled");
    const windowDays = interaction.options.getInteger("window_days");
    const minAudits = interaction.options.getInteger("min_audits");
    const failureRate = interaction.options.getInteger("failure_rate");
    const cooldownDays = interaction.options.getInteger("cooldown_days");
    const iaRole = interaction.options.getRole("ia_role");
    const iaChannel = interaction.options.getChannel("ia_channel");

    if (enabled !== null) ia.enabled = enabled;
    if (dailyEnabled !== null) da.enabled = dailyEnabled;
    if (windowDays !== null) ia.windowDays = windowDays;
    if (minAudits !== null) ia.minAudits = minAudits;
    if (failureRate !== null) ia.failureRateThreshold = failureRate;
    if (cooldownDays !== null) ia.cooldownDays = cooldownDays;
    if (iaRole) ia.iaRoleId = iaRole.id;
    if (iaChannel) ia.iaChannelId = iaChannel.id;

    saveSettings(interaction.guildId, settings);

    const embed = new EmbedBuilder()
      .setTitle("IA Alert Configuration Updated")
      .setColor(ia.enabled ? 0x2ecc71 : 0xe74c3c)
      .setDescription(
        `**IA Alerts:** ${ia.enabled ? "ON" : "OFF"}\n` +
          `**Silent Daily Audit:** ${da.enabled ? "ON" : "OFF"}\n\n` +
          `**Analysis window:** ${ia.windowDays} days\n` +
          `**Min audits required:** ${ia.minAudits}\n` +
          `**Failure rate threshold:** ${ia.failureRateThreshold}%\n` +
          `**Alert cooldown:** ${ia.cooldownDays} days\n` +
          `**IA role:** ${ia.iaRoleId ? `<@&${ia.iaRoleId}>` : "Not set"}\n` +
          `**IA channel:** ${ia.iaChannelId ? `<#${ia.iaChannelId}>` : "Not set"}\n\n` +
          "💡 The daily audit must be ON for IA alerts to have enough data to work accurately."
      );

    await interaction.reply({ embeds: [embed] });
  }
};
