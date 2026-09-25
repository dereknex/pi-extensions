---
"pi-sub2api-provider": patch
---

Register providers with an API-appropriate base URL so `api: "anthropic-messages"` no longer returns 404. Pi's Anthropic Messages adapter resolves `{baseUrl}/v1/messages` itself, so a trailing `/v1` (previously always appended for the OpenAI adapters) produced `/v1/v1/messages`. The trailing `/v1` is now stripped for adapters that add their own prefix, and model entries may override `api` / `baseUrl` per model.
