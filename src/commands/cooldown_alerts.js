const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require("discord.js");
const { resolveNationInput } = require("../audit/resolveNationInput");
const { getMemberTier, meetsTier } = require("../permissions");
const {
  MAX_WATCHED,
  ensureConfig,
  fetchTimers,
  cooldownText,
  nationUrl
} = require("../audit/cooldownAlerts");
const { getSettings, saveSettings } = require("../db");

function parseList(text) {
  return [...new Set(String(text || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean))];
}

function onOff(value) {
  return value ? "🟢 ON" : "🔴 OFF";
}

function timerLine(nation) {
  return `🔬 ${cooldownText(nation.turns_since_last_project)} · 🏙️ ${cooldownText(nation.turns_since_last_city)}`;
}

// Everything that isn't set up yet, in plain words.
function setupWarnings(config) {
  const problems = [];
  if (!config.projectEnabled && !config.cityEnabled) problems.push("both alert types are OFF");
  if (!config.roleId) problems.push("no role is set");
  if (!config.channelId) problems.push("no channel is set");
  if (config.nations.length === 0) problems.push("no nations are being watched");
  return problems.length > 0
    ? `⚠️ Alerts won't be sent yet: ${problems.join(", ")}. Use \`/cooldown_alerts setup\` and \`/cooldown_alerts add\`.`
    : "";
}

function settingsLines(config) {
  return (
    `**Project alerts:** ${onOff(config.projectEnabled)}\n` +
    `**City alerts:** ${onOff(config.cityEnabled)}\n` +
    `**Role to ping:** ${config.roleId ? `<@&${config.roleId}>` : "Not set"}\n` +
    `**Alert channel:** ${config.channelId ? `<#${config.channelId}>` : "Not set"}\n` +
    `**Watched nations:** ${config.nations.length}`
  );
}

module.exports = {
  minTier: "government",
  data: new SlashCommandBuilder()
    .setName("cooldown_alerts")
    .setDescription("Alert a role when watched nations' project or city cooldowns end.")
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Turn project/city alerts on or off and choose the role and channel.")
        .addBooleanOption((opt) => opt.setName("project_alerts").setDescription("Alert when a watched nation can buy a project"))
        .addBooleanOption((opt) => opt.setName("city_alerts").setDescription("Alert when a watched nation can buy a city"))
        .addRoleOption((opt) => opt.setName("role").setDescription("The role to ping"))
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Where to post the alerts").addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add nations to watch. Separate several with commas.")
        .addStringOption((opt) =>
          opt.setName("nations").setDescription("Nation IDs, names or links, separated by commas").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Stop watching nations. Separate several with commas, or type all.")
        .addStringOption((opt) =>
          opt.setName("nations").setDescription("Nation IDs or names, separated by commas - or the word all").setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Show the settings and every watched nation's cooldowns.")),

  async execute(interaction, settings) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const liveSettings = getSettings(interaction.guildId);

    if (sub === "setup" && !meetsTier(getMemberTier(interaction.member, settings), "administrator")) {
      await interaction.editReply("🚫 Only administrators can change the alert settings.");
      return;
    }

    if (sub === "setup") return handleSetup(interaction, liveSettings);
    if (sub === "add") return handleAdd(interaction, liveSettings);
    if (sub === "remove") return handleRemove(interaction, liveSettings);
    return handleList(interaction, liveSettings);
  }
};

async function handleSetup(interaction, settings) {
  const config = ensureConfig(settings);

  const project = interaction.options.getBoolean("project_alerts");
  const city = interaction.options.getBoolean("city_alerts");
  const role = interaction.options.getRole("role");
  const channel = interaction.options.getChannel("channel");

  if (project !== null) config.projectEnabled = project;
  if (city !== null) config.cityEnabled = city;
  if (role) config.roleId = role.id;
  if (channel) config.channelId = channel.id;
  saveSettings(interaction.guildId, settings);

  const warning = setupWarnings(config);
  const embed = new EmbedBuilder()
    .setTitle("Cooldown Alerts Updated")
    .setColor(config.projectEnabled || config.cityEnabled ? 0x2ecc71 : 0xe74c3c)
    .setDescription(
      `${settingsLines(config)}\n\n` +
        "The bot checks every 15 minutes and posts once when a watched nation's cooldown ends." +
        (warning ? `\n\n${warning}` : "")
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleAdd(interaction, settings) {
  const config = ensureConfig(settings);
  const tokens = parseList(interaction.options.getString("nations"));
  if (tokens.length === 0) {
    await interaction.editReply("❌ Give me at least one nation.");
    return;
  }

  const failed = [];
  const ids = [];
  for (const token of tokens) {
    try {
      ids.push(Number(await resolveNationInput(interaction.client, settings, token)));
    } catch (error) {
      failed.push(`${token} — ${error.message}`);
    }
  }

  const uniqueIds = [...new Set(ids)];
  const alreadyWatched = uniqueIds.filter((id) => config.nations.some((n) => Number(n.id) === id));
  const toAdd = uniqueIds.filter((id) => !alreadyWatched.includes(id));

  if (config.nations.length + toAdd.length > MAX_WATCHED) {
    await interaction.editReply(`❌ That would go over the limit of ${MAX_WATCHED} watched nations.`);
    return;
  }

  let found = [];
  if (toAdd.length > 0) {
    try {
      found = await fetchTimers(toAdd);
    } catch (error) {
      await interaction.editReply(`❌ Couldn't look those nations up right now: ${error.message}`);
      return;
    }
  }
  const foundIds = new Set(found.map((n) => Number(n.id)));
  for (const id of toAdd) if (!foundIds.has(id)) failed.push(`ID ${id} — nation not found`);

  for (const nation of found) config.nations.push({ id: Number(nation.id), name: nation.nation_name });
  saveSettings(interaction.guildId, settings);

  const lines = [];
  if (found.length > 0) {
    lines.push(`✅ **Now watching ${found.length} nation(s):**`);
    for (const nation of found) lines.push(`• [${nation.nation_name}](${nationUrl(nation.id)}) — ${timerLine(nation)}`);
  }
  if (alreadyWatched.length > 0) lines.push(`ℹ️ Already watching ${alreadyWatched.length} of them.`);
  if (failed.length > 0) lines.push(`❌ **Couldn't add:**\n${failed.map((f) => `• ${f}`).join("\n")}`);
  const warning = setupWarnings(config);
  if (warning) lines.push("", warning);
  if (found.length > 0) lines.push("", "*Nations that are already ready will be announced at the next check.*");

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Cooldown Watch List").setColor(0x3498db).setDescription(lines.join("\n").slice(0, 4000))]
  });
}

