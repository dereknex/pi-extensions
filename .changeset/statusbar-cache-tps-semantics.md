---
"pi-minimal-statusbar": patch
---

Fix cache and TPS semantics:
- Cache hit rate is now session-cumulative (seeded from session entries on
  start/resume, extended per message) and matches `/session` — the denominator
  includes `cacheWrite`.
- TPS is now run-weighted generation throughput: total output tokens over
  generation time only (first token delta → message_end), excluding tool
  execution time, instead of a per-turn snapshot that included tool time.
- TTFT is measured from the first real content delta instead of the bare
  stream `start` event.