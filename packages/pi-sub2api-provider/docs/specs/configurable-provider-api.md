# Configurable Provider API

## Task

Allow each Sub2API provider to select the Pi API adapter declared in `~/.pi/agent/models.json` while preserving the current Chat Completions behavior when `api` is absent.

## Output Language

Human-readable Spec and Plan prose is English. File paths, commands, JSON keys, API names, and code identifiers remain literal.

## Summary

The extension currently declares `ProviderConfig.api` but ignores it when calling `pi.registerProvider()`, always registering `openai-completions`. The extension will honor an explicit provider-level `api` value and retain `openai-completions` as the fallback. Documentation will distinguish `openai-responses` HTTP/SSE support from WebSocket transport support.

## Scope

### In scope

- Use `providerVal.api` when registering provider models.
- Keep `openai-completions` as the default when `api` is omitted.
- Document how to opt into `openai-responses`.
- Add a runnable regression check for explicit and omitted `api` values.
- Add a patch Changeset for the user-visible configuration fix.

### Out of scope

- A Sub2API-specific WebSocket adapter.
- Claiming that Pi's generic `openai-responses` adapter uses WebSocket.
- Changing the default API adapter to `openai-responses`.
- Changing Sub2API server, account, reverse-proxy, or `gateway.openai_ws` configuration.
- Per-model API overrides in this extension.

## Research

- `src/index.ts` declares `ProviderConfig.api?: string` but `registerProviderModels()` hard-codes `api: "openai-completions"`.
- Pi supports the custom-provider API names `openai-completions` and `openai-responses`.
- Pi's generic `openai-responses` implementation uses HTTP/SSE. WebSocket transport belongs to the separate Codex-specific implementation and is not safely reusable with ordinary Sub2API API keys.
- The repository has TypeScript checking but no behavioral test command today.

## Design-depth Classification

**Medium risk.** The code change is local, but it changes the provider registration contract and affects request/response protocol selection. A concise Technical Design is therefore required.

## Technical Design

### Components

- `src/index.ts`: resolve the registered API adapter from provider configuration.
- `README.md`: describe the default, the explicit Responses option, and the WebSocket limitation.
- `test/`: exercise registration through the extension's public entry point using temporary `models.json` and `auth.json` files plus a minimal mocked `ExtensionAPI`.
- `package.json`: expose the runnable regression check.
- `.changeset/`: record the patch-level behavior change.

### Decisions

1. `providerVal.api ?? "openai-completions"` is the complete resolution rule.
2. Resolution remains provider-level because that matches the existing `ProviderConfig` shape and the current registration call.
3. No automatic protocol probing is introduced; a successful `/models` response cannot prove equivalent Chat Completions and Responses behavior.
4. No WebSocket setting is added; selecting `openai-responses` only selects Pi's generic HTTP/SSE adapter.
5. The regression check observes the `api` passed to `pi.registerProvider()` rather than asserting source text.

### Invariants

- Existing configurations without `api` register exactly as `openai-completions`.
- An explicit `api` value is forwarded unchanged.
- Authentication, model discovery, quota probing, and model metadata behavior remain unchanged.
- Documentation does not imply generic custom-provider WebSocket support.

### Failure behavior

- An unsupported explicit API name is left for Pi's provider registration/runtime validation to reject; the extension does not maintain a duplicate allowlist.
- If the regression check cannot observe registration, it fails rather than falling back to a source-text assertion.

### Compatibility and rollback

The fallback preserves all existing configurations. Users who add `api: "openai-responses"` intentionally opt into a different request and streaming-event protocol. Rollback is a coherent revert of the source, test/script, documentation, and Changeset from the implementation step; no persisted data migration is involved.

## Acceptance Criteria

1. A provider without `api` is registered with `openai-completions`.
2. A provider with `api: "openai-responses"` is registered with `openai-responses`.
3. The automated check fails if registration becomes hard-coded again.
4. `npm run check` passes.
5. README guidance states that `openai-responses` uses HTTP/SSE in this integration and does not enable WebSocket.
6. Package dry-run succeeds with the intended source, documentation, and Changeset files.

## Test Scenarios

- Register a local configured model with no provider `api`; capture `pi.registerProvider()` and assert `api === "openai-completions"`.
- Register the same shape with `api: "openai-responses"`; assert the configured value is forwarded.
- Run TypeScript validation and npm package dry-run to catch contract and packaging regressions.
