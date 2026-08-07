# Configurable Provider API Plan

- Summary: Provider registration honors an explicit API adapter while preserving the existing default.

## Task

- Spec: docs/specs/configurable-provider-api.md
- Origin: Confirmed conversation scope after Sub2API and Pi transport analysis
- Output language: English prose with literal code identifiers and commands preserved

## Origin

The user confirmed the following direction: keep `openai-completions` as the default, allow an explicit provider-level `openai-responses` selection, and do not implement a WebSocket adapter in this slice.

## Research

- `ProviderConfig.api` already exists in `src/index.ts`.
- `registerProviderModels()` currently ignores it and hard-codes `openai-completions`.
- Pi's generic `openai-responses` adapter uses HTTP/SSE rather than WebSocket.
- The repository currently provides `npm run check` and `npm run pack:dry-run` but no behavioral regression command.

## Decisions

- Resolve the registration API with `providerVal.api ?? "openai-completions"`.
- Verify registration behavior through the extension entry point using temporary user configuration and a mocked Pi API.
- Document `openai-responses` as an explicit HTTP/SSE option.
- Keep WebSocket support outside this Plan.

## Assumptions

- Pi continues to accept provider API adapter names as strings through `pi.registerProvider()`.
- Sub2API installations that opt into `openai-responses` expose a compatible `/v1/responses` route.
- Existing users without `api` expect the current Chat Completions behavior.

## Output Language

The Spec and Plan use English human-readable prose. File paths, shell commands, JSON keys, API names, and TypeScript identifiers remain literal.

## Devil's Advocate Audit

### Rollback resilience

The implementation is one atomic compatibility slice with no persisted-state migration. If execution stops midway, existing runtime behavior remains unchanged until `src/index.ts` changes; unfinished test or documentation files can be completed on the next run. Rollback reverts the source, regression check, README guidance, package script, and Changeset together.

### Verification vanity

The behavioral check must capture the actual `api` field passed to `pi.registerProvider()` for both omitted and explicit configuration. It must not merely grep for `providerVal.api`, so restoring the hard-coded value causes a real failure. `npm run check` and `npm run pack:dry-run` cover compilation and package contents but do not replace the behavioral assertion.

### Spec dilution detection

The confirmed default behavior, explicit `openai-responses` option, HTTP/SSE limitation, and WebSocket non-goal are all represented in the Spec acceptance criteria and the single implementation Step. No requirement is deferred because of implementation cost.

## Steps

### Step 1

- Step ID: U1
- Result: Provider registration honors configured API with backward-compatible defaults
- Verification: `npm test && npm run check && npm run pack:dry-run`
- Test scenarios: omitted api registers openai-completions; explicit openai-responses is forwarded; README identifies HTTP/SSE behavior; package dry-run includes intended release files
- Discovery cache: src/index.ts (provider registration contract); README.md (user configuration contract); package.json (runnable verification commands); .changeset/ (release note convention)
- Depends on: none

Implementation boundary:

- Update `registerProviderModels()` in `src/index.ts` to resolve the API from `state.providerVal.api` with the current default.
- Add the smallest runnable regression check and wire `npm test` to it without adding dependencies.
- Update `README.md` with an explicit `api` example and the HTTP/SSE versus WebSocket boundary.
- Add one patch Changeset describing the configuration fix.

Failure behavior:

- A failing behavioral check blocks closure.
- Unsupported explicit adapter names remain Pi validation/runtime errors rather than introducing a second extension-owned allowlist.

Security considerations:

- Tests must use temporary fake auth and must not read or print the user's real API key.

## Verification Approach

The primary signal is the executable registration assertion. TypeScript checking detects contract drift. The package dry-run confirms that the publishable artifact includes the implementation and documentation expected by the release.
