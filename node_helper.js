/* MMM-HabiticaChores — node_helper.js
 *
 * Fetches each configured Habitica user's tasks + stats + avatar composition
 * from the v3 API and returns them to the module. Per-user results are cached
 * (short TTL) so several module instances (e.g. a summary view + a detail view)
 * share one fetch instead of multiplying API calls against the 30/min limit.
 *
 * Habitica API: https://habitica.com/apidoc/  — auth via x-api-user / x-api-key.
 */
const NodeHelper = require("node_helper");
const { splitChores, summarize } = require("./chores");

const DEFAULT_API_BASE = "https://habitica.com/api/v3";
const CDN = "https://habitica-assets.s3.amazonaws.com/mobileApp/images/";

// Canned data for `demo: true` — preview without an account (no stats/avatar).
const DEMO_USERS = [
  {
    name: "Amélie", error: null, stats: null, avatar: null,
    summary: { dailiesDue: 4, dailiesDone: 1, todosOpen: 1 },
    dailies: [
      { id: "d1", text: "Brosser les dents", completed: false, isDue: true, checklist: [] },
      { id: "d2", text: "Faire son lit", completed: false, isDue: true, checklist: [] },
      { id: "d3", text: "Devoirs de français", completed: false, isDue: true,
        checklist: [{ text: "Lecture", completed: true }, { text: "Exercices", completed: false }] },
      { id: "d4", text: "Nourrir le chat", completed: false, isDue: true, checklist: [] }
    ],
    todos: [{ id: "t1", text: "Signer le formulaire d'école", completed: false, date: null, checklist: [] }]
  },
  {
    name: "Félix", error: null, stats: null, avatar: null,
    summary: { dailiesDue: 3, dailiesDone: 0, todosOpen: 1 },
    dailies: [
      { id: "d5", text: "Brosser les dents", completed: false, isDue: true, checklist: [] },
      { id: "d6", text: "Vider le lave-vaisselle", completed: false, isDue: true, checklist: [] },
      { id: "d7", text: "Pratiquer le piano 15 min", completed: false, isDue: true, checklist: [] }
    ],
    todos: [{ id: "t2", text: "Projet de sciences", completed: false, date: null, checklist: [] }]
  }
];

