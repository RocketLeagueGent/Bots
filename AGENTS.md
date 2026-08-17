# AGENTS.md

## Quick start

```bash
npm install --no-optional   # skip native gl/canvas builds (vision is off by default)
cp keys.json.example keys.json   # fill in at least one API key
npm start                    # launches MindServer + opens http://localhost:8081
```

There are **no lint, typecheck, or test commands** configured. `node --check` is the only syntax check available.

## Architecture

This is an **ESM-only** (`"type": "module"`) Node.js project. No CommonJS.

```
main.js                     → reads profiles, calls mindcraft.createAgent() for each
settings.js                 → root config (host, port, auth, default settings)
console.json                → default bot profile for the Console bot

src/mindcraft/
  mindcraft.js              → createAgent(), detectServer(), server version cache
  mindserver.js             → socket.io hub, web UI, fleet deploy/destroy/TPA handlers
  fleet.js                  → random username generation, fleet profile builder
  fleet_credentials.json    → persisted bot passwords (gitignored)
  mcserver.js               → pings MC server, detects version/host via minecraft-protocol
  public/                   → dashboard web UI (HTML/JS/CSS)

src/agent/
  agent.js                  → Agent class: bot lifecycle, chat handling, proximity guard
  connection_handler.js     → kick reason parsing, name validation
  commands/                 → bot commands (!follow, !attack, !collectBlocks, etc.)
  library/                  → skill system (skills.js, world.js, lockdown.js)
  npc/                      → NPC behavior (building, item goals)
  vision/                   → camera, browser_viewer, vision_interpreter

src/models/
  prompter.js               → builds LLM prompts, selects model via _model_map.js
  _model_map.js             → auto-discovers model classes by static `prefix` property
  gpt.js, claude.js, etc.   → one file per API provider

src/process/
  init_agent.js             → entry point for each agent child process
  agent_process.js          → spawns/restarts agent child processes
```

## Key gotchas

- **Each agent is a separate child process.** `AgentProcess.start()` spawns `init_agent.js` via `child_process.spawn`. Agent logic runs in isolated processes, not the main thread.
- **Agent settings are a shared mutable singleton** (`src/agent/settings.js`). It's an empty object mutated by `setSettings()`. Don't import it at module level expecting stable values during top-level init.
- **Model API selection is automatic.** `selectAPI()` in `_model_map.js` matches profile model strings to provider prefixes. If no match, it falls back to pattern-matching model names (gpt→openai, claude→anthropic, etc.).
- **Fleet credentials are auto-generated** and persisted to `fleet_credentials.json`. On first join a bot `/register`s; on rejoin it `/login`s. This file is gitignored.
- **Server version cache** (`mindcraft.js`): `detectServer()` caches pings for 5 minutes. This prevents 198-bot fleets from spamming the server.
- **Patches are stale.** The `patches/` directory has patches for older versions (mineflayer 4.33.0, minecraft-data 3.97.0) but package.json now uses 4.37.1/3.113.2. They may not apply cleanly. `temp_chunk_patch.js` manually patches `prismarine-chunk` for MC 26.x support — run it manually after `npm install` if connecting to 1.26.x servers.
- **`npm install` often needs `--no-optional`** to skip `gl` native builds. Vision/rendering is disabled by default (`allow_vision: false`).
- **`connection_handler.js`** has a `[LoginGuard]` prefix in `validateNameFormat` but not in `handleDisconnection` — this is inconsistent and may be intentional or a bug.
- **Profiles cascade:** individual profile → base profile (survival/creative/etc.) → `_default.json`. Later values override earlier ones.
- **`keys.json` is gitignored.** Only `keys.json.example` is tracked. API keys can also come from environment variables.

## Fleet mode

Deploy bots from the dashboard at `http://localhost:8081`. The fleet system:
- Generates random usernames via `fleet.js`
- Creates profiles with `buildFleetProfile()`
- Spawns each bot as a child process
- Bots auto-register/login with persisted credentials
- Master player (`RocketLeagueGent`) is the only one who can issue commands
- Proximity guard: fleet bots attack non-master players within range

## Environment variable overrides

`main.js` reads these env vars: `MINECRAFT_PORT`, `MINDSERVER_PORT`, `PROFILES`, `INSECURE_CODING`, `BLOCKED_ACTIONS`, `MAX_MESSAGES`, `NUM_EXAMPLES`, `LOG_ALL`, `SETTINGS_JSON`.

## Common issues

- `ECONNREFUSED` → server not open to LAN, wrong port in `settings.js`, or version mismatch
- `ERR_MODULE_NOT_FOUND` → run `npm install`
- Build errors on `gl`/`canvas` → use `--no-optional` or Node v20 LTS
- `My brain disconnected` → LLM API key wrong, rate limited, or missing
- Bots get stuck → delete `node_modules`, run `npm install` (patches may not be applied)
