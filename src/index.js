// index.js
//
// This is the file that actually starts the bot. Run it with:
//     npm start
//
require("dotenv").config();
const { Client, GatewayIntentBits, MessageFlags } = require("discord.js");
const { loadCommands } = require("./loadCommands");
const { getSettings } = require("./db");
const { getMemberTier, meetsTier } = require("./permissions");
const { startScheduler } = require("./scheduler");

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN in your .env file.");
  process.exit(1);
}

// Safety net: if something goes wrong that isn't caught anywhere else,
// log it instead of crashing the whole bot. Without this, a single failed
// Discord API call (e.g. a expired/duplicate interaction) can take the
// entire bot offline instead of just failing that one command.
process.on("unhandledRejection", (error) => {
  console.error("⚠️ Unhandled promise rejection (bot is still running):", error);
});
process.on("uncaughtException", (error) => {
  console.error("⚠️ Uncaught exception (bot is still running):", error);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = loadCommands();

// Some commands open a private modal form — map each modal's custom ID
// back to the command that handles its submission.
const modalHandlers = new Map();
for (const command of commands.values()) {
  if (command.modalCustomId && command.handleModalSubmit) {
    modalHandlers.set(command.modalCustomId, command);
  }
}

// Some commands use persistent button interactions (e.g. /help's category
// buttons). Map each button prefix back to the command that handles clicks.
const buttonHandlers = new Map();
for (const command of commands.values()) {
  if (command.buttonPrefix && command.handleButton) {
    buttonHandlers.set(command.buttonPrefix, command);
  }
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Loaded ${commands.size} commands: ${[...commands.keys()].join(", ")}`);
  startScheduler(client);
});

// Tries to tell the person something went wrong, but never lets that
// attempt itself crash the bot if Discord rejects it too.
async function safeErrorReply(interaction, content) {
  try {
    const message = { content, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message);
    } else {
      await interaction.reply(message);
    }
  } catch (error) {
    console.error("⚠️ Couldn't even send the error message back to Discord:", error.message);
  }
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isModalSubmit()) {
      const handler = modalHandlers.get(interaction.customId);
      if (!handler) return;
      try {
        await handler.handleModalSubmit(interaction);
      } catch (error) {
        console.error(`Error handling modal submit for ${interaction.customId}:`, error);
        await safeErrorReply(interaction, "⚠️ Something went wrong processing that. Please try again.");
      }
      return;
    }

    if (interaction.isButton()) {
      // Find a handler whose prefix matches this button's custom ID
      for (const [prefix, handler] of buttonHandlers.entries()) {
        if (interaction.customId.startsWith(prefix)) {
          try {
            await handler.handleButton(interaction);
          } catch (error) {
            console.error(`Error handling button ${interaction.customId}:`, error);
            await safeErrorReply(interaction, "⚠️ Something went wrong. Please try again.");
          }
          return;
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    // This bot only works inside a server (not in DMs), since settings are per-server.
    if (!interaction.guild || !interaction.member) {
      await safeErrorReply(interaction, "This bot only works inside a Discord server.");
      return;
    }

    const settings = getSettings(interaction.guildId);
    const tier = getMemberTier(interaction.member, settings);

    if (!meetsTier(tier, command.minTier)) {
      await safeErrorReply(interaction, `🚫 You need **${command.minTier}** permission or higher to use \`/${command.data.name}\`.`);
      return;
    }

    try {
      await command.execute(interaction, settings);
    } catch (error) {
      console.error(`Error running /${command.data.name}:`, error);
      await safeErrorReply(interaction, "⚠️ Something went wrong running that command. Please try again.");
    }
  } catch (outerError) {
    // Catch-all: nothing above should ever crash the whole bot.
    console.error("⚠️ Unexpected error handling an interaction:", outerError);
  }
});

client.login(DISCORD_TOKEN);
