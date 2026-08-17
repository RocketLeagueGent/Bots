function createDialogueModule() {
  const playerMemory = {};

  function processMessage(username, message) {
    if (!playerMemory[username]) {
      playerMemory[username] = { name: username, firstSeen: Date.now(), messages: 0, lastInteraction: Date.now(), traits: [], commands: 0 };
    }
    const p = playerMemory[username];
    p.messages++;
    p.lastInteraction = Date.now();

    const lower = message.toLowerCase();

    if (lower.startsWith('/')) {
      p.commands++;
      return { intent: 'command', player: username, raw: message };
    }

    if (/\b(follow|come|go|move|stop|stay|wait)\b/i.test(lower)) {
      return { intent: 'instruction', player: username, raw: message };
    }

    if (/\b(attack|kill|fight|break|mine|chop|dig)\b/i.test(lower)) {
      return { intent: 'action_request', player: username, raw: message };
    }

    if (/\b(what|where|how|why|who|when|tell|show)\b/i.test(lower)) {
      return { intent: 'question', player: username, raw: message };
    }

    if (/\b(hi|hey|hello|yo|sup|good|nice|cool|ok|thanks|ty|gg)\b/i.test(lower)) {
      return { intent: 'greeting', player: username, raw: message };
    }

    if (message.includes('?')) {
      return { intent: 'question', player: username, raw: message };
    }

    return { intent: 'statement', player: username, raw: message };
  }

  function extractInstruction(message) {
    const patterns = [
      /(?:go|walk|move|come|teleport|tpa)\s+(?:to\s+)?(?:the\s+|that\s+)?([a-zA-Z0-9_]{3,})/i,
      /(?:get|bring|fetch|give)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+|some\s+)?([a-zA-Z0-9_]+)/i,
      /(?:craft|make)\s+(?:me\s+)?(?:a\s+|an\s+|some\s+)?([a-zA-Z0-9_]+)/i,
      /(?:mine|dig|break|chop|cut)\s+(?:the\s+|that\s+|a\s+)?([a-zA-Z0-9_]+)/i,
      /(?:build|place)\s+(?:a\s+|an\s+|the\s+)?([a-zA-Z0-9_]+)/i,
      /(?:equip|hold|wield)\s+(?:the\s+|your\s+|a\s+|an\s+)?([a-zA-Z0-9_]+)/i,
      /(?:drop|toss|throw)\s+(?:the\s+|your\s+|a\s+|an\s+)?([a-zA-Z0-9_]+)/i,
      /(?:eat|drink|consume)\s+(?:the\s+|your\s+|a\s+|an\s+)?([a-zA-Z0-9_]+)/i,
    ];
    for (const re of patterns) {
      const m = message.match(re);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }

  function playerSummary(limit = 5) {
    const entries = Object.entries(playerMemory);
    if (entries.length === 0) return '';
    return entries
      .sort((a, b) => b[1].lastInteraction - a[1].lastInteraction)
      .slice(0, limit)
      .map(([, p]) => {
        const minutesAgo = Math.round((Date.now() - p.lastInteraction) / 60000);
        return `${p.name} (${p.messages} msgs, ${minutesAgo}m ago)`;
      })
      .join(', ');
  }

  function allPlayers() {
    return { ...playerMemory };
  }

  return { processMessage, extractInstruction, playerSummary, allPlayers };
}

module.exports = { createDialogueModule };
