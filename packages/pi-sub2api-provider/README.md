# pi-sub2api-provider

[![npm](https://img.shields.io/npm/v/pi-sub2api-provider.svg)](https://www.npmjs.com/package/pi-sub2api-provider)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/dereknex/pi-sub2api-provider/actions/workflows/check.yml/badge.svg)](https://github.com/dereknex/pi-sub2api-provider/actions/workflows/check.yml)

A standalone pi package that reads OpenAI-compatible / sub2api provider config from `~/.pi/agent/models.json` and `~/.pi/agent/auth.json`, registers providers, and shows quota usage in the pi status bar and via the `/quota` command.

[中文文档](./README_CN.md)

## Features

- Scans providers in `~/.pi/agent/models.json`.
- Reads the matching `key` or `access` from `~/.pi/agent/auth.json`.
- Auto-detects the usage endpoint:
  - `${baseUrl}/usage`
  - `${root}/v1/usage`
- Fetches and caches rate limit / daily usage.
- Pulls `${baseUrl}/models` and prefers the remote model list, falling back to locally configured models only when the remote endpoint is unavailable.
- Reads remote model limit metadata when present (`context_window`, `max_tokens`, and common aliases), with conservative built-in fallbacks for endpoints that only return `id` / `display_name`.
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
pi install git:github.com/dereknex/pi-sub2api-provider
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

## Development

```bash
cd /Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider
npm ci
npm test
npm run check
npm run pack:dry-run
```

## Release

This project uses Changesets to manage versioning and npm publishing. For the first release, `package.json` stays at `0.0.0`; the `0.1.0` release PR is generated from `.changeset/initial-release.md`.

See [`docs/RELEASE.md`](./docs/RELEASE.md) for details.

## Usage

Inside pi:

```text
/model
/quota
```

The status bar will show something like:

```text
● my-sub2api: 5h $1.23/$10 • daily $4.56/$50 • weekly $12.34/$200
```

## License

[MIT](./LICENSE) © dereknex
