/* MMM-HabiticaChores — node_helper.js
 *
 * Fetches each configured Habitica user's tasks from the v3 API and returns
 * the outstanding chores (due, incomplete dailies + open to-dos) to the module.
 *
 * Habitica API: https://habitica.com/apidoc/  — auth via x-api-user / x-api-key.
 * Third-party tools are asked to send an x-client header ("<userId>-<appName>").
 */
const NodeHelper = require("node_helper");
const { splitChores, summarize } = require("./chores");

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
    this.reqGap = 500; // ms between Habitica requests, to stay under the rate limit
    console.log(`[${this.name}] helper started`);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "HABITICA_FETCH") {
      this.fetchAll(payload);
    }
  },

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  // payload = { identifier, users: [{name, userId, apiToken, stats?}], options }
  async fetchAll(payload) {
    const { identifier, users = [], options = {} } = payload;

    if (options.demo) {
      this.sendSocketNotification("HABITICA_TASKS", { identifier, users: DEMO_USERS });
      return;
    }

    const results = [];
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      if (i > 0) await this.sleep(this.reqGap); // stagger requests (Habitica rate limit)
      const entry = { name: user.name || "Habitica", error: null, dailies: [], todos: [], stats: null };
      try {
        const tasks = await this.fetchUserTasks(user);
        Object.assign(entry, splitChores(tasks, options));
        entry.summary = summarize(tasks);
        if (options.showStats && user.stats !== false) {
          await this.sleep(this.reqGap);
          entry.stats = await this.fetchUserStats(user);
        }
      } catch (err) {
        console.error(`[${this.name}] fetch failed for ${user.name}: ${err.message}`);
        entry.error = err.message;
      }
      results.push(entry);
    }
    this.sendSocketNotification("HABITICA_TASKS", { identifier, users: results });
  },

  async fetchUserStats(user) {
    const res = await fetch(`${API_BASE}/user?userFields=stats`, {
      headers: {
        "x-api-user": user.userId,
        "x-api-key": user.apiToken,
        "x-client": `${user.userId}-MMM-HabiticaChores`,
        "content-type": "application/json"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (stats)`);
    const json = await res.json();
    const s = json && json.data && json.data.stats;
    if (!s) return null;
    return {
      class: s.class,
      lvl: s.lvl,
      hp: Math.round(s.hp),
      maxHealth: 50, // Habitica HP cap is a constant
      exp: Math.round(s.exp),
      toNextLevel: this.tnl(s.lvl), // API omits it; derive from Habitica's formula
      gp: Math.round(s.gp)
    };
  },

  // XP required to reach the next level (Habitica common formula)
  tnl(level) {
    if (!level || level < 1) return 0;
    return Math.round(((Math.pow(level, 2) * 0.25) + (10 * level) + 139.75) / 10) * 10;
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
