/* MMM-HabiticaChores — MagicMirror² module
 *
 * Displays outstanding Habitica chores (due dailies + open to-dos) for one or
 * more family members as a glanceable checklist. Read-only.
 */
Module.register("MMM-HabiticaChores", {
  defaults: {
    users: [],                    // [{ name, userId, apiToken }]
    apiBase: "",                  // override API base for a self-hosted instance (e.g. "http://host:3000/api/v3"); blank = habitica.com
    mode: "list",                 // "list" = detailed chores; "summary" = compact avatar + count strip; "stats" = stat cards
    columns: 1,                   // list mode: >1 lays out person cards in a grid instead of one stack
    showDifficulty: false,        // list mode: show per-task difficulty pips (reward level)
    demo: false,                  // true = render canned sample chores (no account needed)
    panel: false,                 // true = draw a translucent card behind the list (readable over photos)
    showStats: false,             // true = show a compact stat line (class/level/HP/MP/XP + today's completion) per user
    showDailies: true,
    showTodos: true,
    onlyDueToday: true,           // dailies: only those scheduled for today
    hideCompleted: true,          // hide chores already done
    maxPerUser: 0,                // 0 = no cap
    updateInterval: 15 * 60 * 1000,
    cacheSeconds: 240,            // node_helper cache TTL; lower = more "live" (fine on self-host, no rate limit)
    reqGapMs: 500,                // ms between API requests; lower for self-host
    initialLoadDelay: 1500,
    showUserHeader: true,         // show each person's name
    dailiesLabel: "Tâches du jour",
    todosLabel: "À faire",
    emptyText: "Tout est fait 🎉",
    fade: false
  },

  getStyles() {
    return ["MMM-HabiticaChores.css"];
  },

  start() {
    this.usersData = null;
    this.loaded = false;
    this.errored = null;
    this.scheduleFetch(this.config.initialLoadDelay);
  },

  sendFetch() {
    this.sendSocketNotification("HABITICA_FETCH", {
      identifier: this.identifier,
      users: this.config.users,
      options: {
        demo: this.config.demo,
        apiBase: this.config.apiBase,
        cacheSeconds: this.config.cacheSeconds,
        reqGapMs: this.config.reqGapMs,
        showStats: this.config.showStats,
        onlyDueToday: this.config.onlyDueToday,
        hideCompleted: this.config.hideCompleted
      }
    });
  },

  scheduleFetch(delay) {
    setTimeout(() => this.sendFetch(), delay); // initial
    clearInterval(this.fetchTimer);
    this.fetchTimer = setInterval(() => this.sendFetch(), this.config.updateInterval); // recurring
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "HABITICA_TASKS" || payload.identifier !== this.identifier) return;
    this.usersData = payload.users;
    this.loaded = true;
    this.updateDom(this.config.fade ? 500 : 0);
  },

  buildStatLine(user) {
    const s = user.stats || {};
    const line = document.createElement("div");
    line.className = "hc-stats xsmall";

    const classFr = { warrior: "Guerrier", wizard: "Mage", healer: "Soigneur", rogue: "Voleur" }[s.class] || "";
    if (s.lvl != null || classFr) {
      const cls = document.createElement("span");
      cls.className = "hc-stat-class";
      cls.textContent = (classFr ? classFr + " · " : "") + (s.lvl != null ? "Niv " + s.lvl : "");
      line.appendChild(cls);
    }
    const add = (kind, txt) => {
      const e = document.createElement("span");
      e.className = "hc-stat " + kind;
      e.textContent = txt;
      line.appendChild(e);
    };
    if (s.hp != null) add("hc-hp", `❤ ${s.hp}/${s.maxHealth}`);
    if (s.exp != null && s.toNextLevel) add("hc-xp", `⭐ ${s.exp}/${s.toNextLevel}`);
    if (s.gp != null) add("hc-gold", `🪙 ${s.gp}`);
    return line;
  },

  // Difficulty pips (reward level): trivial/easy = 1, medium = 2, hard = 3.
  difficultyPips(priority) {
    const count = { 0.1: 1, 1: 1, 1.5: 2, 2: 3 }[priority] || 1;
    const label = { 0.1: "Triviale", 1: "Facile", 1.5: "Moyenne", 2: "Difficile" }[priority] || "";
    const el = document.createElement("span");
    el.className = "hc-diff d" + String(priority).replace(".", "_");
    el.title = label;
    el.textContent = "◆".repeat(count);
    return el;
  },

  // Small "done/due" progress line, always shown in list mode.
  progressLine(user) {
    const el = document.createElement("div");
    el.className = "hc-progress-line xsmall";
    const done = user.summary.dailiesDone, due = user.summary.dailiesDue;
    el.textContent = `✓ ${done}/${due}`;
    if (done >= due) el.classList.add("done");
    return el;
  },

  buildAvatar(layers) {
    const box = document.createElement("div");
    box.className = "hc-avatar";
    (layers || []).forEach((url) => {
      const img = document.createElement("img");
      img.className = "hc-layer";
      img.src = url;
      img.onerror = function () { this.style.display = "none"; }; // hide layers with no image
      box.appendChild(img);
    });
    return box;
  },

  // Compact horizontal strip: avatar + name + today's completion, per person.
  buildSummary() {
    const wrapper = document.createElement("div");
    wrapper.className = "habitica-summary" + (this.config.panel ? " hc-panel" : "");
    if (!this.loaded) {
      wrapper.className += " dimmed small";
      wrapper.textContent = "…";
      return wrapper;
    }
    this.usersData.forEach((user) => {
      const cell = document.createElement("div");
      cell.className = "hs-cell";

      if (user.avatar && user.avatar.length) cell.appendChild(this.buildAvatar(user.avatar));

      const name = document.createElement("div");
      name.className = "hs-name";
      name.textContent = user.name;
      cell.appendChild(name);

      const count = document.createElement("div");
      count.className = "hs-count";
      if (user.error) {
        count.className += " muted";
        count.textContent = "⚠";
      } else if (user.summary && user.summary.dailiesDue > 0) {
        const { dailiesDone: done, dailiesDue: due } = user.summary;
        if (done >= due) count.className += " done";
        count.textContent = `${done}/${due}`;
      } else {
        count.className += " muted";
        count.textContent = "—";
      }
      cell.appendChild(count);
      wrapper.appendChild(cell);
    });
    return wrapper;
  },

  buildBar(icon, cur, max, kind) {
    const row = document.createElement("div");
    row.className = "hstat-bar-row";
    const ic = document.createElement("span");
    ic.className = "hstat-ic " + kind;
    ic.textContent = icon;
    const track = document.createElement("div");
    track.className = "hstat-track";
    const fill = document.createElement("div");
    fill.className = "hstat-fill " + kind;
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0;
    fill.style.width = pct + "%";
    track.appendChild(fill);
    const val = document.createElement("div");
    val.className = "hstat-val";
    val.textContent = `${cur}/${max}`;
    row.appendChild(ic);
    row.appendChild(track);
    row.appendChild(val);
    return row;
  },

  // Full per-player stat cards (mode: "stats"): big avatar + HP/XP bars + gold.
  buildStats() {
    const wrapper = document.createElement("div");
    wrapper.className = "habitica-stats" + (this.config.panel ? " hc-panel" : "");
    if (!this.loaded) {
      wrapper.className += " dimmed small";
      wrapper.textContent = "…";
      return wrapper;
    }
    const classFr = { warrior: "Guerrier", wizard: "Mage", healer: "Soigneur", rogue: "Voleur" };
    this.usersData.forEach((user) => {
      if (!user.stats) return; // skip accounts without stats (e.g. the shared bucket)
      const s = user.stats;
      const card = document.createElement("div");
      card.className = "hstat-card";
      if (user.avatar && user.avatar.length) card.appendChild(this.buildAvatar(user.avatar));

      const info = document.createElement("div");
      info.className = "hstat-info";
      const name = document.createElement("div");
      name.className = "hstat-name";
      name.textContent = user.name;
      info.appendChild(name);
      const sub = document.createElement("div");
      sub.className = "hstat-sub";
      sub.textContent = (classFr[s.class] || "") + " · Niveau " + (s.lvl != null ? s.lvl : "?");
      info.appendChild(sub);

      info.appendChild(this.buildBar("❤", s.hp, s.maxHealth, "hp"));
      if (s.toNextLevel) info.appendChild(this.buildBar("⭐", s.exp, s.toNextLevel, "xp"));

      const foot = document.createElement("div");
      foot.className = "hstat-foot";
      const gold = document.createElement("span");
      gold.className = "hstat-gold";
      gold.textContent = "🪙 " + s.gp;
      foot.appendChild(gold);
      if (user.summary && user.summary.dailiesDue > 0) {
        const c = document.createElement("span");
        const done = user.summary.dailiesDone, due = user.summary.dailiesDue;
        c.className = "hstat-done" + (done >= due ? " done" : "");
        c.textContent = `✓ ${done}/${due} aujourd'hui`;
        foot.appendChild(c);
      }
      info.appendChild(foot);
      card.appendChild(info);
      wrapper.appendChild(card);
    });
    return wrapper;
  },

  getDom() {
    if (this.config.mode === "summary") return this.buildSummary();
    if (this.config.mode === "stats") return this.buildStats();

    const wrapper = document.createElement("div");
    wrapper.className = "habitica-chores" + (this.config.panel ? " hc-panel" : "") +
      (this.config.columns > 1 ? " hc-grid" : "");

    if (!this.config.demo && (!this.config.users || this.config.users.length === 0)) {
      wrapper.innerHTML = "MMM-HabiticaChores: aucun utilisateur configuré";
      wrapper.className += " dimmed small";
      return wrapper;
    }
    if (!this.loaded) {
      wrapper.innerHTML = "Chargement des tâches…";
      wrapper.className += " dimmed small";
      return wrapper;
    }

    this.usersData.forEach((user) => {
      const block = document.createElement("div");
      block.className = "hc-user";

      if (this.config.showUserHeader) {
        const h = document.createElement("div");
        h.className = "hc-user-name";
        h.textContent = user.name;
        block.appendChild(h);
      }

      if (user.error) {
        const e = document.createElement("div");
        e.className = "hc-error small dimmed";
        e.textContent = "⚠ " + user.error;
        block.appendChild(e);
        wrapper.appendChild(block);
        return;
      }

      if (this.config.showStats && user.stats) {
        block.appendChild(this.buildStatLine(user));
      }
      if (user.summary && user.summary.dailiesDue > 0) {
        block.appendChild(this.progressLine(user));
      }

      const sections = [];
      if (this.config.showDailies) sections.push({ label: this.config.dailiesLabel, items: user.dailies });
      if (this.config.showTodos) sections.push({ label: this.config.todosLabel, items: user.todos });

      const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
      if (totalItems === 0) {
        const empty = document.createElement("div");
        empty.className = "hc-empty small dimmed";
        empty.textContent = this.config.emptyText;
        block.appendChild(empty);
        wrapper.appendChild(block);
        return;
      }

      sections.forEach((section) => {
        if (section.items.length === 0) return;
        const secLabel = document.createElement("div");
        secLabel.className = "hc-section-label xsmall dimmed";
        secLabel.textContent = section.label;
        block.appendChild(secLabel);

        const list = document.createElement("ul");
        list.className = "hc-list";
        let items = section.items;
        if (this.config.maxPerUser > 0) items = items.slice(0, this.config.maxPerUser);

        items.forEach((item) => {
          const li = document.createElement("li");
          li.className = "hc-item" + (item.completed ? " done" : "");

          const box = document.createElement("span");
          box.className = "hc-check";
          box.textContent = item.completed ? "☑" : "☐";
          li.appendChild(box);

          const label = document.createElement("span");
          label.className = "hc-text";
          label.textContent = item.text;
          if (item.checklist && item.checklist.length) {
            const doneCount = item.checklist.filter((c) => c.completed).length;
            const badge = document.createElement("span");
            badge.className = "hc-checklist xsmall dimmed";
            badge.textContent = ` ${doneCount}/${item.checklist.length}`;
            label.appendChild(badge);
          }
          if (this.config.showDifficulty && item.priority != null) {
            label.appendChild(this.difficultyPips(item.priority));
          }
          li.appendChild(label);
          list.appendChild(li);
        });

        if (this.config.maxPerUser > 0 && section.items.length > this.config.maxPerUser) {
          const more = document.createElement("li");
          more.className = "hc-more xsmall dimmed";
          more.textContent = `+${section.items.length - this.config.maxPerUser}…`;
          list.appendChild(more);
        }
        block.appendChild(list);
      });

      wrapper.appendChild(block);
    });

    return wrapper;
  }
});
