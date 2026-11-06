// vmGuard.js
//
// Limits Discord access for members who stay in Vacation Mode (VM) for a long
// time, as a safeguard against spies parking on the server.
//
//   1. Every hour the bot looks at each alliance member's VM.
//   2. When a VM is longer than the limit - OR several VMs in a row add up to
//      more than the limit - the bot posts a review request for the Internal
//      Affairs (IA) role, with buttons. Nothing happens until someone clicks.
//   3. "Remove roles" takes every role off the member (leaving only the
//      default role, so they see public channels only) and remembers them.
//   4. When their VM ends, the bot posts a second request: restore the saved
//      roles, or let the Minister set them manually.
//
// Back-to-back VMs: if a member's next VM starts less than `gapDays` after the
// previous one ended, the two are counted together. So 7 days + 7 days straight
// after counts as 14, not as two harmless 7s.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { queryPNW } = require("../pnw");
const { resolveGuildMember } = require("./resolveDiscordUser");
const { getMemberTier, meetsTier } = require("../permissions");
const { getSettings } = require("../db");
const { loadVmGuard, updateVmGuard } = require("./vmGuardStore");

const DAY_MS = 86400000;
const TURNS_PER_DAY = 12; // 1 turn = 2 hours
const GRACE_DAYS = 0.25; // "exactly X days" must not trigger because of a few hours of rounding
const BUTTON_PREFIX = "vmguard:";
const KEEP_DECIDED_REQUESTS_DAYS = 30;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fmtDays(days) {
  const totalHours = Math.max(0, Math.round(days * 24));
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  if (d === 0 && h === 0) return "0h";
  return [d ? `${d}d` : "", h ? `${h}h` : ""].filter(Boolean).join(" ");
}

function nationUrl(id) {
  return `https://politicsandwar.com/nation/id=${id}`;
}

function freshTrack(name) {
  return {
    name,
    chainDays: 0, // VM days from earlier VMs that count together with the current one
    periodStart: null, // when the current VM was first noticed (null = not in VM)
    lastSeenVm: null,
    lastTotal: 0, // length of the current VM as of the last check
    lastVmEnd: null,
    requestedPeriodStart: null, // set once a review has been posted for this VM
    removalRequestId: null
  };
}

// ---------------------------------------------------------------------------
// The VM history logic (the part that catches back-to-back VMs)
// ---------------------------------------------------------------------------

// Updates one member's VM history from what the game says right now.
// turns = vacation_mode_turns (turns of VM remaining; 0 = not in VM).
function observeNation(track, turns, nowMs, gapDays) {
  const inVm = Number(turns) > 0;
  const gapMs = gapDays * DAY_MS;

  if (inVm) {
    if (track.periodStart == null) {
      // A VM has just been noticed. If the member was only back briefly since
      // their last VM, carry that VM's days forward; otherwise start fresh.
      const continues = track.lastVmEnd != null && nowMs - track.lastVmEnd < gapMs;
      if (!continues) track.chainDays = 0;
      track.periodStart = nowMs;
    }
    const elapsed = (nowMs - track.periodStart) / DAY_MS;
    const remaining = Number(turns) / TURNS_PER_DAY;
    track.lastTotal = elapsed + remaining;
    track.lastSeenVm = nowMs;
    return {
      inVm: true,
      elapsedDays: elapsed,
      remainingDays: remaining,
      chainDays: track.chainDays,
      committedDays: track.chainDays + elapsed + remaining
    };
  }

  if (track.periodStart != null) {
    // The VM has ended: add how long it really lasted to the running total.
    const lasted = Math.min(track.lastTotal || 0, (nowMs - track.periodStart) / DAY_MS);
    track.chainDays = (track.chainDays || 0) + lasted;
    track.periodStart = null;
    track.lastVmEnd = nowMs;
  }
  if (track.lastVmEnd != null && nowMs - track.lastVmEnd >= gapMs) {
    // Back for long enough: the earlier VMs are forgotten.
    track.chainDays = 0;
    track.lastVmEnd = null;
  }
  return { inVm: false, chainDays: track.chainDays || 0, committedDays: track.chainDays || 0 };
}

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

