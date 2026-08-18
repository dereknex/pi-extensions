# pi-herdr-status

A [pi](https://github.com/earendil-works/pi) extension that reports active model and status metadata to [Herdr](https://herdr.dev)'s sidebar agents panel.

Uses Herdr's `pane.report-metadata` socket/CLI API with `--token model_info=<value>` under a dedicated `--source pi-model` namespace to prevent collisions with other plugins (such as `gh-pr`).

## Features

- **Model Synchronization**: Automatically updates Herdr's sidebar status whenever the model changes (on startup, session restore, `/model`, or `Ctrl+P`).
- **Agent State Reporting**: Automatically syncs agent lifecycle states (`working`, `blocked` for waiting user confirmation, `idle`) to Herdr's sidebar.
- **Multi-Pane Aware**: Accurately targets the current pane using `HERDR_PANE_ID`.
- **Collision-Free**: Uses `--source pi-model` and `--token model_info=<value>` to isolate metadata.
- **Graceful Cleanup**: Clears `model_info` token on session shutdown.

## Installation

```bash
pi install npm:pi-herdr-status
```

## Herdr Configuration

Add `model_info` to your `[ui.sidebar.agents.rows_by_agent]` configuration in `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.agents.rows_by_agent]
pi = [
  ["state_icon", "workspace", "tab"],
  ["agent", "model_info"]
]
```

## License

MIT