module.exports = NodeHelper.create({
  start() {
    this.reqGap = 500;              // ms between Habitica requests (rate limit)
    this.cacheTTL = 5 * 60 * 1000; // per-user result cache
    this.cache = {};               // userId -> { ts, rawTasks, stats, avatar }
    this.inflight = {};            // userId -> Promise (dedupe concurrent fetches)
    console.log(`[${this.name}] helper started`);
  },

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "HABITICA_FETCH") this.fetchAll(payload);
  },

  // payload = { identifier, users: [{name, userId, apiToken, stats?}], options }
  async fetchAll(payload) {
    const { identifier, users = [], options = {} } = payload;
    this.apiBase = (options.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""); // cloud or self-hosted
    this.reqGap = options.reqGapMs != null ? options.reqGapMs : 500;          // stagger; lower for self-host
    this.cacheTTL = (options.cacheSeconds != null ? options.cacheSeconds : 240) * 1000; // short = more live

    if (options.demo) {
      this.sendSocketNotification("HABITICA_TASKS", { identifier, users: DEMO_USERS });
      return;
    }

    const results = [];
    for (const user of users) {
      const entry = { name: user.name || "Habitica", error: null, dailies: [], todos: [], summary: null, stats: null, avatar: null };
      try {
        const b = await this.getBundle(user);
        Object.assign(entry, splitChores(b.rawTasks, options));
        entry.summary = summarize(b.rawTasks);
        entry.avatar = b.avatar;
        if (user.stats !== false) entry.stats = b.stats;
      } catch (err) {
        console.error(`[${this.name}] fetch failed for ${user.name}: ${err.message}`);
        entry.error = err.message;
      }
      results.push(entry);
    }
    this.sendSocketNotification("HABITICA_TASKS", { identifier, users: results });
  },

  // Cached, de-duplicated per-user fetch.
  getBundle(user) {
    const now = Date.now();
    const cached = this.cache[user.userId];
    if (cached && now - cached.ts < this.cacheTTL) return Promise.resolve(cached);
    if (this.inflight[user.userId]) return this.inflight[user.userId];

    const p = this._fetchBundle(user)
      .then((b) => { this.cache[user.userId] = b; delete this.inflight[user.userId]; return b; })
      .catch((e) => { delete this.inflight[user.userId]; throw e; });
    this.inflight[user.userId] = p;
    return p;
  },

  async _fetchBundle(user) {
    const rawTasks = await this.fetchUserTasks(user);
    await this.sleep(this.reqGap);
    const info = await this.fetchUserInfo(user);
    return { ts: Date.now(), rawTasks, stats: info.stats, avatar: info.avatar };
  },

  authHeaders(user) {
    return {
      "x-api-user": user.userId,
      "x-api-key": user.apiToken,
      "x-client": `${user.userId}-MMM-HabiticaChores`,
      "content-type": "application/json"
    };
  },

  async fetchUserTasks(user) {
    const res = await fetch(`${this.apiBase}/tasks/user`, { headers: this.authHeaders(user) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? " — " + body.slice(0, 120) : ""}`);
    }
    const json = await res.json();
    if (!json || json.success !== true || !Array.isArray(json.data)) {
      throw new Error("unexpected API response shape");
    }
    return json.data;
  },

  async fetchUserInfo(user) {
    const res = await fetch(`${this.apiBase}/user?userFields=stats,preferences,items.gear.equipped`, {
      headers: this.authHeaders(user)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (user)`);
    const d = (await res.json()).data || {};
    const s = d.stats || {};
    const stats = {
      class: s.class, lvl: s.lvl,
      hp: Math.round(s.hp), maxHealth: 50,
      exp: Math.round(s.exp), toNextLevel: this.tnl(s.lvl),
      gp: Math.round(s.gp)
    };
    const equipped = (d.items && d.items.gear && d.items.gear.equipped) || {};
    const avatar = this.buildAvatarLayers(d.preferences || {}, equipped);
    return { stats, avatar };
  },

  // Ordered list of Habitica CDN image URLs that compose the character.
  // Base gear (`*_base_0` = nothing equipped) has no image and is skipped.
  buildAvatarLayers(prefs, gear) {
    const size = prefs.size || "slim";
    const skin = prefs.skin || "915533";
    const shirt = prefs.shirt || "blue";
    const hair = prefs.hair || {};
    const hc = hair.color || "red";
    const layers = [];
    const add = (key) => layers.push(CDN + key + ".png");
    const worn = (k) => k && !/_base_0$/.test(k);

    add(`skin_${skin}`);
    add(`${size}_shirt_${shirt}`);
    if (worn(gear.armor)) add(`${size}_${gear.armor}`);
    add("head_0");
    if (hair.base) add(`hair_base_${hair.base}_${hc}`);
    if (hair.bangs) add(`hair_bangs_${hair.bangs}_${hc}`);
    if (hair.mustache) add(`hair_mustache_${hair.mustache}_${hc}`);
    if (hair.beard) add(`hair_beard_${hair.beard}_${hc}`);
    if (worn(gear.head)) add(gear.head);
    if (worn(gear.eyewear)) add(gear.eyewear);
    if (hair.flower) add(`hair_flower_${hair.flower}`);
    if (worn(gear.shield)) add(gear.shield);
    if (worn(gear.weapon)) add(gear.weapon);
    return layers;
  },

  // XP required to reach the next level (Habitica common formula)
  tnl(level) {
    if (!level || level < 1) return 0;
    return Math.round(((Math.pow(level, 2) * 0.25) + (10 * level) + 139.75) / 10) * 10;
  }
});
