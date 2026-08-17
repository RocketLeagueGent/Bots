const Vec3 = require('vec3').Vec3;

function createNavigationModule() {
  let lastFailPos = null;
  let failCount = 0;

  function recordFail(pos) {
    lastFailPos = pos ? new Vec3(Math.floor(pos.x), 0, Math.floor(pos.z)) : null;
    failCount++;
  }

  function recordSuccess() {
    failCount = Math.max(0, failCount - 1);
  }

  function isStuckRegion(pos) {
    if (!lastFailPos || !pos) return false;
    const dx = Math.floor(pos.x) - lastFailPos.x;
    const dz = Math.floor(pos.z) - lastFailPos.z;
    return Math.abs(dx) < 3 && Math.abs(dz) < 3 && failCount >= 3;
  }

  function suggestAlternative(pos, targetX, targetZ) {
    if (!pos || failCount < 2) return null;
    const offsetX = (Math.random() - 0.5) * 20;
    const offsetZ = (Math.random() - 0.5) * 20;
    return {
      x: Math.floor(targetX + offsetX),
      z: Math.floor(targetZ + offsetZ),
      reason: 'Stuck — trying alternate route',
    };
  }

  function assessTerrain(nearbyBlocks) {
    if (!nearbyBlocks || nearbyBlocks.length === 0) return 'unknown';
    const names = nearbyBlocks.map(b => b.name);
    const water = names.filter(n => n.includes('water')).length;
    const lava = names.filter(n => n.includes('lava')).length;
    const climbable = names.filter(n => n.includes('ladder') || n.includes('vine') || n.includes('scaffold')).length;

    let terrain = 'walkable';
    if (water > 5) terrain = 'water';
    if (lava > 0) terrain += '_hazard';
    if (climbable > 0) terrain += '_climbable';
    return terrain;
  }

  function hazardNearby(nearbyBlocks, pos) {
    if (!nearbyBlocks) return false;
    return nearbyBlocks.some(b =>
      (b.name.includes('lava') || b.name === 'fire' || b.name.includes('cactus'))
    );
  }

  return { recordFail, recordSuccess, isStuckRegion, suggestAlternative, assessTerrain, hazardNearby };
}

module.exports = { createNavigationModule };
