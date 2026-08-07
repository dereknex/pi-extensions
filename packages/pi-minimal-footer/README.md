# pi-minimal-footer

[![npm](https://img.shields.io/npm/v/pi-minimal-footer.svg)](https://www.npmjs.com/package/pi-minimal-footer)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml/badge.svg)](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml)

A minimal pi footer that shows only what matters.

```
Left:  ~/path/to/project git:branch± • provider/model (thinking) • 12.3 t/s • 1.20s ttft • cache:87% • $1.23/$10 • goal
Right: [####.........] 40% (128K)
```

Part of the [pi-extensions](https://github.com/dereknex/pi-extensions) monorepo.

[中文文档](./README_CN.md)

## Features

- Current directory (with `~` for home), git branch with dirty marker.
- Model name, provider, and thinking level colored by effort.
- Real-time tokens/s, time-to-first-token, and cache hit rate (from message usage).
- Quota status from other extensions (e.g. [pi-sub2api-provider](https://www.npmjs.com/package/pi-sub2api-provider)) and arbitrary extension statuses via `ctx.ui.setStatus()`.
- Context usage bar with color gradient (green → yellow → orange → red).
- Layout falls back to two rows when the single row does not fit the terminal width.

## Installation

```bash
pi install npm:pi-minimal-footer
```

Or add it to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:pi-minimal-footer"]
}
```

## Configuration

All options are optional; defaults are shown below. Configure under the `minimal-footer` key of the **global** `~/.pi/agent/settings.json` or a **project** `.pi/agent/settings.json` (project overrides global):

```jsonc
{
  "minimal-footer": {
    "showCwd": true,
    "showGit": true,
    "showModel": true,
    "showThinking": true,
    "showTps": true,
    "showTtft": true,
    "showCacheStats": true,
    "showQuota": true,
    "showGoal": true,
    "showContextBar": true,
    "showContextPercent": true,
    "showContextWindowSize": true,
    "extensionStatuses": true,
    "hiddenExtensionStatuses": ["debug-info"]
  }
}
```

| Key | Default | Description |
| --- | --- | --- |
| `showCwd` | `true` | Show current directory |
| `showGit` | `true` | Show git branch (+ `±` dirty marker) |
| `showModel` | `true` | Show provider/model |
| `showThinking` | `true` | Show thinking level (colored by effort) |
| `showTps` | `true` | Show tokens per second |
| `showTtft` | `true` | Show time to first token |
| `showCacheStats` | `true` | Show cache hit rate |
| `showQuota` | `true` | Show quota status from other extensions |
| `showGoal` | `true` | Show the goal status entry |
| `showContextBar` | `true` | Show context usage bar |
| `showContextPercent` | `true` | Show context usage percentage |
| `showContextWindowSize` | `true` | Show context window size (e.g. `128K`) |
| `extensionStatuses` | `true` | Show other extension statuses: `true` (all), `false` (none), or a `string[]` allowlist |
| `hiddenExtensionStatuses` | `[]` | Hide specific status keys even when `extensionStatuses` is `true` |

## Quota integration

The footer picks the quota status entry matching the active provider (keys like `quota:<provider>`, `<provider>-quota`, ...), falling back to `quota`, `sub2api-quota`, or any `quota|usage|billing|limit` key. This lets several quota extensions coexist while only the active provider's quota is shown.

## Development

From the monorepo root:

```bash
cd /Users/derek/workspaces/pi-extensions
npm install
npm run check
npm run pack:dry-run
```

## License

[MIT](./LICENSE) © dereknex
