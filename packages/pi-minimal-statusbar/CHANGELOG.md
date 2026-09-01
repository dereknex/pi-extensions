# pi-minimal-statusbar

## 0.1.4

### Patch Changes

- 3aeecb2: Align telemetry, quota, and context usage at the status bar tail / right side

  - Relocated TPS, TTFT, cache hit rate, and quota indicators to the right-aligned section preceding context usage.
  - Added `hideZeroCache` setting to optionally hide cache stats when cache rate is 0%.
  - Updated status bar layout documentation and unit tests.

## 0.1.3

### Patch Changes

- eec2b66: Reset cache, TPS, and TTFT metrics when the active model or provider changes.

## 0.1.2

### Patch Changes

- 3b49acd: Fix cache and TPS semantics:
  - Cache hit rate is now session-cumulative (seeded from session entries on
    start/resume, extended per message) and matches `/session` — the denominator
    includes `cacheWrite`.
  - TPS is now run-weighted generation throughput: total output tokens over
    generation time only (first token delta → message_end), excluding tool
    execution time, instead of a per-turn snapshot that included tool time.
  - TTFT is measured from the first real content delta instead of the bare
    stream `start` event.

## 0.1.1

### Patch Changes

- b96631e: Verify the OIDC (Trusted Publisher) release pipeline end to end.

## 0.1.0

### Minor Changes

- 0f6ddca: Initial release: minimal pi footer with cwd, git branch, model + thinking level, tps/ttft/cache stats, quota, goal, and context usage bar.

## 0.0.0

Initial package (not yet published).
