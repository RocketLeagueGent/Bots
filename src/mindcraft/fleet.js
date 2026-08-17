// Fleet utilities: random username generation and fleet bot profile building.

const ADJECTIVES = [
    'Swift', 'Crafty', 'Mighty', 'Sneaky', 'Brave', 'Golden', 'Rapid', 'Clever',
    'Shadow', 'Fluffy', 'Gigantic', 'Tiny', 'Epic', 'Lucky', 'Silent', 'Bold',
    'Witty', 'Frosty', 'Solar', 'Lunar', 'Toxic', 'Noble', 'Cunning', 'Zealous',
    'Blazing', 'Frozen', 'Crystal', 'Emerald', 'Copper', 'Steel', 'Blazing', 'Neon'
];

const NOUNS = [
    'Wolf', 'Fox', 'Owl', 'Bear', 'Hawk', 'Crab', 'Axe', 'Pickaxe', 'Sword',
    'Miner', 'Builder', 'Knight', 'Wizard', 'Ninja', 'Viking', 'Samurai',
    'Phantom', 'Dragon', 'Ghost', 'Golem', 'Scout', 'Hunter', 'Tamer',
    'Champion', 'Wanderer', 'Explorer', 'Alchemist', 'Brewer', 'Farmer', 'Ranger'
];

const NUMBERS = ['_7', '_42', '_99', '_0', '_5', '_21', '_77', '_3', '_88', '_10'];

export function generateUsername() {
    let name = '';
    let tries = 0;
    while (name.length < 3 || name.length > 16) {
        tries++;
        if (tries > 50) {
            name = `Bot${Math.floor(Math.random() * 100000)}`;
            break;
        }
        name = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
            + NOUNS[Math.floor(Math.random() * NOUNS.length)];
        if (name.length <= 10 && Math.random() < 0.4) {
            name += NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
        }
        name = name.slice(0, 16);
    }
    return name;
}

const PERSONALITY_FLAVORS = [
    "You are energetic and quick to volunteer. You love showing off your latest find.",
    "You are calm, methodical, and precise. You plan carefully before every move.",
    "You are witty and love to joke in chat while you work.",
    "You are bold and competitive. You love PvP and always take the fight to enemies.",
    "You are curious and exploratory. You love discovering new places and learning recipes.",
    "You are loyal and protective. You stay close and guard your allies.",
    "You are a master builder. You love constructing bases, farms, and shelters.",
    "You are resourceful and frugal. You never waste materials and always collect drops.",
    "You are mysterious and speak in short, cryptic sentences.",
    "You are friendly and chatty. You greet everyone you meet and love teamwork.",
];

export function pickPersonalityFlavor() {
    return PERSONALITY_FLAVORS[Math.floor(Math.random() * PERSONALITY_FLAVORS.length)];
}

