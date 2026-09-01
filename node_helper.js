/* MMM-HabiticaChores — node_helper.js
 *
 * Fetches each configured Habitica user's tasks from the v3 API and returns
 * the outstanding chores (due, incomplete dailies + open to-dos) to the module.
 *
 * Habitica API: https://habitica.com/apidoc/  — auth via x-api-user / x-api-key.
 * Third-party tools are asked to send an x-client header ("<userId>-<appName>").
 */
const NodeHelper = require("node_helper");
const { splitChores } = require("./chores");

const API_BASE = "https://habitica.com/api/v3";

// Canned data for `demo: true` — lets you preview the layout without an account.
const DEMO_USERS = [
  {
    name: "Amélie",
    error: null,
    dailies: [
      { id: "d1", text: "Brosser les dents", completed: false, isDue: true, date: null, checklist: [] },
      { id: "d2", text: "Faire son lit", completed: false, isDue: true, date: null, checklist: [] },
      { id: "d3", text: "Devoirs de français", completed: false, isDue: true, date: null,
        checklist: [{ text: "Lecture", completed: true }, { text: "Exercices", completed: false }] },
      { id: "d4", text: "Nourrir le chat", completed: false, isDue: true, date: null, checklist: [] }
    ],
    todos: [
      { id: "t1", text: "Signer le formulaire d'école", completed: false, date: null, checklist: [] }
    ]
  },
  {
    name: "Félix",
    error: null,
    dailies: [
      { id: "d5", text: "Brosser les dents", completed: false, isDue: true, date: null, checklist: [] },
      { id: "d6", text: "Vider le lave-vaisselle", completed: false, isDue: true, date: null, checklist: [] },
      { id: "d7", text: "Pratiquer le piano 15 min", completed: false, isDue: true, date: null, checklist: [] }
    ],
    todos: [
      { id: "t2", text: "Projet de sciences", completed: false, date: null, checklist: [] }
    ]
  }
];

module.exports = NodeHelper.create({
  start() {
    console.log(`[${this.name}] helper started`);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "HABITICA_FETCH") {
      this.fetchAll(payload);
    }
  },

  // payload = { identifier, users: [{name, userId, apiToken}], options }
  async fetchAll(payload) {
    const { identifier, users = [], options = {} } = payload;

    if (options.demo) {
      this.sendSocketNotification("HABITICA_TASKS", { identifier, users: DEMO_USERS });
      return;
    }

    const results = [];
    for (const user of users) {
      try {
        const tasks = await this.fetchUserTasks(user);
        results.push({ name: user.name || "Habitica", error: null, ...splitChores(tasks, options) });
      } catch (err) {
        console.error(`[${this.name}] fetch failed for ${user.name}: ${err.message}`);
        results.push({ name: user.name || "Habitica", error: err.message, dailies: [], todos: [] });
      }
    }
    this.sendSocketNotification("HABITICA_TASKS", { identifier, users: results });
  },

  async fetchUserTasks(user) {
    const res = await fetch(`${API_BASE}/tasks/user`, {
      headers: {
        "x-api-user": user.userId,
        "x-api-key": user.apiToken,
        "x-client": `${user.userId}-MMM-HabiticaChores`,
        "content-type": "application/json"
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? " — " + body.slice(0, 120) : ""}`);
    }
    const json = await res.json();
    if (!json || json.success !== true || !Array.isArray(json.data)) {
      throw new Error("unexpected API response shape");
    }
    return json.data;
  }
});
