---
"pi-sub2api-provider": minor
---

Add status bar usage display options supporting progress bar and numeric percentage styles

- Added `statusBarUsage` (aliases: `usageDisplay`, `usageStyle`) setting under the `sub2api` or `sub2api-provider` configuration block in `settings.json`.
- Supports `"progress"` (or `"bar"`, default) for Braille progress bars, `"numeric"` (or `"percent"`) for percentage numbers, and `"none"` (or `false`) to hide usage from the status bar.
- Supports overriding via the `SUB2API_STATUS_BAR_USAGE` environment variable.
