# pi-quiet-spinner

## 0.1.1

### Patch Changes

- 3e4ba7e: Move `@earendil-works/pi-tui` from `dependencies` to `peerDependencies` with `*` range to prevent duplicate runtime copies and comply with pi host-provided extension requirements.

## 0.1.0

### Minor Changes

- c4c58de: Add `pi-quiet-spinner`: floors pi-tui spinner frame intervals through the `quiet-spinner` settings block (`preset`: `still`, `quiet`, `calm`, or `default`), with optional `intervalMs` and `frames` overrides.

## 0.0.0

### Patch Changes

- Initial release: floors pi-tui spinner frame intervals through the `quiet-spinner` settings block.
