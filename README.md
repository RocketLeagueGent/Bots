# Minecraft Bots

This is a Public Project built by [RocketLeagueGent](https://www.youtube.com/@RocketLeagueGent) to Put bots on Minecraft servers using Mindcraft and mineflayer.

## Quick Start

```bash
# 1. Install dependencies
npm install --no-optional

# 2. Copy API keys template and fill in your keys
copy keys.json.example keys.json

# 3. Start the dashboard
py start.py
```

## Dashboard Commands

| Command | Description |
|---|---|
| `via start` / `via stop` | Start/stop ViaProxy (protocol translator) |
| `server start` / `server stop` | Start/stop the MindServer (bots) |
| `proxy on` | Point bots at ViaProxy (localhost:25568) for 26.2 servers |
| `proxy off` | Point bots directly at the server |
| `logs via [n]` | Show last n ViaProxy log lines |
| `logs server [n]` | Show last n MindServer log lines |
| `clear` | Refresh the dashboard |
| `exit` | Stop everything and quit |

## Connecting to MC 26.2 Servers

mineflayer only supports up to protocol 775 (MC 26.1). ViaProxy translates between versions:

```
mineflayer bots (775) → ViaProxy (localhost:25568) → 26.2 Server (776)
```

In the dashboard: run `via start` then `proxy off` (already configured for the default server).

## Manual Start (without dashboard)

```bash
# ViaProxy
cd services/viaproxy
java -jar ViaProxy-3.4.13-SNAPSHOT.jar

# Bots (in a separate terminal)
npm start
```
