---
"pi-herdr-status": patch
---

fix: call `sessionManager.getSessionFile()` as a method to keep `this` binding; detached call threw `Cannot read properties of undefined (reading 'sessionFile')` on every event, breaking status reporting
