// Acceptance A3: published package contract and documentation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, "..");
const repoRoot = path.resolve(packageDir, "../..");

const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
const readme = fs.readFileSync(path.join(packageDir, "README.md"), "utf8");
const rootReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

// --- manifest ------------------------------------------------------------------
assert.equal(manifest.name, "pi-quiet-spinner");
assert.deepEqual(manifest.pi?.extensions, ["./src/index.ts"], "the package declares its extension entry");
assert.equal(manifest.engines?.node, ">=20", "the package keeps the workspace Node floor");
assert.equal(manifest.publishConfig?.access, "public");
assert.ok(manifest.files?.includes("src"), "the published file list ships src");
assert.ok(manifest.files?.includes("README.md") && manifest.files?.includes("LICENSE"));
assert.equal(manifest.scripts?.check, "tsc --noEmit");
assert.ok(manifest.scripts?.test, "the package declares a test script");
assert.equal(manifest.scripts?.["pack:dry-run"], "npm pack --dry-run");
assert.ok(manifest.dependencies?.["@earendil-works/pi-tui"], "the patched runtime is a dependency");
assert.ok(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"]);

// --- documentation -------------------------------------------------------------
for (const fragment of [
	"`quiet-spinner`",
	"~/.pi/agent/settings.json",
	".pi/settings.json",
	"`preset`",
	"`intervalMs`",
	"`frames`",
	"`still`",
	"`quiet`",
	"`calm`",
	"`default`",
]) {
	assert.ok(readme.includes(fragment), `the README documents ${fragment}`);
}
assert.ok(
	!readme.includes("PI_QUIET_SPINNER"),
	"the README no longer documents environment variables",
);
assert.ok(readme.includes("every `Loader` in the process"), "the README states the process-wide effect");
assert.ok(readme.includes("9549"), "the README records the upstream exit plan");
assert.ok(readme.includes("EXIT PLAN"), "the exit plan is a named section");

// --- workspace wiring ----------------------------------------------------------
assert.ok(
	rootReadme.includes("./packages/pi-quiet-spinner"),
	"the root README lists the package in the workspace table",
);

const changesets = fs
	.readdirSync(path.join(repoRoot, ".changeset"))
	.filter((name) => name.endsWith(".md"))
	.map((name) => fs.readFileSync(path.join(repoRoot, ".changeset", name), "utf8"));
// Before the first release a pending changeset is the record; afterwards
// `changeset version` consumes it and the CHANGELOG entry is the record.
const changelog = fs.readFileSync(path.join(packageDir, "CHANGELOG.md"), "utf8");
const released = manifest.version !== "0.0.0" && changelog.includes(`## ${manifest.version}`);
assert.ok(
	changesets.some((text) => text.includes('"pi-quiet-spinner"')) || released,
	"a pending changeset or a released CHANGELOG entry records the package",
);

console.log("package.test.mjs: ok");
