---
"pi-herdr-status": patch
---

Fix model_info loss and stale model display in Herdr sidebar metadata:

- Serialize herdr CLI invocations (FIFO) so a `--clear-token` can no longer race a newer `report-metadata` and delete `model_info` after session switches or reloads.
- Only clear `model_info` on real quit; session switches (new/resume/fork/reload) are immediately followed by a fresh report.
- Properly filter in-memory subagent sessions (no session file) in addition to parentSession headers, so a subagent's model no longer overwrites the main session's model in the sidebar.
