/* Pure task-parsing logic for MMM-HabiticaChores.
 * Kept separate from node_helper so it can be unit-tested without MagicMirror.
 */

/** Map a raw Habitica task to the trimmed shape the module renders. */
function mapTask(t) {
  return {
    id: t.id,
    text: (t.text || "").trim(),
    completed: !!t.completed,
    isDue: t.isDue !== false, // Habitica omits/true when due; explicit false when not
    date: t.date || null,
    checklist: Array.isArray(t.checklist)
      ? t.checklist.map((c) => ({ text: c.text, completed: !!c.completed }))
      : []
  };
}

/**
 * Split a raw task array into outstanding { dailies, todos }.
 * options.onlyDueToday (default true) — dailies only if scheduled today.
 * options.hideCompleted (default true) — drop tasks already completed.
 */
function splitChores(tasks, options = {}) {
  const onlyDue = options.onlyDueToday !== false;
  const hideCompleted = options.hideCompleted !== false;

  const dailies = tasks
    .filter((t) => t.type === "daily")
    .map(mapTask)
    .filter((t) => (onlyDue ? t.isDue : true))
    .filter((t) => (hideCompleted ? !t.completed : true));

  const todos = tasks
    .filter((t) => t.type === "todo")
    .map(mapTask)
    .filter((t) => (hideCompleted ? !t.completed : true))
    .sort((a, b) => {
      if (a.date && b.date) return new Date(a.date) - new Date(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

  return { dailies, todos };
}

/** Per-person completion totals for a "house status" summary. */
function summarize(tasks) {
  const dueDailies = tasks.filter((t) => t.type === "daily" && t.isDue !== false);
  return {
    dailiesDue: dueDailies.length,
    dailiesDone: dueDailies.filter((t) => t.completed).length,
    todosOpen: tasks.filter((t) => t.type === "todo" && !t.completed).length
  };
}

module.exports = { splitChores, mapTask, summarize };
