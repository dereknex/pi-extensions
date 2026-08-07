# pi-extensions

Pi coding agent extensions monorepo — a collection of [pi](https://github.com/earendil-works/pi) extensions and packages, managed with npm workspaces and [Changesets](https://github.com/changesets/changesets).

## Packages

| Package | npm | Description |
| --- | --- | --- |
| [pi-sub2api-provider](./packages/pi-sub2api-provider) | [`pi-sub2api-provider`](https://www.npmjs.com/package/pi-sub2api-provider) | Auto-registers sub2api/OpenAI-compatible providers and displays quota usage. |

Each package lives in `packages/<name>` and is independently versioned and published to npm.

## Development

Requirements: Node.js >= 20, npm.

```bash
npm install        # install all workspace dependencies
npm test           # run tests for all packages
npm run check      # type-check all packages
npm run pack:dry-run  # verify published file lists
```

### Adding a new extension

See [packages/README.md](./packages/README.md) for the step-by-step guide.

## Releasing

This repo uses Changesets. Every user-facing change needs a changeset:

```bash
npm run changeset
```

- `main` is the release branch.
- The `Release` GitHub Actions workflow creates/updates a release PR after merges.
- Merging the release PR publishes all bumped packages to npm (trusted publishing, OIDC).

Details: [docs/RELEASE.md](https://github.com/dereknex/pi-extensions/blob/main/packages/pi-sub2api-provider/docs/RELEASE.md)

## License

MIT — see each package's `LICENSE`.
