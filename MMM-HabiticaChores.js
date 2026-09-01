/* MMM-HabiticaChores — MagicMirror² module
 *
 * Displays outstanding Habitica chores (due dailies + open to-dos) for one or
 * more family members as a glanceable checklist. Read-only.
 */
Module.register("MMM-HabiticaChores", {
  defaults: {
    users: [],                    // [{ name, userId, apiToken }]
    demo: false,                  // true = render canned sample chores (no account needed)
    panel: false,                 // true = draw a translucent card behind the list (readable over photos)
    showStats: false,             // true = show a compact stat line (class/level/HP/MP/XP + today's completion) per user
    showDailies: true,
    showTodos: true,
    onlyDueToday: true,           // dailies: only those scheduled for today
    hideCompleted: true,          // hide chores already done
    maxPerUser: 0,                // 0 = no cap
    updateInterval: 15 * 60 * 1000,
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
    if (user.summary && user.summary.dailiesDue > 0) {
      add("hc-progress", `✓ ${user.summary.dailiesDone}/${user.summary.dailiesDue}`);
    }
    return line;
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "habitica-chores" + (this.config.panel ? " hc-panel" : "");

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

      if (this.config.showStats && (user.stats || user.summary)) {
        block.appendChild(this.buildStatLine(user));
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
