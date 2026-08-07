# Adding a new extension

Each pi extension is a package under `packages/<name>` that is independently versioned, released, and published to npm.

## Steps

### 1. Scaffold the package

Use `packages/pi-sub2api-provider` as the reference layout:

```
packages/<name>/
├── src/index.ts          # extension entry (or multiple files)
├── test/                 # tests (plain Node, no framework required)
├── docs/                 # optional: package-specific docs
├── README.md
├── CHANGELOG.md          # maintained by Changesets
├── LICENSE
├── package.json
└── tsconfig.json         # extends ../../tsconfig.base.json
```

### 2. package.json essentials

```jsonc
{
  "name": "<npm-package-name>",
  "version": "0.0.0",
  "type": "module",
  "private": false,
  "files": ["src", "docs", "README.md", "CHANGELOG.md", "LICENSE", "package.json"],
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "check": "tsc --noEmit",
    "test": "node test/<your-test>.mjs",
    "pack:dry-run": "npm pack --dry-run"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

- The `pi.extensions` entry points to the extension entry file; see the pi docs (`docs/packages.md`) for the package format.
- Keep `check` / `test` / `pack:dry-run` script names so the root workspace commands pick the package up automatically (`npm test`, `npm run check`, `npm run pack:dry-run` run across all packages).

### 3. tsconfig

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

### 4. Verify locally

```bash
npm install
npm test
npm run check
npm run pack:dry-run
```

### 5. Add a changeset and open a PR

```bash
npm run changeset
```

The `Check` workflow runs tests, type-checks, and pack verification on every PR; the `Release` workflow publishes the package to npm when the release PR merges.

## Notes

- **Workspaces**: dependencies of all packages are hoisted to the repo-root `node_modules`; install with `npm install` at the repo root.
- **Versioning**: start at `0.0.0`; the first changeset determines the initial published version.
- **Git installs**: `pi install git:github.com/<owner>/<repo>` works for any package in this repo.
