// autoRegister.js
//
// Automatically keeps slash commands in sync with Discord on every bot
// startup. Instead of blindly re-registering every time (which wastes API
// calls and can hit rate limits), it:
//
//   1. Fetches what's currently registered with Discord
//   2. Compares it against what's in the code
//   3. Only calls Discord's registration API if something actually changed
//
// This means you never need to run "npm run deploy" manually again — just
// restart the bot and it handles registration itself, whether running
// locally or on Railway.
//
// Uses DISCORD_GUILD_ID if set (fast guild commands, instant update) or
// falls back to global commands (takes up to 1 hour to propagate).

const { REST, Routes } = require("discord.js");

// Normalises a command or option down to just the fields Discord uses for
// comparison — strips IDs, versions, and other server-added metadata so
// the local and remote sides are comparable on equal footing.
function normalizeOption(opt) {
  return {
    name: opt.name,
    description: opt.description || "",
    type: opt.type,
    required: opt.required || false,
    choices: (opt.choices || [])
      .map((c) => ({ name: c.name, value: c.value }))
      .sort((a, b) => String(a.value).localeCompare(String(b.value))),
    options: (opt.options || []).map(normalizeOption)
  };
}

function normalizeCommand(cmd) {
  return {
    name: cmd.name,
    description: cmd.description || "",
    options: (cmd.options || []).map(normalizeOption)
  };
}

function fingerprint(commands) {
  return JSON.stringify(
    commands.map(normalizeCommand).sort((a, b) => a.name.localeCompare(b.name))
  );
}

async function autoRegisterCommands(commands) {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    console.warn("[autoRegister] Missing DISCORD_TOKEN or DISCORD_CLIENT_ID — skipping.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);

  // Serialise the local command set for comparison
  const localData = [...commands.values()].map((cmd) => cmd.data.toJSON());
  const localFingerprint = fingerprint(localData);

  // Fetch whatever Discord currently has registered
  let registeredData;
  try {
    registeredData = guildId
      ? await rest.get(Routes.applicationGuildCommands(clientId, guildId))
      : await rest.get(Routes.applicationCommands(clientId));
  } catch (error) {
    console.error("[autoRegister] Couldn't fetch registered commands:", error.message);
    return;
  }

  const registeredFingerprint = fingerprint(registeredData);

  if (localFingerprint === registeredFingerprint) {
    console.log(
      `[autoRegister] Commands are up to date (${localData.length} registered) — no API call needed.`
    );
    return;
  }

  // Something changed — figure out what for a clear log message
  const localNames = new Set(localData.map((c) => c.name));
  const registeredNames = new Set(registeredData.map((c) => c.name));
  const added = [...localNames].filter((n) => !registeredNames.has(n));
  const removed = [...registeredNames].filter((n) => !localNames.has(n));
  const changed = [...localNames].filter(
    (n) =>
      registeredNames.has(n) &&
      JSON.stringify(normalizeCommand(localData.find((c) => c.name === n))) !==
        JSON.stringify(normalizeCommand(registeredData.find((c) => c.name === n)))
  );

  if (added.length) console.log(`[autoRegister] New commands: ${added.join(", ")}`);
  if (removed.length) console.log(`[autoRegister] Removed commands: ${removed.join(", ")}`);
  if (changed.length) console.log(`[autoRegister] Changed commands: ${changed.join(", ")}`);

  console.log(`[autoRegister] Registering ${localData.length} commands with Discord...`);
  try {
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);

    await rest.put(route, { body: localData });
    console.log(
      `[autoRegister] ✅ Successfully registered ${localData.length} command(s)` +
        (guildId ? ` to guild ${guildId}.` : " globally (may take up to 1 hour to propagate).")
    );
  } catch (error) {
    console.error("[autoRegister] ❌ Registration failed:", error.message);
    // Non-fatal — the bot continues to run with whatever was previously registered.
  }
}

module.exports = { autoRegisterCommands };
