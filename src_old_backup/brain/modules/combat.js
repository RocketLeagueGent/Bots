function createCombatModule() {
  let lastEngagement = 0;

  function assess(state) {
    if (!state || !state.mobs || state.mobs.length === 0) {
      return { threat: 'none', recommendation: null };
    }

    const hp = state.health || 20;
    const hostiles = state.mobs.filter(m =>
      /zombie|skeleton|spider|creeper|enderman|witch|hoglin|piglin|phantom|drowned|husk|stray/i.test(m.name)
    );

    if (hostiles.length === 0) return { threat: 'none', recommendation: null };

    const nearest = hostiles.sort((a, b) => a.distance - b.distance)[0];

    if (nearest.distance <= 3 && hp < 8) {
      return {
        threat: 'critical',
        recommendation: 'flee_or_tpa',
        target: nearest.name,
        distance: nearest.distance,
        message: `Critical: ${nearest.name} ${nearest.distance}m away at ${hp} HP — run or /tpa out`,
      };
    }

    if (nearest.distance <= 5) {
      return {
        threat: 'high',
        recommendation: 'attack',
        target: nearest.name,
        distance: nearest.distance,
        message: `${nearest.name} ${nearest.distance}m away — equip weapon and fight`,
      };
    }

    if (nearest.distance <= 10 && hp >= 10) {
      return {
        threat: 'medium',
        recommendation: 'engage_or_avoid',
        target: nearest.name,
        distance: nearest.distance,
        message: `${nearest.name} ${nearest.distance}m away — can fight or ignore`,
      };
    }

    return {
      threat: 'low',
      recommendation: 'ignore',
      target: nearest.name,
      distance: nearest.distance,
      message: `${nearest.name} ${nearest.distance}m away — too far to care`,
    };
  }

  function recordEngagement() {
    lastEngagement = Date.now();
  }

  function timeSinceEngagement() {
    return Date.now() - lastEngagement;
  }

  function weaponRecommendation(inventory) {
    if (!inventory) return null;
    const order = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
      'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe'];
    for (const w of order) {
      if (inventory.includes(w)) return w;
    }
    return null;
  }

  return { assess, recordEngagement, timeSinceEngagement, weaponRecommendation };
}

module.exports = { createCombatModule };
