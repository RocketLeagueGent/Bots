import { Server } from 'socket.io';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mindcraft from './mindcraft.js';
import { generateUsername, buildFleetProfile } from './fleet.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fleet bot login credentials (for cracked servers with a login/register plugin).
// Persisted to disk so a bot that joins again uses /login with the SAME password,
// while brand-new bots /register a fresh random password.
const FLEET_CREDENTIALS_FILE = path.join(__dirname, 'fleet_credentials.json');
let fleet_credentials = {};
try {
    if (existsSync(FLEET_CREDENTIALS_FILE)) {
        fleet_credentials = JSON.parse(readFileSync(FLEET_CREDENTIALS_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Could not load fleet_credentials.json:', err);
}

function saveFleetCredentials() {
    try {
        writeFileSync(FLEET_CREDENTIALS_FILE, JSON.stringify(fleet_credentials, null, 2));
    } catch (err) {
        console.error('Could not save fleet_credentials.json:', err);
    }
}

function randomPassword(len = 12) {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pw = '';
    for (let i = 0; i < len; i++) {
        pw += chars[Math.floor(Math.random() * chars.length)];
    }
    return pw;
}

// Ensure an agent profile has login credentials (for AuthMe-style cracked
// servers). Returns the profile with fleet_password / fleet_auth_mode set.
export function ensureFleetCredentials(profile) {
    if (!profile || !profile.name) return profile;
    if (profile.fleet_password) return profile;
    if (fleet_credentials[profile.name]) {
        profile.fleet_password = fleet_credentials[profile.name];
    } else {
        profile.fleet_password = randomPassword();
        profile.fleet_auth_mode = 'register';
        fleet_credentials[profile.name] = profile.fleet_password;
        saveFleetCredentials();
    }
    return profile;
}

// Mindserver is:
// - central hub for communication between all agent processes
// - api to control from other languages and remote users 
// - host for webapp

let io;
let server;
const agent_connections = {};
const agent_listeners = [];

const settings_spec = JSON.parse(readFileSync(path.join(__dirname, 'public/settings_spec.json'), 'utf8'));

class AgentConnection {
    constructor(settings, viewer_port) {
        this.socket = null;
        this.settings = settings;
        this.in_game = false;
        this.full_state = null;
        this.viewer_port = viewer_port;
        this.fleet = false;
    }
    setSettings(settings) {
        this.settings = settings;
    }
}

export function registerAgent(settings, viewer_port) {
    let agentConnection = new AgentConnection(settings, viewer_port);
    agent_connections[settings.profile.name] = agentConnection;
}

export function logoutAgent(agentName) {
    if (agent_connections[agentName]) {
        agent_connections[agentName].in_game = false;
        agentsStatusUpdate();
    }
}

// Validate and fill an agent settings object against the settings spec, then
// hand it to mindcraft.createAgent. Returns { success, error, name? }.
async function createAgentFromSettings(raw_settings) {
    let settings = JSON.parse(JSON.stringify(raw_settings));
    for (let key in settings_spec) {
        if (!(key in settings)) {
            if (settings_spec[key].required) {
                return { success: false, error: `Setting ${key} is required` };
            }
            else {
                settings[key] = settings_spec[key].default;
            }
        }
    }
    for (let key in settings) {
        if (!(key in settings_spec)) {
            delete settings[key];
        }
    }
    if (settings.profile?.name) {
        if (settings.profile.name in agent_connections) {
            return { success: false, error: 'Agent already exists' };
        }
        let returned = await mindcraft.createAgent(settings);
        let name = settings.profile.name;
        if (!returned.success && agent_connections[name]) {
            mindcraft.destroyAgent(name);
            delete agent_connections[name];
        }
        return { success: returned.success, error: returned.error, name };
    }
    else {
        return { success: false, error: 'Agent name is required in profile' };
    }
}

// Initialize the server
export function createMindServer(host_public = false, port = 8080) {
    const app = express();
    server = http.createServer(app);
    io = new Server(server);

    // Serve static files
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    app.use(express.static(path.join(__dirname, 'public')));

    // Serve the Console profile so the UI can recreate the Console bot.
    app.get('/api/console-profile', (req, res) => {
        try {
            const consolePath = path.join(__dirname, '../../console.json');
            const profile = JSON.parse(readFileSync(consolePath, 'utf8'));
            res.json(profile);
        } catch (e) {
            res.status(500).json({ error: String(e) });
        }
    });

    // Texture proxy: resolve item/block textures using minecraft-assets with version fallback
    app.get('/assets/item/:agent/:name.png', async (req, res) => {
        try {
            const agentName = req.params.agent;
            const rawName = req.params.name;
            const itemName = String(rawName).toLowerCase();
            const conn = agent_connections[agentName];
            const preferred = conn?.settings?.minecraft_version;
            const candidates = [];
            if (preferred && preferred !== 'auto') candidates.push(preferred);
            candidates.push('1.21.8');

            // Lazy import to avoid ESM/CJS conflicts
            const mod = await import('minecraft-assets');
            const mcAssetsFactory = mod.default || mod;

            for (const ver of candidates) {
                try {
                    const assets = mcAssetsFactory(ver);
                    // Prefer items path first, then blocks
                    const item = assets.items[itemName];
                    const block = assets.blocks[itemName];
                    const tex = assets.textureContent?.[itemName]?.texture
                        || (item ? assets.textureContent?.[itemName]?.texture : null)
                        || (block ? assets.textureContent?.[itemName]?.texture : null);
                    if (tex) {
                        // textureContent already provides a data URL in many versions
                        if (tex.startsWith('data:image')) {
                            const base64 = tex.split(',')[1];
                            const img = globalThis.Buffer.from(base64, 'base64');
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(img);
                        }
                    }
                    // If textureContent missing, try static path resolution inside package
                    // Helps with some strange blocks like Leaf Litter
                    const guessPaths = [];
                    const base = assets.directory;
                    guessPaths.push(path.join(base, 'items', `${itemName}.png`));
                    guessPaths.push(path.join(base, 'blocks', `${itemName}.png`));
                    for (const p of guessPaths) {
                        try {
                            const fsMod = await import('fs');
                            const buf = fsMod.readFileSync(p);
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(buf);
                        } catch { /* ignore */ }
                    }
                } catch { /* ignore */ }
            }
            // Not found, fallback svg
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(404).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">?</text></svg>');
        } catch (e) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(500).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">!</text></svg>');
        }
    });

    // Socket.io connection handling
    io.on('connection', (socket) => {
        let curAgentName = null;
        console.log('Client connected');

        agentsStatusUpdate(socket);

        socket.on('create-agent', async (settings, callback) => {
            console.log('API create agent...');
            let result = await createAgentFromSettings(settings);
            callback({ success: result.success, error: result.error });
            if (result.success) agentsStatusUpdate();
        });

        socket.on('get-settings', (agentName, callback) => {
            if (agent_connections[agentName]) {
                callback({ settings: agent_connections[agentName].settings });
            } else {
                callback({ error: `Agent '${agentName}' not found.` });
            }
        });

        socket.on('connect-agent-process', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agentsStatusUpdate();
            }
        });

        socket.on('login-agent', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agent_connections[agentName].in_game = true;
                curAgentName = agentName;
                agentsStatusUpdate();
            }
            else {
                console.warn(`Unregistered agent ${agentName} tried to login`);
            }
        });

        socket.on('disconnect', () => {
            if (agent_connections[curAgentName]) {
                console.log(`Agent ${curAgentName} disconnected`);
                agent_connections[curAgentName].in_game = false;
                agent_connections[curAgentName].socket = null;
                agentsStatusUpdate();
            }
            if (agent_listeners.includes(socket)) {
                removeListener(socket);
            }
        });

        socket.on('chat-message', (agentName, json) => {
            const conn = agent_connections[agentName];
            if (!conn || !conn.socket) {
                console.warn(`Agent ${agentName} tried to send a message but is not connected`);
                return;
            }
            console.log(`${curAgentName} sending message to ${agentName}: ${json.message}`);
            conn.socket.emit('chat-message', curAgentName, json);
        });

        socket.on('set-agent-settings', (agentName, settings) => {
            const agent = agent_connections[agentName];
            if (agent) {
                agent.setSettings(settings);
                if (agent.socket) agent.socket.emit('restart-agent');
            }
        });

        socket.on('restart-agent', (agentName) => {
            const conn = agent_connections[agentName];
            if (!conn || !conn.socket) {
                console.warn(`Cannot restart agent ${agentName}; not connected`);
                return;
            }
            console.log(`Restarting agent: ${agentName}`);
            conn.socket.emit('restart-agent');
        });

        socket.on('stop-agent', (agentName) => {
            mindcraft.stopAgent(agentName);
        });

        socket.on('start-agent', (agentName) => {
            mindcraft.startAgent(agentName);
        });

        socket.on('destroy-agent', (agentName) => {
            if (agent_connections[agentName]) {
                mindcraft.destroyAgent(agentName);
                delete agent_connections[agentName];
            }
            agentsStatusUpdate();
        });

        socket.on('spawn-fleet', async (data, callback) => {
            const host = data.host || '127.0.0.1';
            const port = data.port !== undefined && data.port !== null && data.port !== '' ? Number(data.port) : -1;
            const auth = data.auth || 'offline';
            const minecraft_version = data.minecraft_version || 'auto';
            const count = Math.min(Math.max(parseInt(data.count) || 1, 1), 200);
            const masterName = data.master_name || 'RocketLeagueGent';
            const render_view = data.render_view === true;

            console.log(`Spawning fleet of ${count} agents on ${host}:${port} for master ${masterName}...`);
            // Pre-generate all usernames so every bot knows the full friendly roster.
            const roster = [];
            while (roster.length < count) {
                let username = generateUsername();
                let tries = 0;
                while ((agent_connections[username] || roster.includes(username)) && tries < 20) {
                    tries++;
                    username = generateUsername();
                }
                if (agent_connections[username] || roster.includes(username)) break;
                roster.push(username);
            }
            const created = [];
            const failed = [];
            for (let username of roster) {
                const profile = buildFleetProfile(username, masterName);
                ensureFleetCredentials(profile);
                profile.fleet_bot = true;
                profile.fleet_names = roster;
                const settings = {
                    profile,
                    minecraft_version,
                    host,
                    port,
                    auth,
                    base_profile: 'survival',
                    load_memory: false,
                    // empty init_message -> no LLM call at spawn (198 calls at once
                    // would hit the API rate limit). Bots greet in chat instead.
                    init_message: '',
                    // Fleet bots ONLY talk to their master — random players cannot
                    // trigger LLM calls (OpenRouter free tier is 50 req/day).
                    only_chat_with: [masterName],
                    render_bot_view: render_view,
                    allow_vision: false,
                    chat_ingame: true,
                    show_command_syntax: 'shortened',
                    narrate_behavior: false,
                    spawn_timeout: 60,
                    max_messages: 10,
                    max_commands: 2,
                    num_examples: 2
                };
                let result = await createAgentFromSettings(settings);
                if (result.success && agent_connections[username]) {
                    agent_connections[username].fleet = true;
                    created.push({ username, viewerPort: agent_connections[username].viewer_port });
                }
                else {
                    failed.push({ username, error: result.error });
                }
            }
            agentsStatusUpdate();
            if (callback) callback({ created, failed });
        });

        socket.on('broadcast-message', (data) => {
            const message = data.message;
            const from = data.from || 'RocketLeagueGent';
            const onlyFleet = data.only_fleet !== false;
            if (!message || !message.trim()) return;
            let sentCount = 0;
            for (let agentName in agent_connections) {
                const conn = agent_connections[agentName];
                if (onlyFleet && !conn.fleet) continue;
                if (!conn.socket || !conn.in_game) continue;
                try {
                    conn.socket.emit('send-message', { from, message });
                    sentCount++;
                } catch (error) {
                    console.error(`Error broadcasting to ${agentName}:`, error);
                }
            }
            console.log(`Broadcast "${message}" from ${from} to ${sentCount} agents`);
        });

        socket.on('destroy-fleet', () => {
            let count = 0;
            for (let agentName in agent_connections) {
                const conn = agent_connections[agentName];
                if (conn.fleet) {
                    mindcraft.destroyAgent(agentName);
                    delete agent_connections[agentName];
                    count++;
                }
            }
            console.log(`Destroyed ${count} fleet agents`);
            agentsStatusUpdate();
        });

        socket.on('stop-all-agents', () => {
            console.log('Killing all agents');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
        });

        socket.on('shutdown', () => {
            console.log('Shutting down');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
            // wait 2 seconds
            setTimeout(() => {
                console.log('Exiting MindServer');
                globalThis.process.exit(0);
            }, 2000);
            
        });

		socket.on('send-message', (agentName, data) => {
			if (!agent_connections[agentName]) {
				console.warn(`Agent ${agentName} not in game, cannot send message via MindServer.`);
                return;
			}
			try {
                agent_connections[agentName].socket.emit('send-message', data);
			} catch (error) {
				console.error('Error: ', error);
			}
		});

        // Execute a chat command (e.g. /tpa) on one agent directly, no LLM.
        socket.on('execute-chat-command', (agentName, data) => {
            const conn = agent_connections[agentName];
            if (!conn || !conn.socket || !conn.in_game) {
                console.warn(`Agent ${agentName} not in game, cannot execute chat command.`);
                return;
            }
            try {
                conn.socket.emit('execute-chat-command', { command: data?.command });
            } catch (error) {
                console.error('Error: ', error);
            }
        });

        // Broadcast a chat command to the whole fleet (or all agents).
        socket.on('broadcast-chat-command', (data) => {
            const command = data?.command;
            if (!command || !command.trim()) return;
            const onlyFleet = data.only_fleet !== false;
            let sentCount = 0;
            for (let agentName in agent_connections) {
                const conn = agent_connections[agentName];
                if (onlyFleet && !conn.fleet) continue;
                if (!conn.socket || !conn.in_game) continue;
                try {
                    conn.socket.emit('execute-chat-command', { command });
                    sentCount++;
                } catch (error) {
                    console.error(`Error broadcasting chat command to ${agentName}:`, error);
                }
            }
            console.log(`Broadcast chat command "${command}" to ${sentCount} agents`);
        });

        socket.on('bot-output', (agentName, message) => {
            io.emit('bot-output', agentName, message);
        });

        socket.on('listen-to-agents', () => {
            addListener(socket);
        });
    });

    if (host_public) {
        console.log('Public hosting not supported yet. Using localhost.');
    }
    const host = 'localhost';
    server.listen(port, host, () => {
        console.log(`MindServer running on port ${port} on host ${host}`);
    });

    return server;
}

