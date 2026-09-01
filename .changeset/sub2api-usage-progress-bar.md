---
"pi-sub2api-provider": patch
---

Render usage with compact Braille dot matrix progress bars in status bar and `/quota` command

- Added `renderProgressBar` helper using Braille patterns (`⡀⣀⣤⣶⣿`, 4 vertical levels per cell).
- Status bar displays 5-cell high-density Braille progress bars (e.g. `[⣿⣀⡀⡀⡀]`).
- `/quota` command uses 10-cell Braille progress bars for detailed quota and rate limit views.
