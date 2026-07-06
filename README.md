# TUN Audit Bot — Setup Guide (Stage 1)

This is Stage 1 of your bot: it connects to Discord and lets Administrators
configure alliance settings (alliance info, MMR, scoring, passing %, roles).
The actual nation-auditing commands come in Stage 2.

## What you need installed on your computer (one-time)

1. **Node.js** — download and install the "LTS" version from https://nodejs.org
   - To check it worked, open a terminal (Command Prompt on Windows, Terminal on
     Mac) and type: `node -v` — you should see a version number like `v20.x.x`.

## Setup steps

1. Unzip this project folder somewhere on your computer (e.g. your Desktop).
2. Open a terminal **inside this folder**.
   - Windows: open the folder in File Explorer, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder → "New Terminal at Folder" (or open Terminal and `cd` into it).
3. Install the bot's dependencies (the libraries it needs):
   ```
   npm install
   ```
   
4. Make a copy of `.env.example` and rename the copy to `.env`.
5. Open `.env` in any text editor and fill in:
   - `DISCORD_TOKEN` — your bot's token from the Discord Developer Portal.
   - `DISCORD_CLIENT_ID` — your bot's Application/Client ID (same page).
   - `DISCORD_GUILD_ID` — your test server's ID. (Recommended while testing —
     commands appear instantly instead of taking up to an hour.)
     To get a server ID: in Discord, turn on Developer Mode (User Settings →
     Advanced), then right-click your server icon → "Copy Server ID".
   - `PNW_API_KEY` — your Politics & War API key.
6. Tell Discord what commands your bot has (run this once, and again any time
   commands change):
   ```
   npm run deploy
   ```
7. Start the bot:
   ```
   npm start
   ```
   You should see `✅ Logged in as YourBotName#1234` in the terminal.
8. In Discord, type `/` in a channel your bot can see — you should see the
   commands appear (e.g. `/set_alliance`, `/view_scores`).

If your bot isn't in your server yet: go to the Discord Developer Portal →
your application → OAuth2 → URL Generator → check `bot` and
`applications.commands` scopes, check the `Administrator` permission (or pick
specific permissions if you prefer), copy the generated link, open it in your
browser, and invite the bot to your server.

## Deploying to Railway

1. **Put this project on GitHub**, with `package.json` at the **root** of the repo (not nested inside another folder) — this matters for the volume path step below.
   - If you're not already using git: in VS Code, click the Source Control icon on the left sidebar → "Publish to GitHub" → follow the prompts. This creates the repo and pushes your code in one go.
2. In Railway: **New Project → Deploy from GitHub repo** → pick this repo. It'll attempt a first deploy and fail — that's expected, since it has no secrets yet.
3. Go to your service → **Variables** tab → add the same 4 values from your `.env` file: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `PNW_API_KEY`.
4. **Set up persistent storage** (important — without this, your alliance settings and audit history get wiped every time you redeploy):
   - Go to your service → **Settings → Volumes → New Volume**.
   - Set the mount path to `/app/data`.
   - Railway will redeploy automatically after this.
5. Check the **Deployments → Logs** tab. You should see `✅ Logged in as YourBotName#1234` once it's live.
6. **Stop running the bot on your own computer** (`Ctrl+C` in VS Code) once Railway is confirmed live — having two copies of the bot logged in with the same token at once can cause duplicate/conflicting replies to commands.

**Slash commands don't need to be redeployed when you move hosts.** `/npm run deploy` registers commands with Discord directly (not with Railway), so the commands you already registered while testing locally will keep working on Railway automatically. You only need to run `npm run deploy` again (from anywhere, including your own computer) if you add or change a command in the future.

## Folder map (what each thing does)

```
src/
  index.js            <- starts the bot, handles permission checks
  deploy-commands.js  <- registers slash commands with Discord
  loadCommands.js      <- auto-loads every file in src/commands
  db.js               <- simple JSON-file storage (settings + history)
  permissions.js      <- figures out Member/Mentor/Government/Administrator
  commands/           <- one file per slash command
data/                  <- where each server's settings get saved (auto-created)
```

## Commands available in this stage

- `/set_alliance` (Administrator)
- `/set_passing_score` (Administrator)
- `/set_audit_score` (Administrator)
- `/set_mmr` (Administrator)
- `/set_role` (Administrator) — promote a Discord role to Mentor/Government/Administrator
- `/view_scores` (Member)
- `/view_mmr` (Member)
- `/audit_history` (Member) — will be empty until Stage 2 adds real audits.
