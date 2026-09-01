#!/usr/bin/env node
/* Standalone tester for the Habitica tasks API — validates credentials and
 * shows exactly what the module would render, WITHOUT needing MagicMirror.
 *
 * Usage:
 *   HABITICA_USER=<userId> HABITICA_TOKEN=<apiToken> node test-api.js
 */
const API_BASE = "https://habitica.com/api/v3";

const userId = process.env.HABITICA_USER;
const apiToken = process.env.HABITICA_TOKEN;

if (!userId || !apiToken) {
  console.error("Set HABITICA_USER and HABITICA_TOKEN env vars. e.g.:");
  console.error("  HABITICA_USER=xxxx HABITICA_TOKEN=yyyy node test-api.js");
  process.exit(1);
}

(async () => {
  const res = await fetch(`${API_BASE}/tasks/user`, {
    headers: {
      "x-api-user": userId,
      "x-api-key": apiToken,
      "x-client": `${userId}-MMM-HabiticaChores`,
      "content-type": "application/json"
    }
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    console.error(await res.text());
    process.exit(2);
  }
  const json = await res.json();
  const tasks = json.data || [];

  const counts = tasks.reduce((m, t) => ((m[t.type] = (m[t.type] || 0) + 1), m), {});
  console.log("Task counts by type:", counts, "\n");

  const dueDailies = tasks
    .filter((t) => t.type === "daily" && t.isDue !== false && !t.completed)
    .map((t) => t.text.trim());
  const openTodos = tasks
    .filter((t) => t.type === "todo" && !t.completed)
    .map((t) => t.text.trim());

  console.log(`OUTSTANDING DAILIES today (isDue & !completed) — ${dueDailies.length}:`);
  dueDailies.forEach((t) => console.log("  ☐ " + t));
  console.log(`\nOPEN TO-DOS (!completed) — ${openTodos.length}:`);
  openTodos.forEach((t) => console.log("  ☐ " + t));
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(3);
});
