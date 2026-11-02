# pi-sub2api-provider

[![npm](https://img.shields.io/npm/v/pi-sub2api-provider.svg)](https://www.npmjs.com/package/pi-sub2api-provider)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml/badge.svg)](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml)

A standalone pi package that reads OpenAI-compatible / sub2api provider config from `~/.pi/agent/models.json` and `~/.pi/agent/auth.json`, registers providers, and shows quota usage in the pi status bar and via the `/quota` command.

Part of the [pi-extensions](https://github.com/dereknex/pi-extensions) monorepo.

[中文文档](./README_CN.md)

## Features

- Scans providers in `~/.pi/agent/models.json`.
- Reads the matching `key` or `access` from `~/.pi/agent/auth.json`.
- Auto-detects the usage endpoint:
  - `${baseUrl}/usage`
  - `${root}/v1/usage`
  - magpie gateways: `${root}/v1/magpie/quotas?kept=1` (the cached read, so no vendor is asked).
    The status bar shows the account the current model belongs to, most-used window first; `/quota`
    lists every account behind the gateway.
- Fetches and caches rate limit / daily usage.
- Pulls `${baseUrl}/models` and registers `refreshModels`, so `/model` (and `pi update --models`) reloads the live catalog instead of the frozen list in `models.json`.
- Merges the remote list with `models.json`: locally configured values win (`api`, `baseUrl`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `thinkingLevelMap`), and a locally configured model the upstream does not list is kept. When the endpoint is unavailable or pi asks for an offline refresh, the locally configured / cached list is used and no error is reported.
- Reads remote model metadata when present, with conservative built-in fallbacks for endpoints that only return `id` / `display_name`:
  - limits: `context_window` / `context_length` / `max_input_tokens`, `max_output_tokens` / `max_tokens` / `max_completion_tokens`;
  - magpie gateways: `modalities.input` → `input`, `reasoning_levels` → `thinkingLevelMap` (a level the model lacks is hidden), `pricing` (USD per token) → `cost` (USD per million tokens).
- Registers providers via `pi.registerProvider()`.
- Refreshes / displays quota on `session_start`, `model_select`, and `turn_end`.
- Registers a `/quota` command that shows detailed billing and quota for the current provider.

## Installation

### Option 1: From npm (recommended)

```bash
pi install npm:pi-sub2api-provider
```

Or add it to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:pi-sub2api-provider"]
}
```

### Option 2: From git

```bash
pi install git:github.com/dereknex/pi-extensions
```

### Option 3: As a local package

```bash
pi install ./packages/pi-sub2api-provider
```

### Option 4: Load temporarily for testing

```bash
pi -e /Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider
```

### Option 5: Keep using the global extensions directory

If you do not want to switch installation methods yet, copy the entry back to the global extension:

```bash
cp /Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider/src/index.ts ~/.pi/agent/extensions/sub2api-quota.ts
```

## Requirements

You need the following files in place:

- `~/.pi/agent/models.json` with provider connection settings; the per-model `models` array is optional.
- `~/.pi/agent/auth.json`

Example structure:

```jsonc
// ~/.pi/agent/models.json
{
  "providers": {
    "my-sub2api": {
      "baseUrl": "https://example.com/v1",
      "api": "openai-completions"
    }
  }
}
```

```jsonc
// ~/.pi/agent/auth.json
{
  "my-sub2api": {
    "type": "api-key",
    "key": "..."
  }
}
```

> Security note: this repository never stores or copies any API key or auth file.

## API adapter

The provider defaults to `openai-completions`. To opt into Pi's generic OpenAI Responses adapter, set `api` explicitly:

```json
{
  "providers": {
    "my-sub2api": {
      "baseUrl": "https://example.com/v1",
      "api": "openai-responses"
    }
  }
}
```

`openai-responses` uses the HTTP/SSE Responses API in this integration. It does not enable WebSocket transport or `websocket-cached`; a Sub2API WebSocket adapter is not included.

### Anthropic Messages (`anthropic-messages`)

Set `api` to `anthropic-messages` to talk to an upstream that exposes the Anthropic Messages
route. This adapter is supported as long as the upstream actually answers on
`{baseUrl}/v1/messages`; a gateway that only exposes OpenAI-compatible routes still returns 404.

The base URL convention differs per adapter, and this package normalizes it for you:

| `api` | Request path | `baseUrl` in `models.json` |
|---|---|---|
| `openai-completions` / `openai-responses` | `{baseUrl}/v1/chat/completions`, `{baseUrl}/v1/responses` | with or without `/v1` — `/v1` is appended when missing |
| `anthropic-messages` | `{baseUrl}/v1/messages` | with or without `/v1` — a trailing `/v1` is stripped, because the Anthropic SDK adds it |

```json
{
  "providers": {
    "stepfun": {
      "baseUrl": "https://api.stepfun.com/step_plan",
      "api": "anthropic-messages",
      "models": [{ "id": "step-5-preview", "reasoning": true }]
    }
  }
}
```

Without that stripping the request was sent to `https://api.stepfun.com/step_plan/v1/v1/messages`
and the router answered `404`. Both `baseUrl` spellings now register the same, correct endpoint.

A model entry may also carry its own `api` / `baseUrl` override; a `baseUrl` written there is used
verbatim (no `/v1` adjustment).

### magpie gateways

[magpie](https://github.com/yetone/magpie) runs a gateway (by default `http://127.0.0.1:3425`) that
speaks the OpenAI, Responses, Anthropic and Gemini APIs, so pi reaches it like any other provider.
The per-model `models` array is optional — the catalog loads by itself:

```jsonc
// ~/.pi/agent/models.json
{
  "providers": {
    "my-magpie": {
      "api": "openai-responses",
      "baseUrl": "https://magpie.example.com/v1"
    }
  }
}
```

```jsonc
// ~/.pi/agent/auth.json
{
  "my-magpie": { "type": "api_key", "key": "<magpie gateway key>" }
}
```

`baseUrl` may be the gateway root or its `/v1`; both register the same endpoint. The key is the one
magpie shows on its **Gateway** page — on this machine's loopback magpie takes any request, from
another machine it wants the LAN sharing key.

**Models load by themselves.** The gateway's `/v1/models` is pulled whenever pi refreshes its
catalog — opening `/model`, `pi update --models`, `pi --list-models` — and the window, reply cap,
input modalities, thinking levels and price come from that response. Anything you write in
`models.json` still wins (`api`, `baseUrl`, `reasoning`, `input`, `cost`, `contextWindow`,
`maxTokens`, `thinkingLevelMap`), and a model you configured that magpie does not list is kept.

**Quota comes from magpie.** `/v1/usage` answers `404`, so the probe falls through to
`/v1/magpie/quotas?kept=1` — magpie's cached read, which asks no vendor:

- the status bar shows the account the current model belongs to (`codex/gpt-6.1-sol` → magpie's
  `codex` card), its most-used window first, at most three:

  ```text
  ● my-magpie codex w [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]
  ● my-magpie example Credits [⣿⣿⣿⣿⣿] · w [⡀⡀⡀⡀⡀] · 4h [⡀⡀⡀⡀⡀]
  ```

  and with `"statusBarUsage": "numeric"`:

  ```text
  ● my-magpie codex w 31% · 5h 10%
  ```

- `/quota` asks magpie for a fresh read and lists every account behind the gateway, each window with
  its percentage, reset time and magpie's own `0 / 500` / `1500 / 1600` rendering:

  ```text
  Provider:     my-magpie
  Source:       magpie (https://magpie.example.com/v1/magpie/quotas)
  Accounts:     2

  Codex (codex) · subscription · plus · you@example.com
    5 hours          0%  [⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀]  resets 03/11/2026, 3:16:15 am
    7 days          31%  [⣿⣿⣿⡀⡀⡀⡀⡀⡀⡀]  resets 09/11/2026, 11:11:16 am
  Example AI (example) · subscription · Free plan · you@example.com
    Credits          0%  [⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀]  0 / 500  resets 30/11/2026, 11:59:59 pm
    Extra credits   94%  [⣿⣿⣿⣿⣿⣿⣿⣿⣿⣤]  1500 / 1600
  ```

Not shown: magpie's reset counts (`resets`), why an account was passed over (`holdsWhy`), and its
token/cost summary (`/v1/magpie/usage`).

> magpie's own **Agents → Pi** connection writes a provider named `magpie` into
> `~/.pi/agent/models.json` with its key inline. This package only manages providers whose credential
> is in `auth.json`, so it leaves that one alone: pi works, but no quota is shown. Add the gateway as
> your own provider with the key in `auth.json` (above) to get both.

If no quota appears, run pi with `SUB2API_QUOTA_DEBUG=1` to see which endpoint was probed and why it
was rejected.

### What this package overrides

`registerProvider` outranks both `models.json` and Pi's built-in catalog, so this package only takes
over a provider when Pi cannot resolve it on its own:

| Provider | Registration | Why |
|---|---|---|
| Custom id, `api-key` credential in `auth.json` | Full (`name`, `api`, `baseUrl`, `apiKey`, `authHeader`, `models`) | Pi reports `credentials_not_configured` for a custom id whose only credential lives in `auth.json` |
| `oauth` credential in `auth.json` | Models only | Pi owns the OAuth refresh and native stream; the raw access token is never sent as a Bearer key |
| `models.json` declares its own `apiKey` / `headers` | Models only | Pi resolves those natively |
| Built-in provider id (`anthropic`, `openai`, `xai`, …) | Models only | Pi owns the catalog definition: `api`, `baseUrl`, auth and model list |

In “models only” mode `name`, `api`, `baseUrl`, `apiKey` and `authHeader` are all omitted so they fall
back to Pi's own layers. Model discovery still happens: if Pi cannot infer `api` / `baseUrl` for the
models (it raises that error before touching any stored config), the registration escalates to the
full form.

Run `pi auth check --provider <id> --json` to see which form applies in practice.

## Settings

Configure the status bar usage display style in global `~/.pi/agent/settings.json` or project `.pi/settings.json`:

```json
{
  "sub2api": {
    "statusBarUsage": "progress"
  }
}
```

Supported options for `statusBarUsage` (or `usageDisplay`):

| Value | Description | Example |
|---|---|---|
| `"progress"` / `"bar"` | Progress bar (default) | `● my-sub2api d [⣿⣀⡀⡀⡀] · w [⣤⡀⡀⡀⡀]` |
| `"numeric"` / `"percent"` | Percentage numbers | `● my-sub2api d 25% · w 50%` |
| `"none"` / `false` | Hide usage from status bar | *(cleared)* |

You can also override this with the `SUB2API_STATUS_BAR_USAGE` environment variable.

## Development

From the monorepo root (installs all packages and runs checks for all of them):

```bash
cd /Users/derek/workspaces/pi-extensions
npm install
npm test
npm run check
npm run pack:dry-run
```

Or scoped to this package only:

```bash
npm test -w pi-sub2api-provider
npm run check -w pi-sub2api-provider
```

## Release

This package is versioned and released through the pi-extensions monorepo. Every user-facing change needs a changeset:

```bash
cd /Users/derek/workspaces/pi-extensions
npm run changeset
```

Merging the release PR publishes this package to npm automatically.

See [`docs/RELEASE.md`](./docs/RELEASE.md) for details.

## Usage

Inside pi:

```text
/model
/quota
```

The status bar will show something like:

- Progress bar (default):
  ```text
  ● my-sub2api d [⣿⣀⡀⡀⡀] · w [⣤⡀⡀⡀⡀]
  ```
- Numeric mode (`"statusBarUsage": "numeric"`):
  ```text
  ● my-sub2api d 25% · w 50%
  ```
- A magpie gateway (see [magpie gateways](#magpie-gateways)):
  ```text
  ● my-magpie codex w [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]
  ```

`/quota` prints the full detail for the active provider to the console (accounts, plans, every
window, reset times, today/total usage where the provider reports it).

## License

[MIT](./LICENSE) © dereknex
