# pi-herdr-status

## 0.1.2

### Patch Changes

- afc1462: fix: call `sessionManager.getSessionFile()` as a method to keep `this` binding; detached call threw `Cannot read properties of undefined (reading 'sessionFile')` on every event, breaking status reporting
- 568d06b: Fix model_info loss and stale model display in Herdr sidebar metadata:

  - Serialize herdr CLI invocations (FIFO) so a `--clear-token` can no longer race a newer `report-metadata` and delete `model_info` after session switches or reloads.
  - Only clear `model_info` on real quit; session switches (new/resume/fork/reload) are immediately followed by a fresh report.
  - Properly filter in-memory subagent sessions (no session file) in addition to parentSession headers, so a subagent's model no longer overwrites the main session's model in the sidebar.

## 0.1.1

### Patch Changes

- 901491b: Filter out model and thinking level updates triggered by subagents, preserving the main session's selected model in Herdr sidebar metadata.

## 0.1.0

### Minor Changes

- 8d99f19: Initial release: Sync pi model selection to Herdr's sidebar agents panel via isolated `pi-model` source metadata.

  - Report the default model to Herdr on session start (pi startup, reload, resume) via the `session_start` hook, in addition to model switches.
  - Drop the provider prefix from the reported model label (e.g. `claude-3-7-sonnet` instead of `anthropic/claude-3-7-sonnet`).
  - Clean up `model_info` token on session shutdown.

## 0.0.0

Initial package (not yet published).
