---
"pi-sub2api-provider": minor
---

Support magpie gateways: model auto-load and quota display.

Models: the provider registration carries `refreshModels`, so opening `/model` (or running
`pi update --models`) reloads the live `/v1/models` catalog instead of the frozen list in
`models.json`.

- the remote list is merged with `models.json` — locally configured values win (`api`, `baseUrl`,
  `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `thinkingLevelMap`) and a locally
  configured model the upstream does not list is kept;
- an offline refresh, an unreachable endpoint or a cancelled refresh falls back to the locally
  configured / cached list and reports no error;
- magpie's `modalities.input`, `reasoning_levels` and `pricing` fill `input`, `thinkingLevelMap`
  and `cost`; `context_window` / `max_output_tokens` fill the limits.

Usage: magpie answers `/v1/usage` with `404`, so the probe falls through to
`/v1/magpie/quotas?kept=1` (magpie's cached read, which asks no vendor). The status bar shows the
account the current model belongs to — `codex/gpt-6.1-sol` shows magpie's `codex` card — with the
most-used window first, and `/quota` lists every account behind the gateway with each window's
percentage, reset time and magpie's own `472 / 700 credits` rendering. `/quota` asks for a fresh
read (no `kept`).
