# pi-herdr-status

## 0.1.0

### Minor Changes

- 8d99f19: Initial release: Sync pi model selection to Herdr's sidebar agents panel via isolated `pi-model` source metadata.

  - Report the default model to Herdr on session start (pi startup, reload, resume) via the `session_start` hook, in addition to model switches.
  - Drop the provider prefix from the reported model label (e.g. `claude-3-7-sonnet` instead of `anthropic/claude-3-7-sonnet`).
  - Clean up `model_info` token on session shutdown.

## 0.0.0

Initial package (not yet published).