const VM_QUERY = `
  query AllianceVm($allianceId: [Int], $page: Int) {
    nations(alliance_id: $allianceId, first: 50, page: $page) {
      paginatorInfo { hasMorePages currentPage }
      data { id nation_name num_cities alliance_position vacation_mode_turns discord discord_id }
    }
  }
`;

async function fetchAllianceVm(allianceId) {
  const members = [];
  let page = 1;
  let more = true;
  while (more) {
    const data = await queryPNW(VM_QUERY, { allianceId: [Number(allianceId)], page });
    const result = data?.nations;
    if (!result) break;
    members.push(...result.data);
    more = result.paginatorInfo?.hasMorePages ?? false;
    page += 1;
  }
  // Applicants aren't members yet, so they have no member roles to remove.
  return members.filter((n) => (n.alliance_position || "").toUpperCase() !== "APPLICANT");
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

// Which of a member's roles can be taken away, and which have to stay.
function planRoleRemoval(member, guild, state) {
  const protectedIds = new Set(state.protectedRoleIds || []);
  const removable = [];
  const kept = [];
  for (const role of member.roles.cache.values()) {
    if (role.id === guild.id) continue; // the default (@everyone) role
    if (protectedIds.has(role.id)) kept.push({ role, reason: "protected" });
    else if (role.managed) kept.push({ role, reason: "managed by an integration" });
    else if (!role.editable) kept.push({ role, reason: "above the bot's own role" });
    else removable.push(role);
  }
  return { removable, kept };
}

function roleMentions(ids, limit = 900) {
  let text = ids.map((id) => `<@&${id}>`).join(", ");
  if (text.length > limit) text = text.slice(0, limit - 3) + "...";
  return text || "none";
}

// ---------------------------------------------------------------------------
// The messages with buttons
// ---------------------------------------------------------------------------

function buttons(requestId, kind) {
  const row = new ActionRowBuilder();
  if (kind === "remove") {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}remove:${requestId}`).setLabel("Remove roles").setEmoji("🔒").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}dismiss:${requestId}`).setLabel("Dismiss").setStyle(ButtonStyle.Secondary)
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}restore:${requestId}`).setLabel("Restore previous roles").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}manual:${requestId}`).setLabel("I'll set roles manually").setStyle(ButtonStyle.Secondary)
    );
  }
  return row;
}

function removalMessage({ nation, member, obs, state, plan, requestId }) {
  const lines = [
    `[${nation.nation_name}](${nationUrl(nation.id)}) · C${nation.num_cities} · <@${member.id}>`,
    "",
    `**This VM:** ${fmtDays(obs.elapsedDays)} in, ${fmtDays(obs.remainingDays)} left (${fmtDays(obs.elapsedDays + obs.remainingDays)} in total)`
  ];
  if (obs.chainDays > 0.01) {
    lines.push(
      `**Earlier VM(s) counted with it:** ${fmtDays(obs.chainDays)} (they were back for under ${state.gapDays} day(s) in between)`
    );
  }
  lines.push(
    `**Counted total:** ${fmtDays(obs.committedDays)} — the limit is ${state.thresholdDays} day(s)`,
    "",
    `**Roles that would be removed (${plan.removable.length}):** ${roleMentions(plan.removable.map((r) => r.id))}`
  );
  if (plan.kept.length > 0) {
    lines.push(`**Staying on them:** ${plan.kept.map((k) => `${k.role.name} (${k.reason})`).join(", ")}`);
  }
  lines.push(
    "",
    "Removing roles leaves them with only the default role, so they see public channels only. The roles are saved so you can restore them when the VM ends."
  );

  return {
    content: `<@&${state.iaRoleId}>`,
    embeds: [
      new EmbedBuilder()
        .setTitle(`🛂 Long VM — roles review: ${nation.nation_name}`)
        .setColor(0xe67e22)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Only the IA role (or an administrator) can use these buttons. Nothing happens until you click." })
    ],
    components: [buttons(requestId, "remove")],
    allowedMentions: { roles: [state.iaRoleId] }
  };
}

