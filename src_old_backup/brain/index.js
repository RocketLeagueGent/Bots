const { createMemorySystem } = require('./memory');
const { createKnowledgeSystem } = require('./knowledge');
const { createPlanner } = require('./planner');
const { createCombatModule } = require('./modules/combat');
const { createNavigationModule } = require('./modules/navigation');
const { createResourceModule } = require('./modules/resources');
const { createConstructionModule } = require('./modules/construction');
const { createDialogueModule } = require('./modules/dialogue');
const storage = require('./storage');

function createBrain(botName, botHandle) {

  const memory = createMemorySystem(botName);
  const knowledge = createKnowledgeSystem(botName);
  const planner = createPlanner(botName);
  const combat = createCombatModule();
  const navigation = createNavigationModule();
  const resources = createResourceModule();
  const construction = createConstructionModule();
  const dialogue = createDialogueModule();

  let lastState = null;
  let lastActionResult = null;
  let totalActions = 0;
  let successCount = 0;

  function ingestState(state) {
    if (!state) return;
    lastState = state;

    memory.storeShort('state', {
      position: state.position,
      health: state.health,
      food: state.food,
      biome: state.biome,
      dimension: state.dimension,
      time: state.isDay ? 'day' : 'night',
    });

    if (state.players && state.players.length > 0) {
      for (const p of state.players) {
        memory.storeLong('player', {
          name: p.name,
          lastPosition: p.position,
          lastDistance: p.distance,
        }, { player: p.name });
      }
    }

    if (state.mobs && state.mobs.length > 0) {
      memory.storeShort('mobs', state.mobs);
    }
  }

  function ingestChat(username, message) {
    memory.storeShort('chat', { username, message });

    const parsed = dialogue.processMessage(username, message);

    if (parsed.intent === 'instruction' || parsed.intent === 'action_request') {
      const extracted = dialogue.extractInstruction(message) || message.slice(0, 60);
      knowledge.fromPlayer(username, extracted);

      const actionTypes = {
        follow: 'follow', come: 'follow', go: 'follow',
        attack: 'combat', kill: 'combat', fight: 'combat',
        mine: 'gather', dig: 'gather', chop: 'gather', break: 'gather',
        craft: 'craft', make: 'craft',
        build: 'build', place: 'build',
      };
      const firstWord = message.split(/\s+/)[0]?.toLowerCase();
      const priority = actionTypes[firstWord] || 'social';
      planner.addGoal(`Player ${username}: ${message.slice(0, 80)}`, priority, `player:${username}`);
    }

    return parsed;
  }

  function ingestActionResult(action, result) {
    totalActions++;
    const success = result && !result.startsWith('error') && !result.startsWith('missing') && !result.startsWith('failed') && !result.startsWith('stuck') && !result.startsWith('could not');

    if (success) {
      successCount++;
      memory.storeShort('action_result', { action, result, success: true });
    } else {
      memory.storeShort('action_result', { action, result, success: false });
      if (action.startsWith('move')) navigation.recordFail(lastState?.position);
    }

    knowledge.fromOutcome(action, success);
    lastActionResult = { action, result, success };

    return success;
  }

  function assessCombatThreat(state) {
    return combat.assess(state || lastState);
  }

  function assessResourceNeeds(state) {
    return resources.assess(
      state?.inventory || lastState?.inventory,
      state?.health || lastState?.health,
      state?.food || lastState?.food
    );
  }

  function targetResourcesNearby(state) {
    return resources.targetResources(state?.nearbyBlocks || lastState?.nearbyBlocks);
  }

  function buildEnrichedContext(baseContext) {
    const parts = [baseContext];

    const memSummary = memory.summarize();
    if (memSummary.learnedKnowledge.length > 0) {
      parts.push(`## Knowledge\n${memSummary.learnedKnowledge.join('\n')}`);
    }

    const knowSummary = knowledge.summarize(3);
    if (knowSummary.length > 0) {
      parts.push(`## What I Know\n${knowSummary.join('\n')}`);
    }

    const goalSummary = planner.summarize();
    if (goalSummary && !goalSummary.includes('No active goals')) {
      parts.push(`## Goals\n${goalSummary}`);
    }

    const threat = assessCombatThreat();
    if (threat.threat !== 'none') {
      parts.push(`## Combat Assessment\n${threat.message}`);
    }

    const needs = assessResourceNeeds();
    if (needs.length > 0 && needs[0].priority >= 7) {
      parts.push(`## Resource Needs\n${needs.slice(0, 2).map(n => n.message).join('\n')}`);
    }

    const playerSummary = dialogue.playerSummary(3);
    if (playerSummary) {
      parts.push(`## Players\n${playerSummary}`);
    }

    if (totalActions > 0) {
      const rate = totalActions > 0 ? Math.round((successCount / totalActions) * 100) : 0;
      parts.push(`## Performance\n${totalActions} actions, ${successCount} successful (${rate}%)`);
    }

    return parts.join('\n\n');
  }

  function storeObservation(data) {
    memory.storeLong('observation', data);
  }

  function onGoalComplete(goalId) {
    planner.markDone(goalId);
  }

  function onGoalFailed(goalId) {
    planner.markFailed(goalId);
    const goal = planner.all().goals.find(g => g.id === goalId);
    if (goal) {
      memory.storeLong('failure', {
        goal: goal.description,
        reason: lastActionResult?.result || 'unknown',
      });
    }
  }

  function saveAll() {
    storage.write(`${botName}_metadata`, {
      totalActions,
      successCount,
      lastRun: Date.now(),
    });
  }

  function loadAll() {
    const meta = storage.read(`${botName}_metadata`);
    if (meta) {
      totalActions = meta.totalActions || 0;
      successCount = meta.successCount || 0;
    }
  }

  loadAll();

  return {
    memory, knowledge, planner,
    combat, navigation, resources, construction, dialogue,
    ingestState, ingestChat, ingestActionResult,
    assessCombatThreat, assessResourceNeeds, targetResourcesNearby,
    buildEnrichedContext, storeObservation,
    onGoalComplete, onGoalFailed, saveAll,
    getStats: () => ({ totalActions, successCount, rate: totalActions > 0 ? Math.round((successCount / totalActions) * 100) : 0 }),
  };
}

module.exports = { createBrain };
