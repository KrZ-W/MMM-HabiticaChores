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
// Habitica asks third-party tools for a constant "{maintainer-userId}-{appName}".
const X_CLIENT = "MMM-HabiticaChores";

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
    this.cache = {};    // "<apiBase>:<key>" -> { ts, ... }
    this.inflight = {}; // same key -> Promise (dedupe concurrent fetches)
    console.log(`[${this.name}] helper started`);
  },

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "HABITICA_FETCH") return;
    // Never let a bad config or an unexpected shape reject unhandled: an
    // unhandled rejection would take down the whole MagicMirror process.
    Promise.resolve()
      .then(() => this.fetchAll(payload))
      .catch((err) => {
        console.error(`[${this.name}] fetch cycle failed: ${err.message}`);
        this.sendSocketNotification("HABITICA_TASKS", {
          identifier: payload && payload.identifier,
          users: [],
          house: { name: "", error: err.message, chores: [] }
        });
      });
  },

  // Per-cycle settings, resolved from this instance's options (never stored on
  // `this` — several module instances share one helper and would race).
  settings(options) {
    return {
      apiBase: String(options.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
      reqGap: options.reqGapMs != null ? options.reqGapMs : 500,
      cacheTTL: (options.cacheSeconds != null ? options.cacheSeconds : 240) * 1000
    };
  },

  // payload = { identifier, users: [{name, userId, apiToken, stats?}], options }
  async fetchAll(payload) {
    const { identifier, options = {} } = payload || {};
    const users = Array.isArray(payload && payload.users) ? payload.users : [];

    if (options.demo) {
      this.sendSocketNotification("HABITICA_TASKS", { identifier, users: DEMO_USERS });
      return;
    }
    const cfg = this.settings(options);

    const results = [];
    for (const user of users) {
      const entry = { name: user.name || "Habitica", error: null, stale: false, dailies: [], todos: [], summary: null, stats: null, avatar: null };
      try {
        const b = await this.getBundle(user, cfg);
        Object.assign(entry, splitChores(b.rawTasks, options));
        entry.summary = summarize(b.rawTasks);
        entry.avatar = b.avatar;
        if (user.stats !== false) entry.stats = b.stats;
      } catch (err) {
        console.error(`[${this.name}] fetch failed for ${user.name}: ${err.message}`);
        // Prefer showing slightly stale chores over blanking the board.
        const stale = this.cache[`${cfg.apiBase}:u:${user.userId}`];
        if (stale) {
          Object.assign(entry, splitChores(stale.rawTasks, options));
          entry.summary = summarize(stale.rawTasks);
          entry.avatar = stale.avatar;
          if (user.stats !== false) entry.stats = stale.stats;
          entry.stale = true;
        } else {
          entry.error = err.message;
        }
      }
      results.push(entry);
    }

    let house = null;
    if (options.group && options.group.id && options.group.apiToken) {
      try {
        house = await this.getGroup(options.group, options, users, cfg);
      } catch (err) {
        console.error(`[${this.name}] group fetch failed: ${err.message}`);
        house = { name: options.group.name || "Maison", error: err.message, chores: [] };
      }
    }
    this.sendSocketNotification("HABITICA_TASKS", { identifier, users: results, house });
  },

  // Fetch a group's shared chores + who's assigned + who's done (group tasks
  // live on the group, not in members' personal lists).
  async fetchGroup(group, options, users, cfg) {
    const res = await fetch(`${cfg.apiBase}/tasks/group/${group.id}`, {
      headers: this.authHeaders({ userId: group.userId, apiToken: group.apiToken })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (group)`);
    const tasks = (await res.json()).data || [];
    const nameOf = (uid) => { const u = users.find((x) => x.userId === uid); return u ? u.name : null; };
    const onlyDue = options.onlyDueToday !== false;
    const chores = tasks
      .filter((t) => t.type === "daily")
      .filter((t) => (onlyDue ? t.isDue !== false : true))
      .map((t) => {
        const g = t.group || {};
        const detail = g.assignedUsersDetail || {};
        const assigned = (g.assignedUsers || [])
          .map((uid) => ({ name: nameOf(uid), done: !!(detail[uid] && detail[uid].completed) }))
          .filter((a) => a.name); // drop members not listed in `users`
        // Unassigned group chores fall back to the task's own completed flag.
        const done = assigned.length ? assigned.some((a) => a.done) : !!t.completed;
        return { text: (t.text || "").trim(), priority: t.priority, assigned, done };
      });
    return { name: group.name || "Maison", chores };
  },

  // Generic cache + in-flight dedupe. Keyed by apiBase so instances pointed at
  // different servers can never share an entry.
  cached(key, cfg, producer) {
    const k = `${cfg.apiBase}:${key}`;
    const hit = this.cache[k];
    if (hit && Date.now() - hit.ts < cfg.cacheTTL) return Promise.resolve(hit);
    if (this.inflight[k]) return this.inflight[k];

    const p = producer()
      .then((v) => { const e = { ...v, ts: Date.now() }; this.cache[k] = e; delete this.inflight[k]; return e; })
      .catch((e) => { delete this.inflight[k]; throw e; });
    this.inflight[k] = p;
    return p;
  },

  getBundle(user, cfg) {
    return this.cached(`u:${user.userId}`, cfg, () => this._fetchBundle(user, cfg));
  },

  getGroup(group, options, users, cfg) {
    return this.cached(`g:${group.id}`, cfg, () => this.fetchGroup(group, options, users, cfg));
  },

  async _fetchBundle(user, cfg) {
    const rawTasks = await this.fetchUserTasks(user, cfg);
    await this.sleep(cfg.reqGap);
    const info = await this.fetchUserInfo(user, cfg);
    return { rawTasks, stats: info.stats, avatar: info.avatar };
  },

  authHeaders(user) {
    return {
      "x-api-user": user.userId,
      "x-api-key": user.apiToken,
      "x-client": X_CLIENT
    };
  },

  async fetchUserTasks(user, cfg) {
    const res = await fetch(`${cfg.apiBase}/tasks/user`, { headers: this.authHeaders(user) });
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

  async fetchUserInfo(user, cfg) {
    const res = await fetch(`${cfg.apiBase}/user?userFields=stats,preferences,items.gear.equipped`, {
      headers: this.authHeaders(user)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (user)`);
    const d = (await res.json()).data || {};
    const s = d.stats || {};
    const num = (v) => (Number.isFinite(v) ? Math.round(v) : null); // never render NaN
    const stats = {
      class: s.class, lvl: s.lvl,
      hp: num(s.hp), maxHealth: 50,
      exp: num(s.exp), toNextLevel: this.tnl(s.lvl),
      gp: num(s.gp)
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
