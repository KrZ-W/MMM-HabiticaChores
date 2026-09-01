#!/usr/bin/env node
/* Offline unit test for splitChores — no account/network needed. */
const assert = require("assert");
const { splitChores } = require("./chores");

// Realistic slice of a GET /tasks/user response (mixed types + edge cases).
const sample = [
  { id: "a", type: "daily", text: "Brosser les dents", completed: false, isDue: true },
  { id: "b", type: "daily", text: "Déjà fait aujourd'hui", completed: true, isDue: true },
  { id: "c", type: "daily", text: "Pas prévu aujourd'hui", completed: false, isDue: false },
  { id: "d", type: "daily", text: "Devoirs", completed: false, isDue: true,
    checklist: [{ text: "p.1", completed: true }, { text: "p.2", completed: false }] },
  { id: "e", type: "todo", text: "Projet sciences", completed: false, date: "2026-09-10T00:00:00.000Z" },
  { id: "f", type: "todo", text: "Todo urgent", completed: false, date: "2026-09-02T00:00:00.000Z" },
  { id: "g", type: "todo", text: "Todo sans date", completed: false, date: null },
  { id: "h", type: "todo", text: "Todo terminé", completed: true, date: null },
  { id: "i", type: "habit", text: "Un habit (ignoré)", completed: false },
  { id: "j", type: "reward", text: "Une récompense (ignorée)", completed: false }
];

// Default options: onlyDueToday + hideCompleted
const out = splitChores(sample, {});
const dailyTexts = out.dailies.map((d) => d.text);
const todoTexts = out.todos.map((t) => t.text);

console.log("Dailies:", dailyTexts);
console.log("To-dos :", todoTexts);
console.log("Checklist badge on 'Devoirs':", JSON.stringify(out.dailies.find((d) => d.text === "Devoirs").checklist));

// --- assertions ---
assert.deepStrictEqual(dailyTexts, ["Brosser les dents", "Devoirs"],
  "should keep only due + incomplete dailies (drop completed & not-due)");
assert.deepStrictEqual(todoTexts, ["Todo urgent", "Projet sciences", "Todo sans date"],
  "todos: incomplete only, soonest due first, undated last");
assert.strictEqual(out.dailies.find((d) => d.text === "Devoirs").checklist.length, 2);

// hideCompleted:false should surface the completed ones too
const out2 = splitChores(sample, { hideCompleted: false });
assert.ok(out2.dailies.some((d) => d.text === "Déjà fait aujourd'hui" && d.completed),
  "hideCompleted:false keeps completed dailies");

// onlyDueToday:false should surface the not-due daily
const out3 = splitChores(sample, { onlyDueToday: false });
assert.ok(out3.dailies.some((d) => d.text === "Pas prévu aujourd'hui"),
  "onlyDueToday:false keeps not-due dailies");

console.log("\n✅ all assertions passed");
