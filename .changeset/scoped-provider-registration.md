---
"pi-sub2api-provider": patch
---

Stop overriding providers that Pi already resolves on its own. `registerProvider` outranks both `models.json` and Pi's built-in catalog, so this package now contributes models only — leaving `name`, `api`, `baseUrl`, `apiKey` and `authHeader` to Pi's own layers — whenever the credential is an `auth.json` OAuth entry, `models.json` declares its own `apiKey`/`headers`, or the provider id is one of Pi's built-in providers. The raw OAuth access token is no longer sent as a `Bearer` key. Model discovery is unaffected: a registration that Pi cannot infer `api`/`baseUrl` for escalates to the full form.