function restoreMessage({ stripped, nationId, state, requestId }) {
  const lines = [
    `[${stripped.nationName}](${nationUrl(nationId)}) · <@${stripped.discordId}>`,
    "",
    `Their VM is over. Their roles were removed <t:${Math.floor(new Date(stripped.removedAt).getTime() / 1000)}:R>` +
      (stripped.approvedBy ? ` (approved by <@${stripped.approvedBy}>).` : "."),
    "",
    `**Roles that were removed (${stripped.roleIds.length}):** ${roleMentions(stripped.roleIds)}`,
    "",
    "Restore these roles, or would you rather set their roles yourself?"
  ];
  return {
    content: `<@&${state.iaRoleId}>`,
    embeds: [
      new EmbedBuilder()
        .setTitle(`✅ VM over — restore roles? ${stripped.nationName}`)
        .setColor(0x3498db)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Only the IA role (or an administrator) can use these buttons." })
    ],
    components: [buttons(requestId, "restore")],
    allowedMentions: { roles: [state.iaRoleId] }
  };
}

// Marks a posted request as finished: adds a note and removes its buttons.
async function closeMessage(channel, request, note, color) {
  try {
    const message = await channel.messages.fetch(request.messageId);
    const embed = EmbedBuilder.from(message.embeds[0]).setColor(color).addFields({ name: "Update", value: note });
    await message.edit({ embeds: [embed], components: [] });
  } catch (error) {
    // The message may have been deleted - nothing more to do.
  }
}

// ---------------------------------------------------------------------------
// The hourly check
// ---------------------------------------------------------------------------

