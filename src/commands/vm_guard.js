const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require("discord.js");
const { getMemberTier, meetsTier } = require("../permissions");
const { loadVmGuard, updateVmGuard } = require("../audit/vmGuardStore");
const { BUTTON_PREFIX, GRACE_DAYS, fmtDays, runVmGuardForGuild, handleVmGuardButton } = require("../audit/vmGuard");
const { resolveNationInput } = require("../audit/resolveNationInput");
const { getSettings } = require("../db");

function onOff(value) {
  return value ? "🟢 ON" : "🔴 OFF";
}

function configLines(state) {
  return (
    `**Monitoring:** ${onOff(state.enabled)}\n` +
    `**Limit:** more than ${state.thresholdDays} day(s) of VM\n` +
    `**Back-to-back rule:** VMs starting less than ${state.gapDays} day(s) after the last one ended count together` +
    `${state.gapDays === 0 ? " (rule is OFF)" : ""}\n` +
    `**IA role:** ${state.iaRoleId ? `<@&${state.iaRoleId}>` : "Not set"}\n` +
    `**Review channel:** ${state.iaChannelId ? `<#${state.iaChannelId}>` : "Not set"}\n` +
    `**Protected roles (never removed):** ${state.protectedRoleIds.length ? state.protectedRoleIds.map((id) => `<@&${id}>`).join(", ") : "None"}`
  );
}

function warnings(state) {
  const problems = [];
  if (!state.enabled) problems.push("monitoring is OFF");
  if (!state.iaRoleId) problems.push("no IA role is set");
  if (!state.iaChannelId) problems.push("no review channel is set");
  return problems.length ? `⚠️ Nothing will be posted yet: ${problems.join(", ")}.` : "";
}

