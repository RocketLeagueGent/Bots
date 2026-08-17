const storage = require('./storage');

const CONTRADICTIONS = [
  [/don't follow/i, /always follow/i],
  [/never attack/i, /always attack/i],
  [/don't mine/i, /always mine/i],
  [/stay away/i, /go to/i],
  [/ignore/i, /listen to/i],
];

function createKnowledgeSystem(botName) {
  const namespace = `knowledge_${botName}`;
  let knowledge = storage.read(namespace) || [];

  function _confidenceLabel(score) {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  }

  function learn(fact, source = 'self', confidence = 0.5) {
    if (!fact || fact.length < 3) return null;

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      fact,
      source,
      confidence,
      label: _confidenceLabel(confidence),
      ts: Date.now(),
      verified: 0,
      rejected: 0,
    };

    const existing = knowledge.findIndex(k => k.fact.toLowerCase() === fact.toLowerCase());
    if (existing >= 0) {
      knowledge[existing].confidence = Math.min(1, knowledge[existing].confidence + 0.1);
      knowledge[existing].verified++;
      knowledge[existing].ts = Date.now();
      knowledge[existing].label = _confidenceLabel(knowledge[existing].confidence);
      storage.write(namespace, knowledge);
      return knowledge[existing];
    }

    const contradiction = knowledge.find(k => _contradicts(fact, k.fact));
    if (contradiction) {
      console.log(`[Knowledge] "${fact}" contradicts "${contradiction.fact}" — keeping older`);
      return null;
    }

    knowledge.push(entry);
    if (knowledge.length > 200) {
      knowledge.sort((a, b) => b.confidence - a.confidence || b.verified - a.verified);
      knowledge = knowledge.slice(0, 150);
    }
    storage.write(namespace, knowledge);
    return entry;
  }

  function _contradicts(a, b) {
    return CONTRADICTIONS.some(([reA, reB]) =>
      (reA.test(a) && reB.test(b)) || (reB.test(a) && reA.test(b))
    );
  }

  function verify(id, positive = true) {
    const entry = knowledge.find(k => k.id === id);
    if (!entry) return;
    if (positive) {
      entry.verified++;
      entry.confidence = Math.min(1, entry.confidence + 0.1);
    } else {
      entry.rejected++;
      entry.confidence = Math.max(0.1, entry.confidence - 0.2);
    }
    entry.label = _confidenceLabel(entry.confidence);
    entry.ts = Date.now();
    storage.write(namespace, knowledge);
  }

  function recall(topic, limit = 5) {
    if (!topic) return knowledge.slice(-limit).reverse();
    const lower = topic.toLowerCase();
    const scored = knowledge
      .map(k => {
        let score = 0;
        if (k.fact.toLowerCase().includes(lower)) score += k.fact.toLowerCase().split(lower).length - 1;
        if (k.source.toLowerCase().includes(lower)) score += 0.5;
        score += k.confidence * 2;
        score += Math.min(k.verified, 5) * 0.3;
        return { ...k, score };
      })
      .filter(k => k.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  function fromPlayer(player, message) {
    const instructions = [
      /(?:dont|don't|never|stop)\s+(.+)($|\.)/i,
      /(?:always|make sure|remember)\s+(?:to\s+)?(.+)($|\.)/i,
      /(?:do|go|try|build|mine|craft|get|find|make)\s+(.+)($|\.)/i,
      /(?:stay|keep|avoid|watch|look)\s+(.+)($|\.)/i,
    ];
    for (const re of instructions) {
      const m = message.match(re);
      if (m) {
        learn(`${player}: ${m[1].trim()}`, `player:${player}`, 0.4);
        return m[1].trim();
      }
    }
    return null;
  }

  function fromOutcome(action, success) {
    const key = `action_${action}`;
    const existing = knowledge.find(k => k.fact.startsWith(key));
    if (existing) {
      existing.confidence = success
        ? Math.min(1, existing.confidence + 0.05)
        : Math.max(0.1, existing.confidence - 0.05);
      existing.label = _confidenceLabel(existing.confidence);
      existing.verified += success ? 1 : 0;
      existing.ts = Date.now();
      storage.write(namespace, knowledge);
    } else {
      learn(`${key}_${success ? 'success' : 'fail'}`, 'self', success ? 0.6 : 0.3);
    }
  }

  function summarize(limit = 5) {
    const top = [...knowledge]
      .sort((a, b) => b.confidence - a.confidence || b.verified - a.verified)
      .slice(0, limit);
    return top.map(k => `[${k.label}] ${k.fact}`);
  }

  function all() {
    return [...knowledge];
  }

  return { learn, verify, recall, fromPlayer, fromOutcome, summarize, all };
}

module.exports = { createKnowledgeSystem };