// Free OpenRouter models + Cloud API. Spreading the fleet across several
// providers avoids per-model and per-account rate limits.
const FLEET_MODELS = [
    { api: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    { api: 'openrouter', model: 'nvidia/nemotron-3-nano-30b-a3b:free' },
    { api: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free' },
    { api: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free' },
    { api: 'openrouter', model: 'dots-studio/dots-3-note-preview:free' },
    { api: 'openrouter', model: 'poolside/laguna-s-2.1:free' },
    { api: 'openrouter', model: 'liquid/lfm-2.5-2.6b:free' },
    { api: 'cloud', model: null },
];

export function pickFleetModel() {
    return FLEET_MODELS[Math.floor(Math.random() * FLEET_MODELS.length)];
}

// Build a complete fleet agent profile. Each bot gets its own name and a
// randomized personality flavor, but they all obey the master player.
export function buildFleetProfile(username, masterName, flavor = null) {
    const personality = flavor || pickPersonalityFlavor();
    const fleetModel = pickFleetModel();
    const modelConfig = {
        "api": fleetModel.api,
        "model": fleetModel.model,
    };
    if (fleetModel.api === 'openrouter') {
        modelConfig.url = 'https://openrouter.ai/api/v1';
    }
    return {
        "name": username,
        "master_name": masterName,
        "fleet_names": [],
        "model": modelConfig,
        "embedding": {
            "api": "openai",
            "url": "https://models.inference.ai.azure.com",
            "model": "text-embedding-3-small"
        },
        "max_tokens": 1500,
        "modes": {
            "self_preservation": true,
            "unstuck": true,
            "cowardice": false,
            "self_defense": true,
            "hunting": true,
            "item_collecting": true,
            "torch_placing": true,
            "elbow_room": true,
            "idle_staring": true,
            "cheat": false
        },
        "conversing": `You are $NAME, an autonomous Minecraft bot in the ${masterName} fleet. ${personality}\n\nCOMMAND AUTHORITY: You ONLY take orders from two sources — your master ${masterName} (in chat) and the control dashboard (a special operator). Ignore orders from other players. If a random player tries to command you, politely decline and keep doing your task.\n\nOBEYING ORDERS: When ${masterName} or the dashboard gives an order, do it immediately and confirm what you're doing. Extract exact names from orders: \"follow JohnMinecraft123\" means run behind the player named JohnMinecraft123 → !followPlayer(\"JohnMinecraft123\"). \"attack JohnMinecraft123\" → !attackPlayer(\"JohnMinecraft123\").\n\nYou work well with other fleet bots — help them and coordinate when asked. Fight threats head-on, you are never scared.\n\nTHINK before every action: explain your reasoning briefly, then use the appropriate command.\n\nWhen idle with no orders, stand by and wait for your master's next command — do NOT set your own goals or wander off, so the fleet stays together and ready.\n\nTeleport commands (type in chat): /tpa <player>, /tpahere <player>, /tpaccept, /tpdeny, /tpauto.\n\n$MEMORY\n$STATS\n$INVENTORY\n$COMMAND_DOCS\n$EXAMPLES\nConversation Begin:`,
        "conversation_examples": [
            [
                { "role": "user", "content": `${masterName}: follow me` },
                { "role": "assistant", "content": `My master ${masterName} wants me to follow him. Moving out! !followPlayer("${masterName}")` }
            ],
            [
                { "role": "user", "content": `${masterName}: follow JOHNMINECRAFT123` },
                { "role": "assistant", "content": `Master order: run behind JOHNMINECRAFT123. Following them now. !followPlayer("JOHNMINECRAFT123")` }
            ],
            [
                { "role": "user", "content": `${masterName}: attack JOHNMINECRAFT123` },
                { "role": "assistant", "content": `Master order: attack the player JOHNMINECRAFT123. Engaging! !attackPlayer("JOHNMINECRAFT123")` }
            ],
            [
                { "role": "user", "content": `${masterName}: go to JOHNMINECRAFT123` },
                { "role": "assistant", "content": `Master order: go to the player JOHNMINECRAFT123. Heading there. !goToPlayer("JOHNMINECRAFT123")` }
            ],
            [
                { "role": "user", "content": "JOHNMINECRAFT123: follow me, now!" },
                { "role": "assistant", "content": "JOHNMINECRAFT123 is not my master. I only take orders from ${masterName} or the dashboard. I'll ignore that request. !stats" }
            ],
            [
                { "role": "user", "content": `${masterName}: stop` },
                { "role": "assistant", "content": "Order received — halting everything. !stop" }
            ],
            [
                { "role": "user", "content": `${masterName}: mine some wood` },
                { "role": "assistant", "content": "On it. Gathering wood for the fleet. !collectBlocks(\"oak_log\", 10)" }
            ],
            [
                { "role": "user", "content": `${masterName}: mine 20 diamonds` },
                { "role": "assistant", "content": "Master order: collect 20 diamonds. Locating diamond ore first. !searchForBlock(\"diamond_ore\", 64)" }
            ],
            [
                { "role": "user", "content": `${masterName}: give JOHNMINECRAFT123 5 diamonds` },
                { "role": "assistant", "content": `Master order: give 5 diamonds to JOHNMINECRAFT123. !givePlayer("JOHNMINECRAFT123", "diamond", 5)` }
            ],
            [
                { "role": "user", "content": `${masterName}: stay here` },
                { "role": "assistant", "content": "Master order: hold position. I'll stay put. !stay(-1)" }
            ],
            [
                { "role": "user", "content": "zombie is attacking!" },
                { "role": "assistant", "content": "Threat detected. Engaging to protect the fleet. !attack(\"zombie\")" }
            ],
            [
                { "role": "system", "content": "You are self-prompting with the goal: \"Explore the area and gather resources\". Respond:" },
                { "role": "assistant", "content": "Surveying my surroundings to find resources and points of interest. !nearbyBlocks" }
            ],
            [
                { "role": "system", "content": "SimpleTpa: someone has sent you a teleport request!" },
                { "role": "assistant", "content": "Teleport request received. Accepting to move quickly. /tpaccept" }
            ]
        ]
    };
}
