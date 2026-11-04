// cooldownAlerts.js
//
// Watches a list of nations and pings a role the moment one of them can buy
// its next project and/or city (so staff can fund them without being asked).
//
// How it avoids spamming: each watched nation gets ONE alert per cooldown.
// The alert is remembered ("alerted") while the nation stays ready, and
// forgotten as soon as the nation's cooldown is running again (i.e. it bought
// something), so the next expiry alerts again.
//
// Settings live in settings.cooldownAlerts:
//   { projectEnabled, cityEnabled, roleId, channelId,
//     nations: [{ id, name }], alerted: { "nationId:project": true }, lastRunAt }

const { EmbedBuilder } = require("discord.js");
const { queryPNW } = require("../pnw");
const { getPlanEntries, fetchNationProjects, buildRecommendations } = require("./projectPlan");

const COOLDOWN_TURNS = 120; // 10 days
const HOURS_PER_TURN = 2;
const MAX_WATCHED = 100;
const MAX_HINT_LOOKUPS = 10; // "next project" suggestions per run, to keep API use small

// Creates the settings block if this server doesn't have one yet.
function ensureConfig(settings) {
  const merged = {
    projectEnabled: false,
    cityEnabled: false,
    roleId: null,
    channelId: null,
    nations: [],
    alerted: {},
    lastRunAt: null,
    ...(settings.cooldownAlerts || {})
  };
  if (!Array.isArray(merged.nations)) merged.nations = [];
  if (!merged.alerted || typeof merged.alerted !== "object") merged.alerted = {};
  settings.cooldownAlerts = merged;
  return merged;
}

const TIMER_QUERY = `
  query CooldownTimers($id: [Int]) {
    nations(id: $id, first: 50) {
      data { id nation_name num_cities turns_since_last_city turns_since_last_project vacation_mode_turns }
    }
  }
`;

async function fetchTimers(ids) {
  const found = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await queryPNW(TIMER_QUERY, { id: ids.slice(i, i + 50).map(Number) });
    found.push(...(data?.nations?.data || []));
  }
  return found;
}

// "ready now" or "3d 4h".
function cooldownText(turnsSince) {
  const remaining = COOLDOWN_TURNS - Number(turnsSince ?? 0);
  if (remaining <= 0) return "ready now";
  const hours = remaining * HOURS_PER_TURN;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return [days ? `${days}d` : "", rest ? `${rest}h` : ""].filter(Boolean).join(" ");
}

function nationUrl(id) {
  return `https://politicsandwar.com/nation/id=${id}`;
}

// Best-effort: what the project plan says this nation should buy next.
async function nextProjectHint(nationId, settings) {
  try {
    const entries = getPlanEntries(settings);
    const { nation, built, unverified } = await fetchNationProjects(nationId, [...new Set(entries.map((e) => e.key))]);
    const rec = buildRecommendations({ numCities: nation.num_cities, continent: nation.continent }, built, unverified, entries);
    const pick = rec.overdue[0] ?? rec.upcoming.find((item) => item.inRange) ?? rec.upcoming[0];
    if (!pick) return null;
    if (rec.overdue[0]) return `⚠️ overdue in plan: **${pick.name}**`;
    return pick.inRange ? `next in plan: **${pick.name}**` : `next in plan: **${pick.name}** (from C${pick.fromCity})`;
  } catch (error) {
    return null;
  }
}

// Groups alert lines into messages that stay well under Discord's size limits.
function batchItems(items, maxLength = 3500) {
  const batches = [];
  let current = [];
  let length = 0;
  for (const item of items) {
    if (current.length > 0 && length + item.line.length + 1 > maxLength) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(item);
    length += item.line.length + 1;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function runCooldownAlertsForGuild(client, guild, settings) {
  const config = ensureConfig(settings);
  const stats = { checked: 0, alertsSent: 0, errors: 0 };

  const kinds = [];
  if (config.projectEnabled) kinds.push({ type: "project", field: "turns_since_last_project" });
  if (config.cityEnabled) kinds.push({ type: "city", field: "turns_since_last_city" });
  if (kinds.length === 0 || !config.roleId || !config.channelId || config.nations.length === 0) return stats;

  const channel = guild.channels.cache.get(config.channelId);
  if (!channel) {
    stats.errors += 1;
    return stats;
  }

  const nations = await fetchTimers(config.nations.map((n) => n.id));
  stats.checked = nations.length;

  // Which nations just became ready (and haven't been alerted for this cooldown)?
  const newlyReady = [];
  for (const nation of nations) {
    if (nation.vacation_mode_turns > 0) continue; // can't buy anything in Vacation Mode
    for (const { type, field } of kinds) {
      const key = `${nation.id}:${type}`;
      if (Number(nation[field]) >= COOLDOWN_TURNS) {
        if (!config.alerted[key]) newlyReady.push({ nation, type, key });
      } else {
        delete config.alerted[key]; // cooldown is running again - alert next time it ends
      }
    }
  }
  if (newlyReady.length === 0) return stats;

  let hintLookups = 0;
  for (const item of newlyReady) {
    const base = `[${item.nation.nation_name}](${nationUrl(item.nation.id)}) · C${item.nation.num_cities}`;
    if (item.type === "project") {
      let hint = null;
      if (hintLookups < MAX_HINT_LOOKUPS) {
        hintLookups += 1;
        hint = await nextProjectHint(item.nation.id, settings);
      }
      item.line = `🔬 **Project cooldown over** — ${base}${hint ? ` — ${hint}` : ""}`;
    } else {
      item.line = `🏙️ **City cooldown over** — ${base}`;
    }
  }

  let isFirstMessage = true;
  for (const batch of batchItems(newlyReady)) {
    const embed = new EmbedBuilder()
      .setTitle("⏰ Cooldown over — ready to fund")
      .setColor(0x2ecc71)
      .setDescription(batch.map((item) => item.line).join("\n"))
      .setFooter({ text: "One alert per cooldown (10 days). Manage with /cooldown_alerts." });

    try {
      await channel.send(
        isFirstMessage
          ? { content: `<@&${config.roleId}>`, embeds: [embed], allowedMentions: { roles: [config.roleId] } }
          : { embeds: [embed] }
      );
      isFirstMessage = false;
      // Only remember the alert once it has actually been posted, so a failed
      // post is retried on the next check.
      for (const item of batch) config.alerted[item.key] = true;
      stats.alertsSent += batch.length;
    } catch (error) {
      stats.errors += 1;
      console.error(`[cooldownAlerts] Couldn't post in channel ${config.channelId}:`, error.message);
      break;
    }
  }

  return stats;
}

module.exports = {
  COOLDOWN_TURNS,
  MAX_WATCHED,
  ensureConfig,
  fetchTimers,
  cooldownText,
  nationUrl,
  runCooldownAlertsForGuild
};
