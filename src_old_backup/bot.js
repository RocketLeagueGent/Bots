const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3').Vec3;

const RECENT_CHAT = [];
const MAX_CHAT_HISTORY = 50;

function createBot(usernameOverride) {
  const host = process.env.MC_HOST || 'localhost';
  const port = parseInt(process.env.MC_PORT || '25565', 10);
  const username = usernameOverride || process.env.MC_USERNAME || 'GemBot';
  const raw = process.env.MC_VERSION || '1.21.2';
  const version = raw === 'false' ? false : raw;

  const bot = mineflayer.createBot({ host, port, username, version, auth: 'offline' });
  bot.loadPlugin(pathfinder);

  bot._client?.on('error', (e) => console.log(`[${username}] Protocol error:`, e.message));
  bot._client?.on('end', (r) => console.log(`[${username}] Protocol closed:`, r));

  let movements = null;
  let lastHp = 20;
  let wasHitAt = 0;

  bot.on('spawn', () => {
    if (!movements && bot.registry) {
      movements = new Movements(bot, bot.registry);
      movements.allowParkour = true;
      movements.allow1by1towers = true;
      movements.canDig = false; // NEVER dig while pathfinding — avoid griefing
      movements.scafolding = false;
      movements.allowFreeMotion = true;
      bot.pathfinder.setMovements(movements);
    }
    bot.setControlState('sprint', true);
  });

  // Detect getting hit by tracking HP drops
  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) {
      wasHitAt = Date.now();
      // Let go of controls briefly to let knockback play out naturally
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      setTimeout(() => {
        if (bot.entity) bot.setControlState('sprint', true);
      }, 300);
    }
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    RECENT_CHAT.push({ username, message, time: Date.now() });
    if (RECENT_CHAT.length > MAX_CHAT_HISTORY) RECENT_CHAT.shift();
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString();
    if (!text.includes('<')) {
      RECENT_CHAT.push({ username: 'SERVER', message: text, time: Date.now() });
      if (RECENT_CHAT.length > MAX_CHAT_HISTORY) RECENT_CHAT.shift();
    }
  });

  bot.on('error', (err) => console.error(`[BOT ERROR] ${err.message}`));
  bot.on('end', (reason) => {
    console.log(`[BOT] Disconnected: ${reason}`);
  });

  function getRecentChat(limit = 10) {
    return RECENT_CHAT.slice(-limit);
  }

  function getState() {
    if (!bot.entity) return null;

    const pos = bot.entity.position;

    const nearbyPlayers = Object.values(bot.entities)
      .filter((e) => e.type === 'player' && e.username !== bot.username)
      .map((e) => ({
        name: e.username,
        distance: Math.round(pos.distanceTo(e.position)),
        position: `(${e.position.x.toFixed(0)}, ${e.position.y.toFixed(0)}, ${e.position.z.toFixed(0)})`,
      }));

    const nearbyMobs = Object.values(bot.entities)
      .filter((e) => e.type === 'mob' && e.position.distanceTo(pos) < 20)
      .map((e) => ({
        name: e.name || e.entityType || 'mob',
        distance: Math.round(pos.distanceTo(e.position)),
      }));

    const blockGrid = [];
    for (let dx = -8; dx <= 8; dx++) {
      for (let dz = -8; dz <= 8; dz++) {
        for (let dy = -2; dy <= 2; dy++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && block.name !== 'air') {
            blockGrid.push({
              name: block.name,
              x: block.position.x,
              y: block.position.y,
              z: block.position.z,
            });
          }
        }
      }
    }

    const seen = new Set();
    const uniqueBlocks = blockGrid.filter((b) => {
      const key = `${b.name}|${b.x}|${b.y}|${b.z}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 60);

    const blockNames = uniqueBlocks.map(b => b.name);
    const hasVegetation = blockNames.some(n => ['grass','tall_grass','fern','dandelion','poppy','oak_sapling','oak_leaves','spruce_leaves','vine'].includes(n));
    const structure = hasVegetation ? 'outdoor/nature' : 'open/built area';

    const inventory = (bot.inventory ? bot.inventory.items() : [])
      .map((item) => `${item.name} x${item.count}`)
      .join(', ');

    const armour = bot.inventory
      ? ['helmet', 'chestplate', 'leggings', 'boots']
          .map((slot) => {
            const slotIndex = { helmet: 5, chestplate: 6, leggings: 7, boots: 8 }[slot];
            const item = slotIndex !== undefined ? bot.inventory.slots[slotIndex] : null;
            return item ? item.name : `empty ${slot}`;
          })
          .join(', ')
      : 'unknown';

    const heldItem = bot.heldItem ? bot.heldItem.name : 'empty hand';
    const biome = bot.blockAt(pos) ? bot.blockAt(pos).biome : 'unknown';

    return {
      name: bot.username,
      position: `x=${pos.x.toFixed(1)} y=${pos.y.toFixed(1)} z=${pos.z.toFixed(1)}`,
      health: Math.round(bot.health),
      food: Math.round(bot.food),
      oxygen: bot.oxygenLevel,
      isDay: bot.time ? bot.time.timeOfDay < 13000 : true,
      timeOfDay: bot.time ? bot.time.timeOfDay : 0,
      dimension: bot.game ? bot.game.dimension : 'unknown',
      biome,
      onGround: bot.entity.onGround,
      isInWater: bot.entity.isInWater,
      heldItem,
      armour,
      players: nearbyPlayers,
      mobs: nearbyMobs,
      nearbyBlocks: uniqueBlocks,
      inventory: inventory || '(empty)',
    };
  }

  async function say(message) {
    if (!message) return;
    bot.chat(message);
  }

  async function moveTo(x, z) {
    if (!bot.entity) return 'No entity';
    try {
      if (bot.pathfinder && movements) {
        bot.setControlState('forward', true);
        bot.pathfinder.setGoal(new goals.GoalNearXZ(x, z, 0));
        let consecutiveStuck = 0;
        let last = bot.entity.position.clone();
        let arrived = false;
        let closest = Infinity;
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 150));
          if (!bot.entity) break;
          const distToTarget = bot.entity.position.distanceTo(new Vec3(x, bot.entity.position.y, z));
          if (distToTarget < closest) closest = distToTarget;
          if (distToTarget < 0.5) {
            arrived = true;
            break;
          }
          // Sprint-jump when on ground for speed (like real players)
          if (bot.entity.onGround && !bot.entity.isInWater) {
            bot.setControlState('jump', true);
            setTimeout(() => { if (bot.entity) bot.setControlState('jump', false); }, 100);
          }
          // Stuck detection
          const dist = bot.entity.position.distanceTo(last);
          if (dist < 0.08) {
            consecutiveStuck++;
            if (consecutiveStuck === 3) {
              // Try strafing out
              bot.setControlState('left', true);
              bot.setControlState('jump', true);
              await new Promise(r => setTimeout(r, 500));
              bot.setControlState('left', false);
              bot.setControlState('jump', false);
            } else if (consecutiveStuck === 6) {
              bot.setControlState('right', true);
              bot.setControlState('jump', true);
              await new Promise(r => setTimeout(r, 500));
              bot.setControlState('right', false);
              bot.setControlState('jump', false);
            } else if (consecutiveStuck >= 9) {
              // Totally stuck — stop pathfinder and give up
              bot.pathfinder.setGoal(null);
              bot.setControlState('forward', false);
              return `stuck near (${x}, ${z}) — closest ${closest.toFixed(1)}m`;
            }
          } else {
            consecutiveStuck = Math.max(0, consecutiveStuck - 1);
          }
          last = bot.entity.position.clone();
        }
        bot.pathfinder.setGoal(null);
        bot.setControlState('forward', false);
        return arrived
          ? `arrived at (${x}, ${z})`
          : `could not reach (${x}, ${z}) — closest ${closest.toFixed(1)}m`;
      } else {
        return 'pathfinder not ready';
      }
    } catch (err) {
      return `move failed: ${err.message}`;
    }
  }

  async function moveToXYZ(x, y, z) {
    if (!bot.entity) return 'No entity';
    try {
      const target = new Vec3(Math.floor(x) + 0.5, y, Math.floor(z) + 0.5);
      bot.setControlState('forward', true);
      bot.pathfinder.setGoal(new goals.GoalBlock(target.x, target.y, target.z));
      let consecutiveStuck = 0;
      let last = bot.entity.position.clone();
      let arrived = false;
      let closest = Infinity;
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 150));
        if (!bot.entity) break;
        const distToTarget = bot.entity.position.distanceTo(target);
        if (distToTarget < closest) closest = distToTarget;
        if (distToTarget < 0.5) {
          arrived = true;
          break;
        }
        if (bot.entity.onGround && !bot.entity.isInWater) {
          bot.setControlState('jump', true);
          setTimeout(() => { if (bot.entity) bot.setControlState('jump', false); }, 100);
        }
        const dist = bot.entity.position.distanceTo(last);
        if (dist < 0.08) {
          consecutiveStuck++;
          if (consecutiveStuck === 3) {
            bot.setControlState('left', true);
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 500));
            bot.setControlState('left', false);
            bot.setControlState('jump', false);
          } else if (consecutiveStuck === 6) {
            bot.setControlState('right', true);
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 500));
            bot.setControlState('right', false);
            bot.setControlState('jump', false);
          } else if (consecutiveStuck >= 9) {
            bot.pathfinder.setGoal(null);
            bot.setControlState('forward', false);
            return `stuck near (${x}, ${y}, ${z}) — closest ${closest.toFixed(1)}m`;
          }
        } else {
          consecutiveStuck = Math.max(0, consecutiveStuck - 1);
        }
        last = bot.entity.position.clone();
      }
      bot.pathfinder.setGoal(null);
      bot.setControlState('forward', false);
      return arrived
        ? `arrived exactly at (${target.x.toFixed(1)}, ${target.y}, ${target.z.toFixed(1)})`
        : `could not reach (${x}, ${y}, ${z}) — closest ${closest.toFixed(1)}m`;
    } catch (err) {
      return `move failed: ${err.message}`;
    }
  }

  async function followPlayer(playerName) {
    if (!bot.entity) return;
    const target = Object.values(bot.entities).find(
      (e) => e.type === 'player' && e.username === playerName
    );
    if (!target) return `Player ${playerName} not found`;
    try {
      bot.setControlState('forward', true);
      await bot.pathfinder.goto(new goals.GoalFollow(target, 0));
      return `Following ${playerName}`;
    } catch (err) {
      bot.setControlState('forward', false);
      return `Follow failed: ${err.message}`;
    }
  }

  async function lookAt(x, y, z) {
    if (!bot.entity) return;
    await bot.lookAt(new Vec3(x, y, z));
  }

  async function digBlock(x, y, z) {
    if (!bot.entity) return 'No entity';
    try {
      const block = bot.blockAt(new Vec3(x, y, z));
      if (!block || block.name === 'air') return 'No block to dig';
      await bot.tool.equipForBlock(block);
      await bot.dig(block);
      return `Mined ${block.name}`;
    } catch (err) {
      return `Dig failed: ${err.message}`;
    }
  }

  async function placeBlock(x, y, z, blockName) {
    if (!bot.entity) return 'No entity';
    try {
      const item = bot.inventory.items().find((i) => i.name === blockName);
      if (!item) return `No ${blockName} in inventory`;
      await bot.equip(item, 'hand');

      const targetPos = new Vec3(x, y, z);
      const refBlock = bot.blockAt(targetPos.offset(0, -1, 0));
      if (!refBlock || refBlock.name === 'air') {
        const refBlock2 = bot.blockAt(targetPos.offset(1, 0, 0));
        if (!refBlock2 || refBlock2.name === 'air') return 'No adjacent block to place on';
        await bot.placeBlock(refBlock2, new Vec3(-1, 0, 0));
      } else {
        await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
      }
      return `Placed ${blockName}`;
    } catch (err) {
      return `Place failed: ${err.message}`;
    }
  }

  async function attackEntity(entityName) {
    if (!bot.entity) return 'No entity';
    try {
      // Auto-equip best weapon
      const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe') || i.name.includes('pickaxe'));
      if (weapon) await bot.equip(weapon, 'hand');
      const target = Object.values(bot.entities).find(
        (e) => e.name === entityName && e.position.distanceTo(bot.entity.position) < 7
      );
      if (!target) return `${entityName} not in range`;
      await bot.lookAt(target.position.offset(0, 1, 0));
      bot.attack(target);
      return `Attacked ${entityName}`;
    } catch (err) {
      return `Attack failed: ${err.message}`;
    }
  }

  async function attackNearestHostile() {
    if (!bot.entity) return 'No entity';
    const hostiles = Object.values(bot.entities)
      .filter((e) => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 8)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
    if (hostiles.length === 0) return 'No mobs nearby';
    const target = hostiles[0];
    try {
      await bot.lookAt(target.position.offset(0, 1, 0));
      bot.attack(target);
      return `Attacked ${target.name || 'mob'}`;
    } catch (err) {
      return `Attack failed: ${err.message}`;
    }
  }

  async function equipItem(itemName) {
    if (!bot.entity) return 'No entity';
    try {
      const item = bot.inventory.items().find((i) => i.name.includes(itemName));
      if (!item) return `No ${itemName} in inventory`;
      await bot.equip(item, 'hand');
      return `Equipped ${item.name}`;
    } catch (err) {
      return `Equip failed: ${err.message}`;
    }
  }

  async function equipArmour(itemName) {
    if (!bot.entity) return 'No entity';
    try {
      const item = bot.inventory.items().find((i) => i.name === itemName);
      if (!item) return `No ${itemName} in inventory`;
      const dest = bot.getEquipmentDestSlot(item);
      await bot.equip(item, dest);
      return `Equipped ${itemName}`;
    } catch (err) {
      return `Armour equip failed: ${err.message}`;
    }
  }

  async function consumeItem() {
    if (!bot.entity) return 'No entity';
    try {
      let food = (bot.heldItem && bot.heldItem.foodPoints > 0) ? bot.heldItem : null;
      if (!food) {
        food = bot.inventory.items().find((i) => i.foodPoints > 0);
      }
      if (!food) return 'No food in inventory';
      if (food !== bot.heldItem) await bot.equip(food, 'hand');
      await bot.consume();
      return `Ate ${food.name}`;
    } catch (err) {
      return `Eat failed: ${err.message}`;
    }
  }

  async function useItem() {
    if (!bot.entity) return 'No entity';
    try {
      await bot.activateItem();
      return `Used ${bot.heldItem ? bot.heldItem.name : 'item'}`;
    } catch (err) {
      return `Use item failed: ${err.message}`;
    }
  }

  async function jump() {
    if (!bot.entity) return;
    bot.setControlState('jump', true);
    await new Promise((r) => setTimeout(r, 200));
    bot.setControlState('jump', false);
  }

  async function activateBlock(x, y, z) {
    if (!bot.entity) return 'No entity';
    try {
      const block = bot.blockAt(new Vec3(x, y, z));
      if (!block) return 'No block';
      await bot.activateBlock(block);
      return `Activated ${block.name}`;
    } catch (err) {
      return `Activate failed: ${err.message}`;
    }
  }

  async function craftItem(itemName, count = 1) {
    if (!bot.entity) return 'No entity';
    try {
      const recipe = bot.recipesFor(itemName, null, count, bot.inventory)[0];
      if (!recipe) return `No recipe for ${itemName}`;
      const craftingTable = bot.findBlock({ matching: (b) => b.name === 'crafting_table', maxDistance: 6 });
      if (recipe.requiresTable && !craftingTable) return 'Need a crafting table nearby';
      await bot.craft(recipe, count, craftingTable ? craftingTable : null);
      return `Crafted ${itemName} x${count * recipe.result.count}`;
    } catch (err) {
      return `Craft failed: ${err.message}`;
    }
  }

  async function equipElytra() {
    if (!bot.entity) return 'No entity';
    try {
      const elytra = bot.inventory.items().find(i => i.name === 'elytra');
      if (!elytra) return 'No elytra in inventory';
      await bot.equip(elytra, 'torso');
      return 'Elytra equipped';
    } catch (err) {
      return `Elytra equip failed: ${err.message}`;
    }
  }

  async function fly() {
    if (!bot.entity) return 'No entity';
    try {
      await equipElytra();
      const firework = bot.inventory.items().find(i => i.name.includes('firework') || i.name === 'firework_rocket');
      if (firework) await bot.equip(firework, 'hand');
      bot.setControlState('jump', true);
      await new Promise(r => setTimeout(r, 300));
      bot.setControlState('jump', false);
      return 'Elytra on, jumping to glide';
    } catch (err) {
      return `Fly failed: ${err.message}`;
    }
  }

  async function unequipArmour(slotOrName) {
    if (!bot.entity) return 'No entity';
    try {
      const slotMap = { head: 5, torso: 6, legs: 7, feet: 8,
        helmet: 5, chestplate: 6, elytra: 6, leggings: 7, boots: 8 };
      let slot = slotOrName !== undefined ? slotOrName : null;
      if (typeof slot === 'string') slot = slotMap[slot.toLowerCase()];
      if (slot === null || slot === undefined) return 'Invalid slot: use head/torso/legs/feet or helmet/chestplate/elytra/leggings/boots';
      const item = bot.inventory.slots[slot];
      if (!item) return 'Nothing equipped in that slot';
      const emptySlot = bot.inventory.firstEmptyInventorySlot();
      if (emptySlot === null || emptySlot === undefined) return 'Inventory full';
      await bot.moveSlotItem(slot, emptySlot);
      return `Unequipped ${item.name}`;
    } catch (err) {
      return `Unequip failed: ${err.message}`;
    }
  }

  async function dropItem(itemName, count = 1) {
    if (!bot.entity) return 'No entity';
    try {
      const item = bot.inventory.items().find(i => i.name.includes(itemName));
      if (!item) return `No ${itemName} in inventory`;
      const toDrop = Math.min(count, item.count);
      await bot.toss(item.type, null, toDrop);
      return `Dropped ${item.name} x${toDrop}`;
    } catch (err) {
      return `Drop failed: ${err.message}`;
    }
  }

  async function dropAll() {
    if (!bot.entity) return 'No entity';
    try {
      let count = 0;
      for (const item of bot.inventory.items()) {
        await bot.toss(item.type, null, item.count);
        count += item.count;
      }
      return `Dropped ${count} items`;
    } catch (err) {
      return `Drop all failed: ${err.message}`;
    }
  }

  return {
    bot, getState, getRecentChat, say,
    moveTo, moveToXYZ, followPlayer, lookAt,
    digBlock, placeBlock, attackEntity, attackNearestHostile,
    equipItem, equipArmour, consumeItem, jump, activateBlock, craftItem, useItem,
    equipElytra, fly, unequipArmour, dropItem, dropAll,
  };
}

module.exports = { createBot };