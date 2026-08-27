---
"pi-sub2api-provider": minor
---

Align sub2api usage fetching with CodexBar

- Build canonical `/v1/usage?days=30&timezone` URL (CodexBar `sub2api.js` logic) and extend probe to carry timezone, with 15s timeout.
- Parse full response: `quota`/`subscription`/`balance`/`unit`/`planName`/`remaining`/`isValid` with strict `remaining` checks and authoritative subscription windows (do not derive from `daily_usage`).
- Status bar now shows `subscription` daily/weekly/monthly percentages, `quota` percentage + extra windows, and wallet `balance` before falling back to `rate_limits`; `/quota` shows quota, subscription, balance and key-scoped usage summary.
- Handle `401/403` as auth expired and `429/5xx` as rate-limited/provider-unavailable, and reject `isValid=false`.
- EUR and other non-USD units are formatted with the unit suffix.