async function runVmGuardForGuild(client, guild, allianceId, { now = Date.now() } = {}) {
  const stats = { checked: 0, inVm: 0, alertsSent: 0, closed: 0, errors: 0 };

  const initial = loadVmGuard(guild.id);
  if (!initial.enabled || !initial.iaRoleId || !initial.iaChannelId || !allianceId) return stats;
  const channel = guild.channels.cache.get(initial.iaChannelId);
  if (!channel) {
    stats.errors += 1;
    return stats;
  }

  const members = await fetchAllianceVm(allianceId);
  stats.checked = members.length;

  // Phase 1 - update everyone's VM history and decide what needs doing.
  // (Done in one go on the freshest saved data, with no waiting in between.)
  const actions = updateVmGuard(guild.id, (state) => {
    const todo = [];

    for (const nation of members) {
      const id = String(nation.id);
      const turns = Number(nation.vacation_mode_turns) || 0;
      if (turns <= 0 && !state.tracking[id] && !state.stripped[id]) continue; // nothing to follow

      const track = (state.tracking[id] ||= freshTrack(nation.nation_name));
      track.name = nation.nation_name;
      const obs = observeNation(track, turns, now, state.gapDays);
      const stripped = state.stripped[id];

      if (obs.inVm) {
        stats.inVm += 1;
        if (stripped?.restoreRequestId) todo.push({ type: "supersedeRestore", nationId: id });
        const overLimit = obs.committedDays > state.thresholdDays + GRACE_DAYS;
        if (!stripped && overLimit && track.requestedPeriodStart !== track.periodStart) {
          todo.push({ type: "requestRemoval", nation, obs });
        }
      } else {
        if (track.removalRequestId) todo.push({ type: "expireRemoval", nationId: id });
        if (stripped && !stripped.restoreRequestId) todo.push({ type: "requestRestore", nationId: id });
      }

      // Nothing left to remember about this member.
      if (!obs.inVm && track.chainDays === 0 && track.periodStart == null && !track.removalRequestId) {
        delete state.tracking[id];
      }
    }

    // Forget decided requests after a while so the file doesn't grow forever.
    const cutoff = now - KEEP_DECIDED_REQUESTS_DAYS * DAY_MS;
    for (const [requestId, request] of Object.entries(state.requests)) {
      if (request.status !== "pending" && new Date(request.createdAt).getTime() < cutoff) delete state.requests[requestId];
    }
    state.lastRunAt = new Date(now).toISOString();
    return todo;
  });

  // Phase 2 - do the Discord work, saving the result of each step as it completes.
  for (const action of actions) {
    try {
      const state = loadVmGuard(guild.id);

      if (action.type === "requestRemoval") {
        const member = await resolveGuildMember(guild, action.nation);
        if (!member) continue; // not on this server (or not linked) - nothing to remove
        const plan = planRoleRemoval(member, guild, state);
        if (plan.removable.length === 0) continue;

        const requestId = `${action.nation.id}-${now.toString(36)}`;
        const sent = await channel.send(removalMessage({ nation: action.nation, member, obs: action.obs, state, plan, requestId }));
        updateVmGuard(guild.id, (s) => {
          s.requests[requestId] = {
            id: requestId,
            type: "remove",
            nationId: String(action.nation.id),
            nationName: action.nation.nation_name,
            discordId: member.id,
            channelId: channel.id,
            messageId: sent.id,
            status: "pending",
            createdAt: new Date(now).toISOString()
          };
          const track = s.tracking[String(action.nation.id)];
          if (track) {
            track.requestedPeriodStart = track.periodStart;
            track.removalRequestId = requestId;
          }
        });
        stats.alertsSent += 1;
      } else if (action.type === "requestRestore") {
        const stripped = state.stripped[action.nationId];
        if (!stripped || stripped.restoreRequestId) continue;
        const requestId = `${action.nationId}-r${now.toString(36)}`;
        const sent = await channel.send(restoreMessage({ stripped, nationId: action.nationId, state, requestId }));
        updateVmGuard(guild.id, (s) => {
          s.requests[requestId] = {
            id: requestId,
            type: "restore",
            nationId: action.nationId,
            nationName: stripped.nationName,
            discordId: stripped.discordId,
            channelId: channel.id,
            messageId: sent.id,
            status: "pending",
            createdAt: new Date(now).toISOString()
          };
          if (s.stripped[action.nationId]) s.stripped[action.nationId].restoreRequestId = requestId;
        });
        stats.alertsSent += 1;
      } else if (action.type === "expireRemoval") {
        const requestId = state.tracking[action.nationId]?.removalRequestId;
        const request = requestId && state.requests[requestId];
        if (request && request.status === "pending") {
          await closeMessage(channel, request, "Their VM ended before this was reviewed — no action needed.", 0x95a5a6);
          updateVmGuard(guild.id, (s) => {
            if (s.requests[requestId]?.status === "pending") s.requests[requestId].status = "expired";
            if (s.tracking[action.nationId]) s.tracking[action.nationId].removalRequestId = null;
          });
          stats.closed += 1;
        } else {
          updateVmGuard(guild.id, (s) => {
            if (s.tracking[action.nationId]) s.tracking[action.nationId].removalRequestId = null;
          });
        }
      } else if (action.type === "supersedeRestore") {
        const requestId = state.stripped[action.nationId]?.restoreRequestId;
        const request = requestId && state.requests[requestId];
        if (request && request.status === "pending") {
          await closeMessage(channel, request, "They went back into VM — their roles stay removed. A new request will come when this VM ends.", 0x95a5a6);
          updateVmGuard(guild.id, (s) => {
            if (s.requests[requestId]?.status === "pending") s.requests[requestId].status = "superseded";
            if (s.stripped[action.nationId]) s.stripped[action.nationId].restoreRequestId = null;
          });
          stats.closed += 1;
        }
      }
    } catch (error) {
      stats.errors += 1;
      console.error(`[vmGuard] ${action.type} failed:`, error.message);
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Button clicks
// ---------------------------------------------------------------------------

function canDecide(member, state, guildId) {
  if (state.iaRoleId && member.roles.cache.has(state.iaRoleId)) return true;
  return meetsTier(getMemberTier(member, getSettings(guildId)), "administrator");
}

function privateReply(interaction, content) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleVmGuardButton(interaction) {
  const [, action, requestId] = interaction.customId.split(":");
  const state = loadVmGuard(interaction.guildId);
  const request = state.requests[requestId];

  if (!request) return privateReply(interaction, "This request isn't active any more.");
  if (!canDecide(interaction.member, state, interaction.guildId)) {
    return privateReply(interaction, "🚫 Only the Internal Affairs role (or an administrator) can use these buttons.");
  }
  if (request.status !== "pending") return privateReply(interaction, `This request was already handled (${request.status}).`);

  await interaction.deferUpdate();
  const baseEmbed = () => EmbedBuilder.from(interaction.message.embeds[0]);
  const finish = (note, color) =>
    interaction.editReply({ embeds: [baseEmbed().setColor(color).addFields({ name: "Decision", value: note })], components: [] });
  const guild = interaction.guild;
  const who = `<@${interaction.user.id}>`;

  try {
    if (action === "dismiss") {
      updateVmGuard(guild.id, (s) => {
        if (s.requests[requestId]) s.requests[requestId].status = "dismissed";
        const track = s.tracking[request.nationId];
        if (track) track.removalRequestId = null; // won't be asked again for this VM
      });
      return finish(`Dismissed by ${who} — their roles were left alone.`, 0x95a5a6);
    }

    if (action === "remove") {
      const member = await guild.members.fetch(request.discordId).catch(() => null);
      if (!member) {
        updateVmGuard(guild.id, (s) => {
          if (s.requests[requestId]) s.requests[requestId].status = "expired";
        });
        return finish("They're no longer on this server, so there was nothing to remove.", 0x95a5a6);
      }
      const plan = planRoleRemoval(member, guild, state);
      if (plan.removable.length === 0) return interaction.followUp({ content: "There are no removable roles on this member.", flags: MessageFlags.Ephemeral });

      await member.roles.remove(plan.removable.map((r) => r.id), `VM guard: approved by ${interaction.user.tag}`);
      updateVmGuard(guild.id, (s) => {
        if (s.requests[requestId]) {
          s.requests[requestId].status = "approved";
          s.requests[requestId].decidedBy = interaction.user.id;
        }
        s.stripped[request.nationId] = {
          nationName: request.nationName,
          discordId: request.discordId,
          roleIds: plan.removable.map((r) => r.id),
          removedAt: new Date().toISOString(),
          approvedBy: interaction.user.id,
          restoreRequestId: null
        };
        const track = s.tracking[request.nationId];
        if (track) track.removalRequestId = null;
      });
      return finish(
        `🔒 Roles removed by ${who} (${plan.removable.length}). They now see public channels only. You'll get a request to restore them when their VM ends.`,
        0xe74c3c
      );
    }

    if (action === "restore") {
      const stripped = state.stripped[request.nationId];
      if (!stripped) {
        updateVmGuard(guild.id, (s) => {
          if (s.requests[requestId]) s.requests[requestId].status = "expired";
        });
        return finish("There was nothing left to restore.", 0x95a5a6);
      }
      const member = await guild.members.fetch(stripped.discordId).catch(() => null);
      if (!member) {
        updateVmGuard(guild.id, (s) => {
          if (s.requests[requestId]) s.requests[requestId].status = "expired";
          delete s.stripped[request.nationId];
        });
        return finish("They're no longer on this server, so there was nothing to restore.", 0x95a5a6);
      }

      const restorable = [];
      const unavailable = [];
      for (const id of stripped.roleIds) {
        const role = guild.roles.cache.get(id);
        if (!role) unavailable.push(`a role that no longer exists`);
        else if (!role.editable) unavailable.push(`${role.name} (above the bot's role)`);
        else if (!member.roles.cache.has(id)) restorable.push(role);
      }
      if (restorable.length > 0) await member.roles.add(restorable.map((r) => r.id), `VM guard: restore approved by ${interaction.user.tag}`);

      updateVmGuard(guild.id, (s) => {
        if (s.requests[requestId]) {
          s.requests[requestId].status = "approved";
          s.requests[requestId].decidedBy = interaction.user.id;
        }
        delete s.stripped[request.nationId];
      });
      return finish(
        `✅ ${restorable.length} role(s) restored by ${who}.` + (unavailable.length ? ` Couldn't restore: ${unavailable.join(", ")}.` : ""),
        0x2ecc71
      );
    }

    if (action === "manual") {
      updateVmGuard(guild.id, (s) => {
        if (s.requests[requestId]) {
          s.requests[requestId].status = "manual";
          s.requests[requestId].decidedBy = interaction.user.id;
        }
        delete s.stripped[request.nationId];
      });
      return finish(`${who} will set their roles manually. The bot won't restore anything.`, 0x95a5a6);
    }
  } catch (error) {
    console.error(`[vmGuard] button "${action}" failed:`, error);
    return interaction.followUp({
      content: `⚠️ That didn't work: ${error.message}. Check that the bot's role is above the roles involved and has Manage Roles, then click again.`,
      flags: MessageFlags.Ephemeral
    });
  }
}

module.exports = {
  BUTTON_PREFIX,
  GRACE_DAYS,
  fmtDays,
  freshTrack,
  observeNation,
  fetchAllianceVm,
  runVmGuardForGuild,
  handleVmGuardButton
};
