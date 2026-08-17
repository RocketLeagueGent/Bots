# ViaProxy - Protocol Translator

Translate between Minecraft protocol versions so mineflayer bots can connect to servers they don't natively support (e.g. 26.2).

## How it works

```
mineflayer (protocol 775) --> ViaProxy (localhost:25568) --> 26.2 Server (protocol 776)
```

ViaProxy sits between the bots and the server, translating packets in real time.

## Quick start (no Docker required)

1. Install Java 17+ (you already have Java 25)
2. Run `services/viaproxy/start.bat`
3. Point `settings.js` to ViaProxy:

```javascript
    "host": "localhost",
    "port": 25568,
```

4. Run `npm start` as usual

## Configuration

Edit `services/viaproxy/viaproxy.yml`:

- `target-address` — the real server address (default: `VanillaSMP_S2.aternos.me:19523`)
- `bind-address` — local port ViaProxy listens on (default: `0.0.0.0:25568`)
- `target-version` — `Auto Detect (1.7+ servers)` works for most cases

## Online mode servers

ViaProxy supports Microsoft account authentication:

1. Start ViaProxy with the GUI: `java -jar ViaProxy-3.4.13-SNAPSHOT.jar`
2. Add your Microsoft account in the Accounts tab
3. Set `auth-method: account` in `viaproxy.yml`

## Files

- `ViaProxy-3.4.13-SNAPSHOT.jar` — dev build with 26.2 support (Aug 2026)
- `viaproxy.yml` — configuration
- `start.bat` — Windows startup script
