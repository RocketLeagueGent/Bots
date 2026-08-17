const storage = require('./storage');

const GOAL_PRIORITIES = {
  survive: 100,
  combat: 90,
  follow: 80,
  gather: 60,
  craft: 50,
  build: 40,
  explore: 30,
  social: 20,
};

function createPlanner(botName) {
  const namespace = `plans_${botName}`;
  let goals = storage.read(namespace) || [];
  let activeGoalIdx = -1;
  let taskStack = [];

  function _nextId() {
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  }

  function addGoal(description, priority = 'explore', source = 'self') {
    const pri = GOAL_PRIORITIES[priority] || 30;
    const goal = {
      id: _nextId(),
      description,
      priority: pri,
      priorityLabel: priority,
      source,
      created: Date.now(),
      active: true,
      done: false,
      failed: false,
      subtasks: [],
      currentSubtask: -1,
    };
    goals.push(goal);
    goals.sort((a, b) => b.priority - a.priority);
    storage.write(namespace, goals);
    _reevaluate();
    return goal;
  }

  function _reevaluate() {
    const active = goals.filter(g => g.active && !g.done && !g.failed);
    if (active.length === 0) { activeGoalIdx = -1; return; }
    const best = active[0];
    activeGoalIdx = goals.indexOf(best);
  }

  function currentGoal() {
    if (activeGoalIdx < 0 || activeGoalIdx >= goals.length) return null;
    const g = goals[activeGoalIdx];
    if (g.done || g.failed) { _reevaluate(); return currentGoal(); }
    return g;
  }

  function currentGoalDescription() {
    const g = currentGoal();
    return g ? g.description : null;
  }

  function markDone(goalId) {
    const g = goals.find(x => x.id === goalId);
    if (g) { g.done = true; g.active = false; storage.write(namespace, goals); _reevaluate(); }
  }

  function markFailed(goalId) {
    const g = goals.find(x => x.id === goalId);
    if (g) { g.failed = true; g.active = false; storage.write(namespace, goals); _reevaluate(); }
  }

  function setActiveGoal(goalId) {
    const idx = goals.findIndex(g => g.id === goalId);
    if (idx >= 0) { activeGoalIdx = idx; return true; }
    return false;
  }

  function pushTask(goalId, task) {
    const g = goals.find(x => x.id === goalId);
    if (!g) return;
    g.subtasks.push({ ...task, done: false, ts: Date.now() });
    if (g.currentSubtask < 0) g.currentSubtask = 0;
    storage.write(namespace, goals);
  }

  function nextTask(goalId) {
    const g = goals.find(x => x.id === goalId);
    if (!g || g.subtasks.length === 0) return null;
    if (g.currentSubtask >= g.subtasks.length) return null;
    const task = g.subtasks[g.currentSubtask];
    if (task.done) {
      g.currentSubtask++;
      storage.write(namespace, goals);
      return nextTask(goalId);
    }
    return task;
  }

  function markTaskDone(goalId) {
    const g = goals.find(x => x.id === goalId);
    if (!g || g.currentSubtask < 0 || g.currentSubtask >= g.subtasks.length) return;
    g.subtasks[g.currentSubtask].done = true;
    g.subtasks[g.currentSubtask].ts = Date.now();
    g.currentSubtask++;
    storage.write(namespace, goals);
    if (g.currentSubtask >= g.subtasks.length) markDone(goalId);
  }

  function clearGoals() {
    goals = [];
    activeGoalIdx = -1;
    taskStack = [];
    storage.write(namespace, goals);
  }

  function summarize() {
    const active = goals.filter(g => g.active && !g.done && !g.failed);
    if (active.length === 0) return 'No active goals. Explore freely.';
    return active.slice(0, 3).map(g => {
      const progress = g.subtasks.length > 0
        ? ` (${g.subtasks.filter(s => s.done).length}/${g.subtasks.length} tasks)`
        : '';
      return `[${g.priorityLabel}] ${g.description}${progress}`;
    }).join('\n');
  }

  function all() {
    return { goals: [...goals], activeIdx: activeGoalIdx };
  }

  return {
    addGoal, currentGoal, currentGoalDescription,
    markDone, markFailed, setActiveGoal,
    pushTask, nextTask, markTaskDone,
    clearGoals, summarize, all,
  };
}

module.exports = { createPlanner };
