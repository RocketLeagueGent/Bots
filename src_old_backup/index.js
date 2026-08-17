require('dotenv').config();
require('./patches');
const { createBot } = require('./bot');
const { createClient } = require('./gemini');
const { SYSTEM_PROMPT, parseAction, buildContext } = require('./self-prompt');
const { createBrain } = require('./brain');

const THINK_INTERVAL = (parseInt(process.env.THINK_INTERVAL || '6', 10)) * 1000;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let selfTraits = [];

async function executeAction(bot, parsed) {
  const { action, args } = parsed;
  try {
    switch (action) {
      case 'explore': {
        const pos = bot.bot.entity.position;
        const range = 25;
        const x = Math.floor(pos.x + (Math.random() - 0.5) * range * 2);
        const z = Math.floor(pos.z + (Math.random() - 0.5) * range * 2);
        return await bot.moveTo(x, z);
      }
      case 'move_to':
        if (args.x !== undefined && args.z !== undefined) {
          return await bot.moveTo(args.x, args.z);
        }
        return 'missing coords';
      case 'move_to_xyz':
        if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
          return await bot.moveToXYZ(args.x, args.y, args.z);
        }
        return 'missing coords';
      case 'follow':
        if (args.player) {
          return await bot.followPlayer(args.player);
        }
        return 'missing player name';
      case 'look_at':
        if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
          await bot.lookAt(args.x, args.y, args.z);
          return `looked at (${args.x}, ${args.y}, ${args.z})`;
        }
        return 'missing coords';
      case 'jump':
        await bot.jump();
        return 'jumped';
      case 'mine':
        if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
          return await bot.digBlock(args.x, args.y, args.z);
        }
        return 'missing coords';
      case 'place':
        if (args.x !== undefined && args.y !== undefined && args.z !== undefined && args.block) {
          return await bot.placeBlock(args.x, args.y, args.z, args.block);
        }
        return 'missing build args';
      case 'attack':
        if (args.name) {
          return await bot.attackEntity(args.name);
        }
        return 'missing target name';
      case 'attack_nearest':
        return await bot.attackNearestHostile();
      case 'equip':
        if (args.item) {
          return await bot.equipItem(args.item);
        }
        return 'missing item name';
      case 'equip_armour':
        if (args.item) {
          return await bot.equipArmour(args.item);
        }
        return 'missing item name';
      case 'eat':
        return await bot.consumeItem();
      case 'activate':
        if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
          return await bot.activateBlock(args.x, args.y, args.z);
        }
        return 'missing coords';
      case 'use_item':
        return await bot.useItem();
      case 'craft':
        if (args.item) {
          return await bot.craftItem(args.item, args.count || 1);
        }
        return 'missing item name';
      case 'chat':
        if (args.message) {
          await bot.say(args.message);
          return `said: "${args.message.slice(0, 80)}"`;
        }
        return 'no message';
      case 'wait':
        return 'waited';
      case 'set_goal':
        return `new goal: ${args.goal || 'none'}`;
      case 'equip_elytra':
        return await bot.equipElytra();
      case 'fly':
        return await bot.fly();
      case 'unequip_armour':
        if (args.slot) return await bot.unequipArmour(args.slot);
        return 'missing slot (head/torso/legs/feet)';
      case 'drop':
        if (args.item) return await bot.dropItem(args.item, args.count || 1);
        return 'missing item name';
      case 'drop_all':
        return await bot.dropAll();
      case 'remember':
        if (args.trait) {
          selfTraits.push(args.trait);
          if (selfTraits.length > 10) selfTraits.shift();
          return `remembered: ${args.trait}`;
        }
        return 'no trait provided';
      default:
        return `unknown action: ${action}`;
    }
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function main() {
  const name = 'Console';
  let bot;
  let gemini;
  let currentGoal = 'Explore the world and see what\'s here';
  let actionHistory = [];
  let pendingCommands = [];
  let thinkTimer = null;
  let keepRunning = true;
  let processing = false;
  let serverMOTD = '';

  console.log(`\n${name} — awake.\n`);

  // Ping server to get MOTD before joining
  try {
    const ping = await require('minecraft-protocol').ping({
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_PORT || '25565', 10),
      version: process.env.MC_VERSION || '26.1.2',
    });
    serverMOTD = ping.description?.text || ping.description || 'unknown';
    console.log(`[${name}] Server MOTD: ${serverMOTD}`);
    console.log(`[${name}] Players: ${ping.players?.online || 0}/${ping.players?.max || 0}`);
  } catch (err) {
    console.log(`[${name}] Could not ping server: ${err.message}`);
    serverMOTD = 'unknown';
  }

  function getBaseContext(extra = '') {
    let ctx = `## Server Info\nThe server says: "${serverMOTD}"\n`;
    if (extra) ctx += extra + '\n';
    return ctx;
  }

  async function processGemini(fullContext) {
    if (processing) return;
    processing = true;
    try {
      const enriched = brain.buildEnrichedContext(fullContext);
      const systemPrompt = SYSTEM_PROMPT(name, selfTraits);
      const response = await gemini.think(systemPrompt, enriched);
      console.log(`[${name}] RAW:`, JSON.stringify(response).slice(0, 500));
      const parsed = parseAction(response);
      if (parsed) {
        console.log(`[${name}] -> ${parsed.action}: ${parsed.thought}`);
        const result = await executeAction(bot, parsed);
        brain.ingestActionResult(parsed.action, result);
        actionHistory.push(`${parsed.action}: ${parsed.thought} — ${result}`);
        if (actionHistory.length > 20) actionHistory.shift();
        if (parsed.action === 'set_goal' && parsed.args.goal) {
          currentGoal = parsed.args.goal;
          brain.planner.addGoal(parsed.args.goal, 'explore', 'self');
        }
        if (parsed.action === 'remember' && parsed.args.trait) {
          brain.knowledge.learn(parsed.args.trait, 'self', 0.7);
        }
        // Speak if a SAY line was provided, otherwise say the thought
        bot.say(parsed.say || parsed.thought || `...`);
        console.log(`[${name}] done: ${result}`);
      } else {
        console.log(`[${name}] bad response from Gemini`);
      }
    } catch (err) {
      console.error(`[${name} ERROR] ${err.message}`);
    }
    processing = false;
  }

  async function doThink() {
    if (!keepRunning || !bot || processing) return;
    const state = bot.getState();
    brain.ingestState(state);
    const recentChat = bot.getRecentChat(4);
    let extra = '';
    if (pendingCommands.length > 0) {
      extra = '## Pending Commands\n' + pendingCommands.join('\n');
      pendingCommands = [];
    }
    const goalFromPlanner = brain.planner.currentGoalDescription();
    const activeGoal = goalFromPlanner || currentGoal;
    const context = buildContext(state, recentChat, activeGoal, extra);
    const actionsSummary = actionHistory.slice(-3).join('\n');
    const baseContext = getBaseContext();
    const fullContext = baseContext + context + (actionsSummary ? `\n\n## Recent Actions\n${actionsSummary}` : '');
    console.log(`\n[${name}] thinking (goal: ${activeGoal})`);
    await processGemini(fullContext);
    brain.saveAll();
  }

  function scheduleThink(delay = THINK_INTERVAL + Math.random() * 2000) {
    if (thinkTimer) clearTimeout(thinkTimer);
    thinkTimer = setTimeout(async () => {
      await doThink();
      scheduleThink();
    }, delay);
  }

  const TREE_LOGS = ['oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'];
  const STONE_BLOCKS = ['stone','cobblestone','andesite','diorite','granite','deepslate'];

  async function instantDig(targetNames, reply) {
    try {
      const block = bot.bot.findBlock({ matching: (b) => targetNames.includes(b.name), maxDistance: 12 });
      if (!block) { bot.say('dont see any'); return; }
      const r = await bot.digBlock(block.position.x, block.position.y, block.position.z);
      bot.say(reply || 'got it');
      console.log(`[${name}] instant: ${r}`);
    } catch (err) { bot.say('cant reach it'); console.log(`[${name}] instant error: ${err.message}`); }
  }

  function stopMoving() {
    bot.bot.pathfinder?.setGoal(null);
    ['forward','back','left','right','jump','sprint'].forEach(c => bot.bot.setControlState(c, false));
  }

  function handleCommandInstantly(username, msg) {
    const lower = msg.trim().toLowerCase().replace(/["']/g, '');
    const words = lower.split(/\s+/);

    // Chat commands (/tpaccept, /tpa, etc.)
    if (lower.startsWith('/')) {
      bot.say(lower);
      console.log(`[${name}] instant: sent ${lower}`);
      return true;
    }

    // Teleport requests
    if (/accept.*tpa|tpa.*accept/i.test(lower)) { bot.say('/tpaccept'); return true; }
    if (/deny.*tpa|tpa.*deny/i.test(lower)) { bot.say('/tpdeny'); return true; }

    // "tpahere me" or "tpahere <name>"
    const tpahereMatch = lower.match(/^(?:do\s+)?\/?tpahere\s+(.+)$/i);
    if (tpahereMatch) { bot.say(`/tpahere ${tpahereMatch[1]}`); return true; }
    if (/^tpahere\s*me$/i.test(lower)) { bot.say(`/tpahere ${username}`); return true; }

    // "tpa <name>"
    const tpaMatch = lower.match(/^(?:do\s+)?\/?tpa\s+(.+)$/i);
    if (tpaMatch) { bot.say(`/tpa ${tpaMatch[1]}`); return true; }

    // "follow me" / "come with me" / "come"
    if (/^(?:follow|come\s+(?:with\s+)?me|follow\s+me|come\s*)$/i.test(lower)) {
      bot.followPlayer(username).then(r => console.log(`[${name}] instant: ${r}`));
      bot.say('on my way'); return true;
    }

    // "come here" / "get over here" / "come to me" / "come up here"
    if (/come\s*(?:here|to\s+me|up\s+here)|get\s+over\s+here|tpa\s+to\s+me/i.test(lower)) {
      bot.say(`/tpa ${username}`); console.log(`[${name}] instant: tpa to ${username}`); return true;
    }

    // "stop" / "stay" / "wait" / "dont move" / "freeze" / "stop what you're doing"
    if (/^(?:stop|stay|wait|halt|freeze|stand still|dont\s+move|stop\s+what)/i.test(lower)
        || /^(?:no|n|stop|stay|wait)$/i.test(words[0])) {
      stopMoving(); bot.say('aight im chill'); console.log(`[${name}] instant: stopped`); return true;
    }

    // "break/mine/chop/dig/hit tree/wood/stone/etc"
    if (/^(?:break|mine|chop|dig|cut|hit)\s/i.test(lower)) {
      if (/tree|wood|log|oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry/i.test(lower)) {
        instantDig(TREE_LOGS, 'chopped it');
      } else if (/stone|cobble|rock|deepslate|andesite|granite|diorite/i.test(lower)) {
        instantDig(STONE_BLOCKS, 'mined it');
      } else {
        instantDig([...TREE_LOGS, ...STONE_BLOCKS], 'broke it');
      }
      return true;
    }

    // "get wood" / "get stone" — mine it
    if (/^get\s+(?:some\s+)?(wood|log|tree|stone|cobble|iron|coal|diamond|gold|dirt)/i.test(lower)) {
      const target = lower.match(/^get\s+(?:some\s+)?(wood|log|tree|stone|cobble|iron|coal|diamond|gold|dirt)/i)[1];
      if (/wood|log|tree/i.test(target)) instantDig(TREE_LOGS, 'getting wood');
      else if (/stone|cobble/i.test(target)) instantDig(STONE_BLOCKS, 'getting stone');
      else instantDig([...TREE_LOGS, ...STONE_BLOCKS], 'getting that');
      return true;
    }

    // "attack/kill/fight <entity>"
    const attackMatch = lower.match(/^(?:attack|kill|fight)\s+(?:the |that |a |an )?(.+)$/);
    if (attackMatch) {
      bot.attackEntity(attackMatch[1]).then(r => { bot.say('got em'); console.log(`[${name}] instant: ${r}`); });
      return true;
    }

    // "equip <item>" / "hold <item>" / "wield <item>"
    const equipMatch = lower.match(/^(?:equip|hold|wield)\s+(?:your |the |a |an )?(.+)$/);
    if (equipMatch) {
      bot.equipItem(equipMatch[1]).then(r => console.log(`[${name}] instant: ${r}`));
      return true;
    }

    // "eat" / "consume" / "feed"
    if (/^(?:eat|consume|feed)/i.test(lower)) {
      bot.consumeItem().then(r => console.log(`[${name}] instant: ${r}`));
      return true;
    }

    // "jump"
    if (/^jump/i.test(lower)) { bot.jump(); return true; }

    // "craft <item>" / "make <item>"
    const craftMatch = lower.match(/^(?:craft|make)\s+(?:a |an |some )?(.+)$/);
    if (craftMatch) {
      bot.craftItem(craftMatch[1], 1).then(r => console.log(`[${name}] instant: ${r}`));
      return true;
    }

    // "fly" / "use elytra" / "equip elytra"
    if (/^(?:fly|use elytra|equip elytra)/i.test(lower)) {
      if (/^equip elytra/i.test(lower)) {
        bot.equipElytra().then(r => console.log(`[${name}] instant: ${r}`));
      } else {
        bot.fly().then(r => console.log(`[${name}] instant: ${r}`));
      }
      return true;
    }

    // "unequip/remove/take off <slot>"
    const unequipMatch = lower.match(/^(?:unequip|remove|take off)\s+(?:your |the )?(helmet|chestplate|elytra|leggings|boots|head|torso|legs|feet)/i);
    if (unequipMatch) {
      bot.unequipArmour(unequipMatch[1]).then(r => console.log(`[${name}] instant: ${r}`));
      return true;
    }

    // "drop <item> [count]" / "toss <item>"
    const dropMatch = lower.match(/^(?:drop|toss|throw away)\s+(?:your |the |a |an )?(\w+(?:\s+\w+)?)(?:\s+x?(\d+))?$/i);
    if (dropMatch) {
      const item = dropMatch[1];
      const count = parseInt(dropMatch[2] || '1', 10);
      bot.dropItem(item, count).then(r => console.log(`[${name}] instant: ${r}`));
      return true;
    }
    if (/^(?:drop|toss|throw away)\s+(?:all|everything|inv|inventory)/i.test(lower)) {
      bot.dropAll().then(r => console.log(`[${name}] instant: ${r}`));
      return true;
    }

    return false;
  }

  function handleCommand(username, message) {
    if (username === 'Console' || !bot) return;
    console.log(`\n[${name}] COMMAND from ${username}: ${message}`);
    brain.ingestChat(username, message);
    if (bot.bot.pathfinder) bot.bot.pathfinder.setGoal(null);
    // Auto-accept teleport requests (server messages)
    if (/has sent you a teleport|to accept the teleport/i.test(message)) {
      bot.say('/tpaccept');
      console.log(`[${name}] Auto-accepted teleport request`);
      return;
    }
    if (handleCommandInstantly(username, message)) return;
    pendingCommands.push(`<${username}> ${message}`);
    if (pendingCommands.length > 5) pendingCommands.shift();
    scheduleThink(500);
  }

  async function reconnectLoop(reason) {
    console.log(`[${name}] Disconnected (${reason}). Reconnecting in 10s...`);
    bot?.bot?.removeAllListeners();
    if (thinkTimer) clearTimeout(thinkTimer);
    await delay(10000);
    while (keepRunning) {
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          bot = createBot(name);
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timed out waiting for spawn')), 60000);
            bot.bot.once('spawn', () => { clearTimeout(timeout); resolve(); });
            bot.bot.once('error', (err) => { clearTimeout(timeout); reject(err); });
            bot.bot.once('end', (reason) => { clearTimeout(timeout); reject(new Error(reason || 'disconnected')); });
          });
          console.log(`[${name}] Rejoined the world!`);
          bot.bot.on('chat', handleCommand);
          bot.bot.once('end', reconnectLoop);
          bot.bot.on('error', (err) => console.log(`[${name}] Error: ${err.message}`));
          scheduleThink(1000);
          return;
        } catch (err) {
          console.log(`[${name}] Reconnect attempt ${attempt} failed: ${err.message}`);
          bot?.bot?.removeAllListeners();
          bot?.bot?.end?.('retrying');
          if (attempt < 10) await delay(5000);
        }
      }
      console.log(`[${name}] All reconnect attempts failed. Waiting 30s...`);
      await delay(30000);
    }
  }

  // Initial connection
  gemini = await createClient();
  const brain = createBrain(name);
  console.log(`--- ${name} ---`);
  await gemini.warmup();
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      bot = createBot(name);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for spawn')), 60000);
        bot.bot.once('spawn', () => { clearTimeout(timeout); resolve(); });
        bot.bot.once('error', (err) => { clearTimeout(timeout); reject(err); });
        bot.bot.once('end', (reason) => { clearTimeout(timeout); reject(new Error(reason || 'disconnected')); });
      });
      break;
    } catch (err) {
      console.log(`[${name}] Attempt ${attempt} failed: ${err.message}`);
      bot?.bot?.removeAllListeners();
      bot?.bot?.end?.('retrying');
      if (attempt === 10) {
        console.log(`[${name}] Giving up.`);
        process.exit(1);
      }
      await delay(5000);
    }
  }

  console.log(`[${name}] Joined the world!`);
  bot.bot.on('chat', handleCommand);
  bot.bot.once('end', reconnectLoop);
  bot.bot.on('error', (err) => console.log(`[${name}] Error: ${err.message}`));
  bot.say(`${name} has entered the world.`);
  scheduleThink(1000);
}

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason?.message || reason);
});
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
