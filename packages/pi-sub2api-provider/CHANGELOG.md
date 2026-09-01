# Changelog

## 0.6.1

### Patch Changes

- 3aeecb2: Render usage with compact Braille dot matrix progress bars in status bar and `/quota` command

  - Added `renderProgressBar` helper using Braille patterns (`⡀⣀⣤⣶⣿`, 4 vertical levels per cell).
  - Status bar displays 5-cell high-density Braille progress bars (e.g. `[⣿⣀⡀⡀⡀]`).
  - `/quota` command uses 10-cell Braille progress bars for detailed quota and rate limit views.

## 0.6.0

### Minor Changes

- d0bf15b: Align sub2api usage fetching with CodexBar

  - Build canonical `/v1/usage?days=30&timezone` URL (CodexBar `sub2api.js` logic) and extend probe to carry timezone, with 15s timeout.
  - Parse full response: `quota`/`subscription`/`balance`/`unit`/`planName`/`remaining`/`isValid` with strict `remaining` checks and authoritative subscription windows (do not derive from `daily_usage`).
  - Status bar now shows `subscription` daily/weekly/monthly percentages, `quota` percentage + extra windows, and wallet `balance` before falling back to `rate_limits`; `/quota` shows quota, subscription, balance and key-scoped usage summary.
  - Handle `401/403` as auth expired and `429/5xx` as rate-limited/provider-unavailable, and reject `isValid=false`.
  - EUR and other non-USD units are formatted with the unit suffix.

## 0.5.2

### Patch Changes

- 5039775: Clear stale quota usage when switching models and only show the selected provider after its usage refresh completes.

## 0.5.1

### Patch Changes

- e22ca3d: prune cached models on auth credential removal

## 0.5.0

### Minor Changes

- 5db37af: Add local model cache

## 0.4.0

### Minor Changes

- 44f88d1: Support for specified API types

### Patch Changes

- fdf4e52: Ignore the model detection failure information
- 44f88d1: Honor the provider-level `api` setting from `models.json`, while keeping `openai-completions` as the default.
- ac4efe6: Ignore the model detection failure information

## 0.2.1

### Patch Changes

- ff57dd4: change context window to 272K

## 0.2.0

### Minor Changes

- 9fe1aad: support gpt 5.6 series

### Patch Changes

- 69c01fd: Fix quota update timeout crashing the pi agent.

  The sub2api usage endpoint could intermittently time out, surfacing as
  `DOMException [TimeoutError]: The operation was aborted due to timeout`
  followed by undici's `Aborted after 1 retry attempt`, which escaped as an
  unhandled promise rejection and crashed the pi session.

  - Add a `fetchWithRetry` wrapper with exponential backoff (up to 2 retries)
    that swallows the final network error and returns `null`, so a flaky
    endpoint never propagates to the extension top level.
  - Route `probeUsageEndpoint`, `updateQuota`, and `fetchModels` through it.
  - Wrap per-provider startup initialization in try/catch so one bad provider
    no longer blocks the others or aborts extension load.
  - Add `.catch()` to the fire-and-forget `updateQuota` calls in `model_select`
    and `turn_end`, and guard the subsequent `quotaProviders.get` against a
    concurrent clear, eliminating the unhandled rejection path entirely.

- fb26b3a: Change to lazy loading to improve Pi boot speed

## 0.1.1

### Patch Changes

- e9b438a: Fix the incorrect context parameter configuration

## 0.1.0

### Minor Changes

- 7bd1d97: 完善为可发布的 pi package：补齐 npm 发布元信息、MIT LICENSE、GitHub Actions（check + changesets release）与发布文档。

本文件由 [Changesets](https://github.com/changesets/changesets) 在发布 PR 中自动更新。

首次发布前，版本说明记录在 `.changeset/initial-release.md`；合并 Changesets 生成的 release PR 后，这里会生成正式的版本条目。
