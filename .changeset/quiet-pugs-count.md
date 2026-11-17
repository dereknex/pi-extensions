---
"pi-minimal-statusbar": patch
---

Fix inflated tokens/s: measure wall time from message start to message end (queueing and first-token latency now count) and drop buffered/non-streaming responses, whose collapsed generation window used to inflate the session average permanently.