function agentsStatusUpdate(socket) {
    if (!socket) {
        socket = io;
    }
    let agents = [];
    for (let agentName in agent_connections) {
        const conn = agent_connections[agentName];
        agents.push({
            name: agentName, 
            in_game: conn.in_game,
            viewerPort: conn.viewer_port,
            socket_connected: !!conn.socket,
            fleet: conn.fleet === true
        });
    };
    socket.emit('agents-status', agents);
}


let listenerInterval = null;
function addListener(listener_socket) {
    agent_listeners.push(listener_socket);
    if (agent_listeners.length === 1) {
        listenerInterval = setInterval(async () => {
            const states = {};
            for (let agentName in agent_connections) {
                let agent = agent_connections[agentName];
                if (agent.in_game) {
                    try {
                        const state = await new Promise((resolve) => {
                            agent.socket.emit('get-full-state', (s) => resolve(s));
                        });
                        states[agentName] = state;
                    } catch (e) {
                        states[agentName] = { error: String(e) };
                    }
                }
            }
            for (let listener of agent_listeners) {
                listener.emit('state-update', states);
            }
        }, 3000);
    }
}

function removeListener(listener_socket) {
    agent_listeners.splice(agent_listeners.indexOf(listener_socket), 1);
    if (agent_listeners.length === 0) {
        clearInterval(listenerInterval);
        listenerInterval = null;
    }
}

// Optional: export these if you need access to them from other files
export const getIO = () => io;
export const getServer = () => server;
export const numStateListeners = () => agent_listeners.length;