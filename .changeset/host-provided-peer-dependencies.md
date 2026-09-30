---
"pi-minimal-statusbar": patch
"pi-quiet-spinner": patch
---

Move `@earendil-works/pi-tui` from `dependencies` to `peerDependencies` with `*` range to prevent duplicate runtime copies and comply with pi host-provided extension requirements.