module.exports = {
  minTier: "government",
  buttonPrefix: BUTTON_PREFIX,
  data: new SlashCommandBuilder()
    .setName("vm_guard")
    .setDescription("Limit Discord access for members who stay in Vacation Mode too long.")
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Turn monitoring on/off and set the limit, the IA role and the review channel.")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Turn VM monitoring on or off"))
        .addIntegerOption((opt) =>
          opt.setName("limit_days").setDescription("Review a member whose VM (or chained VMs) lasts more than this many days").setMinValue(1)
        )
        .addIntegerOption((opt) =>
          opt.setName("gap_days").setDescription("VMs starting less than this many days apart count together. Default 3, 0 = off").setMinValue(0)
        )
        .addRoleOption((opt) => opt.setName("ia_role").setDescription("The Internal Affairs role that approves removals"))
        .addChannelOption((opt) =>
          opt.setName("ia_channel").setDescription("Channel where review requests are posted").addChannelTypes(ChannelType.GuildText)
        )
        .addRoleOption((opt) => opt.setName("protect_role").setDescription("A role that is never removed (add one at a time)"))
        .addRoleOption((opt) => opt.setName("unprotect_role").setDescription("Stop protecting a role"))
    )
    .addSubcommand((sub) => sub.setName("status").setDescription("Show the settings, who is in VM, and who currently has roles removed."))
    .addSubcommand((sub) => sub.setName("check").setDescription("Run the VM check right now instead of waiting for the hourly one."))
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Forget everything the bot is tracking for a nation (for example one that left).")
        .addStringOption((opt) => opt.setName("nation").setDescription("Nation ID, name, or profile link").setRequired(true))
    ),

  // Clicks on the review buttons (handled by index.js through the button prefix).
  async handleButton(interaction) {
    await handleVmGuardButton(interaction);
  },

  async execute(interaction, settings) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub !== "status" && !meetsTier(getMemberTier(interaction.member, settings), "administrator")) {
      await interaction.editReply("🚫 Only administrators can use this part of /vm_guard.");
      return;
    }

    if (sub === "setup") {
      const enabled = interaction.options.getBoolean("enabled");
      const limit = interaction.options.getInteger("limit_days");
      const gap = interaction.options.getInteger("gap_days");
      const iaRole = interaction.options.getRole("ia_role");
      const iaChannel = interaction.options.getChannel("ia_channel");
      const protect = interaction.options.getRole("protect_role");
      const unprotect = interaction.options.getRole("unprotect_role");

      const state = updateVmGuard(guildId, (s) => {
        if (enabled !== null) s.enabled = enabled;
        if (limit !== null) s.thresholdDays = limit;
        if (gap !== null) s.gapDays = gap;
        if (iaRole) s.iaRoleId = iaRole.id;
        if (iaChannel) s.iaChannelId = iaChannel.id;
        if (protect && !s.protectedRoleIds.includes(protect.id)) s.protectedRoleIds.push(protect.id);
        if (unprotect) s.protectedRoleIds = s.protectedRoleIds.filter((id) => id !== unprotect.id);
        return JSON.parse(JSON.stringify(s));
      });

      const warning = warnings(state);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("VM Guard Updated")
            .setColor(state.enabled ? 0x2ecc71 : 0xe74c3c)
            .setDescription(
              `${configLines(state)}\n\nThe bot checks every hour. Nothing is ever removed without an IA member clicking the button.` +
                (warning ? `\n\n${warning}` : "")
            )
        ]
      });
      return;
    }

    if (sub === "status") {
      const state = loadVmGuard(guildId);
      const inVm = Object.entries(state.tracking).filter(([, t]) => t.periodStart != null);
      const earlier = Object.entries(state.tracking).filter(([, t]) => t.periodStart == null && t.chainDays > 0);
      const pending = Object.values(state.requests).filter((r) => r.status === "pending");
      const stripped = Object.entries(state.stripped);

      const lines = [configLines(state), ""];
      lines.push(`**In VM right now (${inVm.length}):**`);
      lines.push(
        inVm.length
          ? inVm
              .map(([, t]) => `• ${t.name} — ${fmtDays(t.chainDays + t.lastTotal)} counted${t.chainDays > 0.01 ? ` (incl. ${fmtDays(t.chainDays)} from earlier VMs)` : ""}`)
              .join("\n")
          : "• nobody being followed"
      );
      if (earlier.length) {
        lines.push("", `**Recently out of VM, still remembered (${earlier.length}):**`);
        lines.push(earlier.map(([, t]) => `• ${t.name} — ${fmtDays(t.chainDays)} of earlier VM`).join("\n"));
      }
      lines.push("", `**Roles removed, waiting to be restored (${stripped.length}):**`);
      lines.push(stripped.length ? stripped.map(([, s]) => `• ${s.nationName} — ${s.roleIds.length} role(s) saved`).join("\n") : "• none");
      lines.push("", `**Review requests waiting for a click:** ${pending.length}`);
      lines.push(`*Last check: ${state.lastRunAt ? `<t:${Math.floor(new Date(state.lastRunAt).getTime() / 1000)}:R>` : "never"}*`);

      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("🛂 VM Guard Status").setColor(0x3498db).setDescription(lines.join("\n").slice(0, 4000))]
      });
      return;
    }

    if (sub === "check") {
      if (!settings.alliance.id) {
        await interaction.editReply("❌ No alliance registered yet — run /set_alliance first.");
        return;
      }
      const state = loadVmGuard(guildId);
      const warning = warnings(state);
      if (warning) {
        await interaction.editReply(`${warning} Use \`/vm_guard setup\` first.`);
        return;
      }
      const stats = await runVmGuardForGuild(interaction.client, interaction.guild, settings.alliance.id);
      await interaction.editReply(
        `✅ Check done. **${stats.checked}** member(s) checked, **${stats.inVm}** in VM, **${stats.alertsSent}** new review request(s) posted` +
          (stats.closed ? `, ${stats.closed} old request(s) closed` : "") +
          (stats.errors ? `. ⚠️ ${stats.errors} problem(s) - see the Railway log.` : ".")
      );
      return;
    }

    if (sub === "clear") {
      let nationId;
      try {
        nationId = String(await resolveNationInput(interaction.client, settings, interaction.options.getString("nation")));
      } catch (error) {
        await interaction.editReply(`❌ ${error.message}`);
        return;
      }
      const result = updateVmGuard(guildId, (s) => {
        const had = { tracked: !!s.tracking[nationId], stripped: !!s.stripped[nationId] };
        delete s.tracking[nationId];
        delete s.stripped[nationId];
        for (const [id, r] of Object.entries(s.requests)) if (r.nationId === nationId && r.status === "pending") s.requests[id].status = "expired";
        return had;
      });
      await interaction.editReply(
        result.tracked || result.stripped
          ? `✅ Forgot nation ${nationId}.` +
              (result.stripped ? " Their saved roles were discarded, so restore anything they should have back by hand." : "")
          : `Nation ${nationId} wasn't being tracked.`
      );
    }
  }
};
