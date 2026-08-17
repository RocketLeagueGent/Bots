function createResourceModule() {

  const NEEDS = {
    food: { items: ['apple', 'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'carrot', 'potato', 'beetroot', 'melon_slice', 'sweet_berries'], priority: 8 },
    wood: { items: ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'], priority: 6 },
    stone: { items: ['cobblestone', 'stone'], priority: 5 },
    iron: { items: ['iron_ore', 'raw_iron', 'iron_ingot'], priority: 4 },
    coal: { items: ['coal_ore', 'coal'], priority: 3 },
    diamond: { items: ['diamond_ore', 'diamond'], priority: 2 },
  };

  function assess(inventory, health, food) {
    if (!inventory) return [];

    const needs = [];
    const invStr = inventory;

    if (health < 20) needs.push({ need: 'heal', priority: 9, message: 'Need healing' });

    if (food < 10) {
      const hasFood = Object.values(NEEDS.food.items).some(item => invStr.includes(item));
      if (!hasFood) needs.push({ need: 'food', priority: 8, message: 'Need food — get some' });
      else needs.push({ need: 'eat', priority: 9, message: 'Food low — eat now' });
    }

    for (const [key, cfg] of Object.entries(NEEDS)) {
      if (key === 'food' && food >= 10) continue;
      const has = cfg.items.some(item => invStr.includes(item));
      if (key === 'food' && !has && food < 14) {
        needs.push({ need: 'food', priority: cfg.priority, message: `No ${key} in inventory` });
      } else if (!has && ['wood', 'stone'].includes(key)) {
        needs.push({ need: key, priority: cfg.priority, message: `No ${key} — should gather some` });
      }
    }

    return needs.sort((a, b) => b.priority - a.priority);
  }

  function targetResources(nearbyBlocks) {
    if (!nearbyBlocks) return [];
    const targets = [];
    const order = ['diamond_ore', 'iron_ore', 'coal_ore', 'oak_log', 'spruce_log', 'birch_log', 'stone', 'cobblestone', 'gravel'];
    for (const resource of order) {
      const blocks = nearbyBlocks.filter(b => b.name === resource);
      if (blocks.length > 0) targets.push({ resource, count: blocks.length, sample: blocks[0] });
    }
    return targets;
  }

  function toolFor(blockName) {
    if (blockName.includes('ore') || blockName.includes('stone') || blockName.includes('deepslate')) return 'pickaxe';
    if (blockName.includes('log') || blockName.includes('wood') || blockName.includes('tree')) return 'axe';
    if (blockName.includes('dirt') || blockName.includes('sand') || blockName.includes('gravel')) return 'shovel';
    return null;
  }

  return { assess, targetResources, toolFor };
}

module.exports = { createResourceModule };
