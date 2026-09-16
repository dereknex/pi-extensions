// Shared loader for the acceptance scripts.
//
// Each test transpiles src/index.ts in memory with its pi-tui runtime import
// replaced by a stub, so the package logic runs under plain Node (including CI's
// Node 20) and under `bun run` (the managed QA runner) without importing the TUI
// runtime, which is not loadable in that environment.
//
// The stub mirrors node_modules/@earendil-works/pi-tui/dist/components/loader.js:
// same field defaults, same `setIndicator` -> `start` -> `restartAnimation` flow,
// and the same early return when a loader has at most one frame.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(here, "../src/index.ts");
const distDir = path.resolve(here, "../.test-dist");

// Remove the transpiled copy even when an assertion throws.
process.on("exit", () => {
	try {
		fs.rmSync(distDir, { recursive: true, force: true });
	} catch {
		// Best effort: a leftover .test-dist directory is untracked and regenerated.
	}
});

const PI_TUI_IMPORT = /import\s*\{\s*Loader\s*\}\s*from\s*"@earendil-works\/pi-tui";/;
const UNSTUBBED_RUNTIME_IMPORT = /^import\s+(?!type\b)[^;\n]*from\s+"@earendil-works\//m;

const LOADER_STUB = `const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
class Loader {
	frames = [...DEFAULT_FRAMES];
	intervalMs = 80;
	currentFrame = 0;
	intervalId = null;
	renderIndicatorVerbatim = false;
	setIndicator(indicator) {
		this.renderIndicatorVerbatim = indicator !== undefined;
		this.frames = indicator?.frames !== undefined ? [...indicator.frames] : [...DEFAULT_FRAMES];
		this.intervalMs = indicator?.intervalMs && indicator.intervalMs > 0 ? indicator.intervalMs : 80;
		this.currentFrame = 0;
		this.start();
	}
	start() {
		this.restartAnimation();
	}
	stop() {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}
	restartAnimation() {
		this.stop();
		if (this.frames.length <= 1) return;
		const id = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
		}, this.intervalMs);
		if (id !== null && typeof id === "object" && typeof id.unref === "function") id.unref();
		this.intervalId = id;
	}
}
export { Loader as __stubLoader };`;

/** Transpile `src/index.ts` with the runtime import stubbed and import the result. */
export async function loadSource() {
	let source = fs.readFileSync(srcPath, "utf8");
	if (!PI_TUI_IMPORT.test(source)) {
		throw new Error(
			`_load-src: ${srcPath} no longer imports { Loader } from "@earendil-works/pi-tui"; update the stub`,
		);
	}
	source = source.replace(PI_TUI_IMPORT, LOADER_STUB);
	if (UNSTUBBED_RUNTIME_IMPORT.test(source)) {
		throw new Error(`_load-src: ${srcPath} has an unstubbed runtime import from @earendil-works/*`);
	}

	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
	});
	fs.mkdirSync(distDir, { recursive: true });
	const outPath = path.join(distDir, `${path.basename(process.argv[1] ?? "test", ".mjs")}.js`);
	fs.writeFileSync(outPath, outputText, "utf8");

	const loaded = await import(pathToFileURL(outPath).href);
	return { module: loaded, Loader: loaded.__stubLoader };
}

/** Assert that `fn` throws an `Error` whose message names `fragment`. */
export function assertThrowsNaming(fn, fragment) {
	let thrown;
	try {
		fn();
	} catch (error) {
		thrown = error;
	}
	if (thrown === undefined) throw new Error(`expected a throw naming ${JSON.stringify(fragment)}`);
	if (!(thrown instanceof Error)) throw new Error(`expected an Error but got ${String(thrown)}`);
	if (!thrown.message.includes(fragment)) {
		throw new Error(
			`expected the message to name ${JSON.stringify(fragment)} but it was: ${thrown.message}`,
		);
	}
}
