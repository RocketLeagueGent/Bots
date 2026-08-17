const storage = require('./storage');

const SHORT_TERM_MAX = 30;
const LONG_TERM_MAX = 200;

const SHORT = Symbol('short');
const LONG = Symbol('long');

function createMemorySystem(botName) {
  const shortTerm = [];
  const namespace = `memory_${botName}`;

  let longTerm = storage.read(namespace) || [];

  function _tagged(entries) {
    return entries.map(e => ({
      ...e,
      ts: e.ts || Date.now(),
    }));
  }

  function storeShort(type, data) {
    shortTerm.push({ type, data, ts: Date.now() });
    if (shortTerm.length > SHORT_TERM_MAX) shortTerm.shift();
  }

  function storeLong(type, data, meta = {}) {
    const entry = { type, data, meta, ts: Date.now(), hits: 0 };
    longTerm.push(entry);
    if (longTerm.length > LONG_TERM_MAX) longTerm = longTerm.slice(-150);
    storage.write(namespace, longTerm);
    return entry;
  }

  function updateLong(idx, updates) {
    if (idx >= 0 && idx < longTerm.length) {
      Object.assign(longTerm[idx], updates, { ts: Date.now() });
      longTerm[idx].hits = (longTerm[idx].hits || 0) + 1;
      storage.write(namespace, longTerm);
    }
  }

  function recallShort(type, limit = 5) {
    const filtered = shortTerm.filter(e => e.type === type).reverse();
    return filtered.slice(0, limit);
  }

  function recallLong(type, limit = 5) {
    const filtered = longTerm.filter(e => e.type === type).sort((a, b) => (b.hits || 0) - (a.hits || 0));
    return filtered.slice(0, limit);
  }

  function recallRecentLong(type, limit = 5) {
    const filtered = longTerm.filter(e => e.type === type).sort((a, b) => b.ts - a.ts);
    return filtered.slice(0, limit);
  }

  function searchLong(text, limit = 5) {
    const lower = text.toLowerCase();
    const scored = longTerm
      .map(e => {
        let score = 0;
        const searchable = JSON.stringify(e).toLowerCase();
        if (searchable.includes(lower)) score += searchable.split(lower).length - 1;
        score += (e.hits || 0) * 0.5;
        return { ...e, score };
      })
      .filter(e => e.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  function summarize(limit = 5) {
    const recent = recallRecentLong('observation', limit);
    const learned = recallLong('learned', limit);
    const players = longTerm.filter(e => e.type === 'player').slice(-3);
    const locations = longTerm.filter(e => e.type === 'location').slice(-3);

    return {
      recentObservations: recent.map(e => e.data),
      learnedKnowledge: learned.map(e => e.data),
      playerProfiles: players.map(e => e.data),
      knownLocations: locations.map(e => e.data),
    };
  }

  function all() {
    return {
      short: [...shortTerm],
      long: [...longTerm],
    };
  }

  function forgetOlderThan(maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    const before = longTerm.length;
    longTerm = longTerm.filter(e => e.ts > cutoff);
    if (longTerm.length !== before) storage.write(namespace, longTerm);
  }

  return {
    storeShort, storeLong, updateLong,
    recallShort, recallLong, recallRecentLong, searchLong,
    summarize, all, forgetOlderThan,
  };
}

module.exports = { createMemorySystem };
