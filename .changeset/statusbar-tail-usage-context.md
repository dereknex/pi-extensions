---
"pi-minimal-statusbar": patch
---

Align telemetry, quota, and context usage at the status bar tail / right side

- Relocated TPS, TTFT, cache hit rate, and quota indicators to the right-aligned section preceding context usage.
- Added `hideZeroCache` setting to optionally hide cache stats when cache rate is 0%.
- Updated status bar layout documentation and unit tests.
