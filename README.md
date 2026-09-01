# MMM-HabiticaChores

A [MagicMirror²](https://magicmirror.builders) module that shows outstanding
**[Habitica](https://habitica.com)** chores — the **dailies due today** and
**open to-dos** — for one or more family members, as a glanceable, read-only
checklist. Turn the mirror into a "chores on the wall" board.

> Unlike [`MMM-HabiticaStats`](https://github.com/delightedCrow/MMM-HabiticaStats),
> which shows only a player's level / HP / XP, this module renders the actual
> **task list**.

<p align="center">
  <img src="docs/screenshot.png" alt="MMM-HabiticaChores showing two family members' chores" width="320">
</p>

## Features

- **Dailies due today** (`isDue` and not completed) + **open to-dos**, per person.
- **Multiple users** — each family member with their own User ID + API token.
- **Optional stat line** (`showStats`) — class · level · ❤ HP · ⭐ XP · 🪙 gold, plus
  today's completion (`✓ 2/4`), all localizable and computed with Habitica's own
  formulas (no extra library). Requests are staggered to respect the rate limit.
- **Two view modes** (`mode`): a detailed `list` (chores per person) or a compact
  horizontal `summary` — each person's **composited Habitica avatar sprite** +
  today's completion (`2/4`). Pair them on a multi-page mirror (glance on the
  home page, detail on another).
- **Checklist progress** badge (e.g. `1/2`) for tasks with sub-items.
- **Shared node_helper cache** — multiple instances (summary + detail) trigger
  one set of API calls, not several.
- **Read-only & safe** — never modifies your tasks; the mirror just reflects
  Habitica, refreshing on a timer.
- **Demo mode** — preview the layout with canned data, no account required.
- **Optional panel** — a translucent card so text stays readable over a photo
  background.

## Install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/KrZ-W/MMM-HabiticaChores.git
```

No `npm install` needed — it uses Node's built-in `fetch` (Node 18+).

## Configuration

Add to the `modules` array in `~/MagicMirror/config/config.js`:

```js
{
  module: "MMM-HabiticaChores",
  position: "top_left",
  config: {
    users: [
      { name: "Amélie", userId: "xxxxxxxx-....", apiToken: "yyyyyyyy-...." },
      { name: "Félix",  userId: "xxxxxxxx-....", apiToken: "yyyyyyyy-...." }
    ],
    panel: true
  }
}
```

Get each person's **User ID** and **API token** from
**Habitica → Settings → Site Data**. The API token is like a password — keep it
out of any public place (including GitHub); it belongs only in your local
`config.js`.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `users` | array | `[]` | `{ name, userId, apiToken }` per person. |
| `mode` | string | `"list"` | `"list"` (detailed chores) or `"summary"` (avatar + completion strip). |
| `showDailies` | bool | `true` | Show the "dailies due today" section. |
| `showTodos` | bool | `true` | Show the "to-dos" section. |
| `onlyDueToday` | bool | `true` | Dailies: only those scheduled for today. |
| `hideCompleted` | bool | `true` | Hide chores already completed. |
| `maxPerUser` | int | `0` | Cap items shown per person (`0` = no cap). |
| `panel` | bool | `false` | Draw a translucent card behind the list. |
| `showStats` | bool | `false` | Show a per-user stat line (class/level/HP/XP/gold + today's completion). |
| `demo` | bool | `false` | Render canned sample chores (no account). |
| `showUserHeader` | bool | `true` | Show each person's name as a header. |
| `updateInterval` | int | `900000` | Refresh interval, ms (default 15 min). |
| `dailiesLabel` | string | `"Tâches du jour"` | Label for the dailies section. |
| `todosLabel` | string | `"À faire"` | Label for the to-dos section. |
| `emptyText` | string | `"Tout est fait 🎉"` | Shown when a person has nothing left. |

A `users[]` entry may set `stats: false` to skip the stat line for that account
(handy for a shared "household" bucket where level/XP is meaningless).

## Two pages on one mirror

Chores don't have to crowd your main layout. Pair this with
[`MMM-pages`](https://github.com/edward-shen/MMM-pages) to auto-rotate between
your normal dashboard (page 0) and a dedicated chores page (page 1), leaving the
first page untouched:

```js
{
  module: "MMM-pages",
  config: {
    modules: [
      ["clock", "calendar", "weather", "newsfeed"], // page 0
      ["MMM-HabiticaChores"]                          // page 1
    ],
    fixed: ["MMM-page-indicator"],
    timings: { default: 20000 } // 20 s per page
  }
}
```

## Test your credentials without MagicMirror

```bash
HABITICA_USER=<userId> HABITICA_TOKEN=<apiToken> node test-api.js
```

Prints the task counts and the outstanding dailies / to-dos the module would
show. Run the parsing unit test with `npm test`.

## How a "chore" is defined

- A Habitica **Daily** that is **due today** (`isDue`) and **not yet completed**.
- Plus open **To-Dos** (`completed === false`), soonest due first.
- **Habits** and **Rewards** are ignored.

Completing chores is done in the Habitica app (phone/web); the mirror reflects
the new state on the next refresh. Habitica's rate limit is 30 requests/min per
user — the default 15-minute refresh is far under it.

## License

[MIT](LICENSE) © KrZ-W

Not affiliated with or endorsed by Habitica. "Habitica" is a trademark of its
respective owners.
