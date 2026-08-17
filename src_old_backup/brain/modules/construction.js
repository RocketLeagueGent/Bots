function createConstructionModule() {
  let buildSites = [];

  function registerSite(name, x, y, z, structure = 'hut') {
    buildSites.push({ name, x, y, z, structure, ts: Date.now() });
    if (buildSites.length > 10) buildSites.shift();
    return { name, x, y, z, structure };
  }

  function nearbyBuildable(state) {
    if (!state || !state.nearbyBlocks) return [];
    const flat = state.nearbyBlocks.filter(b =>
      b.name === 'dirt' || b.name === 'grass_block' || b.name === 'stone' || b.name === 'cobblestone'
    );
    return flat.slice(0, 5).map(b => ({ x: b.x, y: b.y + 1, z: b.z }));
  }

  function shelterBlueprint(pos) {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const blocks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = 0; dy <= 3; dy++) {
          if (dy === 0 || Math.abs(dx) === 2 || Math.abs(dz) === 2) {
            if (!(dx === 0 && dz === 0 && dy === 1)) {
              blocks.push({ x: x + dx, y: y + dy, z: z + dz });
            }
          }
        }
      }
    }
    return { type: 'shelter', blocks, material: 'cobblestone', estimatedBlocks: blocks.length };
  }

  function estimateMaterials(blueprint) {
    return {
      [blueprint.material]: blueprint.estimatedBlocks,
    };
  }

  function hasMaterials(inventory, blueprint) {
    if (!inventory) return false;
    return Object.entries(estimateMaterials(blueprint)).every(([mat, count]) => {
      const re = new RegExp(mat.replace('_', '[_ ]'), 'i');
      const match = inventory.match(re);
      if (!match) return false;
      const countMatch = inventory.match(new RegExp(`${mat}\\s+x(\\d+)`, 'i'));
      return countMatch ? parseInt(countMatch[1]) >= count : false;
    });
  }

  return { registerSite, nearbyBuildable, shelterBlueprint, estimateMaterials, hasMaterials };
}

module.exports = { createConstructionModule };