async function handleRemove(interaction, settings) {
  const config = ensureConfig(settings);
  const raw = interaction.options.getString("nations");
  const tokens = parseList(raw);

  if (tokens.length === 1 && tokens[0].toLowerCase() === "all") {
    const count = config.nations.length;
    config.nations = [];
    config.alerted = {};
    saveSettings(interaction.guildId, settings);
    await interaction.editReply(`✅ Stopped watching all ${count} nation(s).`);
    return;
  }

  const removed = [];
  const notFound = [];
  for (const token of tokens) {
    // Match what we already know (ID or saved name) before asking the game.
    let match = config.nations.find(
      (n) => String(n.id) === token || String(n.name).toLowerCase() === token.toLowerCase()
    );
    if (!match) {
      try {
        const id = Number(await resolveNationInput(interaction.client, settings, token));
        match = config.nations.find((n) => Number(n.id) === id);
      } catch (error) {
        // fall through to "not found"
      }
    }
    if (!match) {
      notFound.push(token);
      continue;
    }
    config.nations = config.nations.filter((n) => Number(n.id) !== Number(match.id));
    for (const type of ["project", "city"]) delete config.alerted[`${match.id}:${type}`];
    removed.push(match.name);
  }
  saveSettings(interaction.guildId, settings);

  const lines = [];
  if (removed.length > 0) lines.push(`✅ Stopped watching: ${removed.join(", ")}.`);
  if (notFound.length > 0) lines.push(`❌ Not on the watch list: ${notFound.join(", ")}.`);
  await interaction.editReply(lines.join("\n") || "Nothing to remove.");
}

async function handleList(interaction, settings) {
  const config = ensureConfig(settings);

  const header = settingsLines(config) + (setupWarnings(config) ? `\n\n${setupWarnings(config)}` : "");
  if (config.nations.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("⏰ Cooldown Alerts").setColor(0x3498db).setDescription(header)]
    });
    return;
  }

  let live = [];
  let fetchFailed = false;
  try {
    live = await fetchTimers(config.nations.map((n) => n.id));
  } catch (error) {
    fetchFailed = true;
  }
  const byId = new Map(live.map((n) => [Number(n.id), n]));

  const lines = config.nations.map((saved) => {
    const nation = byId.get(Number(saved.id));
    if (!nation) return `• **${saved.name}** — ${fetchFailed ? "couldn't fetch right now" : "not found in the game"}`;
    const vm = nation.vacation_mode_turns > 0 ? " 🌴 VM" : "";
    return `• [${nation.nation_name}](${nationUrl(nation.id)}) (C${nation.num_cities})${vm} — ${timerLine(nation)}`;
  });

  // One embed per message keeps each safely under Discord's size limit.
  const pages = [];
  let current = "";
  for (const line of lines) {
    if (current && (current + "\n" + line).length > 3500) {
      pages.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) pages.push(current);

  for (let i = 0; i < pages.length; i++) {
    const embed = new EmbedBuilder()
      .setTitle(i === 0 ? "⏰ Cooldown Alerts" : `⏰ Cooldown Alerts (cont. ${i + 1}/${pages.length})`)
      .setColor(0x3498db)
      .setDescription(i === 0 ? `${header}\n\n🔬 = project · 🏙️ = city\n${pages[i]}` : pages[i]);
    if (i === 0) await interaction.editReply({ embeds: [embed] });
    else await interaction.followUp({ embeds: [embed] });
  }
}
