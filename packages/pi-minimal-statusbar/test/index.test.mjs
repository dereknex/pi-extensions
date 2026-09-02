import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcTsPath = path.resolve(__dirname, "../src/index.ts");
// Keep the compiled artifact inside the package so bare imports
// (@earendil-works/...) resolve through the monorepo node_modules.
const distDir = path.resolve(__dirname, "../.test-dist");
const compiledJsPath = path.join(distDir, "index.js");

const tsSourceOriginal = fs.readFileSync(srcTsPath, "utf8");
// The compiled artifact must not load runtime packages: importing pi-tui /
// pi-coding-agent on CI's Node 20 throws webidl.util.markAsUncloneable is not
// a function (the internal exists only in newer Node). The tested logic lives
// in pure functions, so stub the two runtime imports out.
const tsSource = tsSourceOriginal
	.replace(
		/import\s*\{[\s\S]*?CONFIG_DIR_NAME[\s\S]*?\}\s*from\s*"@earendil-works\/pi-coding-agent";/,
		'const CONFIG_DIR_NAME = ".pi";',
	)
	.replace(
		'import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";',
		'const truncateToWidth = (text) => text;\nconst visibleWidth = (text) => text.replace(/\\x1b\\[[0-9;]*m/g, "").length;',
	);
const { outputText } = ts.transpileModule(tsSource, {
	compilerOptions: {
		module: ts.ModuleKind.ESNext,
		target: ts.ScriptTarget.ES2022,
	},
});
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(compiledJsPath, outputText, "utf8");

const statusbar = await import(pathToFileURL(compiledJsPath).href);
const {
	default: loadExtension,
	computeCacheHitRate,
	computeWeightedTps,
} = statusbar;

test.after(() => {
	fs.rmSync(distDir, { recursive: true, force: true });
});

test("cache hit rate includes cacheWrite in the denominator (Anthropic style)", () => {
	// input 2k + cacheRead 98k + cacheWrite 4k → 98/104 = 94%
	assert.equal(computeCacheHitRate(2000, 98000, 4000), 94);
});

test("cache hit rate with no cacheWrite matches the plain formula", () => {
	assert.equal(computeCacheHitRate(2000, 98000, 0), 98);
});

test("cache hit rate is null when there are no prompt tokens", () => {
	assert.equal(computeCacheHitRate(0, 0, 0), null);
});

test("cache hit rate tolerates cache-only turns", () => {
	assert.equal(computeCacheHitRate(0, 50000, 0), 100);
});

test("tps is weighted by total generation time, not per-turn average", () => {
	// 1000 tokens over 2s → 500 t/s
	assert.equal(computeWeightedTps(1000, 2000), 500);
	// 5000 tokens over 10s → 500 t/s
	assert.equal(computeWeightedTps(5000, 10000), 500);
	// Mixed: long slow turn + short fast turn stays weighted
	assert.equal(computeWeightedTps(3000, 9000), 333.3333333333333);
});

test("tps is null with no generation time", () => {
	assert.equal(computeWeightedTps(0, 0), null);
	assert.equal(computeWeightedTps(500, 0), null);
});

test("model or provider selection resets performance and cache metrics", async () => {
	const handlers = {};
	let footer;
	const tui = { requestRender() {} };
	const theme = {
		fg(_color, text) {
			return text;
		},
		bold(text) {
			return text;
		},
	};
	const footerData = {
		onBranchChange() {
			return () => {};
		},
		getGitBranch() {
			return undefined;
		},
		getExtensionStatuses() {
			return new Map();
		},
	};
	const pi = {
		cwd: "/tmp/project",
		on(event, handler) {
			handlers[event] = handler;
		},
		getThinkingLevel() {
			return "off";
		},
		exec() {
			return Promise.resolve({ code: 0, stdout: "" });
		},
	};
	const ctx = {
		cwd: "/tmp/project",
		model: {
			id: "model-a",
			provider: "anthropic",
			contextWindow: 200_000,
		},
		sessionManager: {
			getEntries() {
				return [];
			},
		},
		ui: {
			setFooter(factory) {
				footer = factory(tui, theme, footerData);
			},
		},
		getContextUsage() {
			return { percent: 0 };
		},
	};

	loadExtension(pi);
	await handlers.session_start({}, ctx);

	const realDateNow = Date.now;
	const realHome = process.env.HOME;
	process.env.HOME = "/tmp/pi-minimal-statusbar-test-home";
	let now = 1_000;
	Date.now = () => now;
	try {
		handlers.message_start({ message: { role: "assistant" } });
		now = 1_100;
		handlers.message_update({
			message: { role: "assistant" },
			assistantMessageEvent: { type: "text_delta" },
		});
		now = 2_100;
		handlers.message_end({
			message: {
				role: "assistant",
				usage: { input: 10, cacheRead: 90, cacheWrite: 0, output: 100 },
			},
		});

		const beforeSwitch = footer.render(200).join("\n");
		assert.match(beforeSwitch, /100\.0 t\/s/);
		assert.match(beforeSwitch, /0\.10s ttft/);
		assert.match(beforeSwitch, /cache:90%/);

		handlers.model_select({
			model: {
				id: "model-b",
				provider: "openai",
				contextWindow: 128_000,
			},
		});

		const afterSwitch = footer.render(200).join("\n");
		assert.doesNotMatch(afterSwitch, /t\/s|ttft|cache:/);
	} finally {
		Date.now = realDateNow;
		if (realHome === undefined) delete process.env.HOME;
		else process.env.HOME = realHome;
	}
});

test("quota and context are positioned at the tail / right side", async () => {
	const realHome = process.env.HOME;
	process.env.HOME = "/tmp/pi-minimal-statusbar-test-home";
	try {
		const handlers = {};
		let footer;
		const tui = { requestRender() {} };
		const theme = {
			fg(_color, text) {
				return text;
			},
			bold(text) {
				return text;
			},
		};
		const extensionStatuses = new Map([
			["quota:anthropic", "$1.50/$10"],
			["goal", "fix-bug"],
		]);
		const footerData = {
			onBranchChange() {
				return () => {};
			},
			getGitBranch() {
				return "main";
			},
			getExtensionStatuses() {
				return extensionStatuses;
			},
		};
		const pi = {
			cwd: "/tmp/project",
			on(event, handler) {
				handlers[event] = handler;
			},
			getThinkingLevel() {
				return "off";
			},
			exec() {
				return Promise.resolve({ code: 0, stdout: "" });
			},
		};
		const ctx = {
			cwd: "/tmp/project",
			model: {
				id: "claude-3-7-sonnet",
				provider: "anthropic",
				contextWindow: 200_000,
			},
			sessionManager: {
				getEntries() {
					return [];
				},
			},
			ui: {
				setFooter(factory) {
					footer = factory(tui, theme, footerData);
				},
			},
			getContextUsage() {
				return { percent: 42 };
			},
		};

		loadExtension(pi);
		await handlers.session_start({}, ctx);

		// Wide width (200): stays single row with full information
		const wideRows = footer.render(200);
		assert.equal(wideRows.length, 1);
		assert.match(wideRows[0], /project/);
		assert.match(wideRows[0], /git:main/);
		assert.match(wideRows[0], /fix-bug/);
		assert.match(wideRows[0], /\$1\.50\/\$10/);
		assert.match(wideRows[0], /42%/);
		assert.match(wideRows[0], /200K/);

		// Narrow width (30): adapts to stay strictly single row without wrapping
		const narrowRows = footer.render(30);
		assert.equal(narrowRows.length, 1);
		assert.match(narrowRows[0], /project/);
	} finally {
		if (realHome === undefined) delete process.env.HOME;
		else process.env.HOME = realHome;
	}
});

test("adaptive degradation stages progressively fold elements to stay single line", async () => {
	const realHome = process.env.HOME;
	process.env.HOME = "/tmp/pi-minimal-statusbar-test-home";
	try {
		const handlers = {};
		let footer;
		const tui = { requestRender() {} };
		const theme = {
			fg(_color, text) {
				return text;
			},
			bold(text) {
				return text;
			},
		};
		const extensionStatuses = new Map([
			["quota:anthropic", "$1.50/$10"],
			["goal", "fix-bug"],
			["extra-plugin", "syncing"],
		]);
		const footerData = {
			onBranchChange() {
				return () => {};
			},
			getGitBranch() {
				return "feature/my-branch";
			},
			getExtensionStatuses() {
				return extensionStatuses;
			},
		};
		const pi = {
			cwd: "/Users/username/workspace/my-project",
			on(event, handler) {
				handlers[event] = handler;
			},
			getThinkingLevel() {
				return "high";
			},
			exec() {
				return Promise.resolve({ code: 0, stdout: "" });
			},
		};
		const ctx = {
			cwd: "/Users/username/workspace/my-project",
			model: {
				id: "claude-3-7-sonnet",
				provider: "anthropic",
				contextWindow: 200_000,
				reasoning: true,
			},
			sessionManager: {
				getEntries() {
					return [];
				},
			},
			ui: {
				setFooter(factory) {
					footer = factory(tui, theme, footerData);
				},
			},
			getContextUsage() {
				return { percent: 50 };
			},
		};

		loadExtension(pi);
		await handlers.session_start({}, ctx);

		const realDateNow = Date.now;
		let now = 1000;
		Date.now = () => now;
		try {
			handlers.message_start({ message: { role: "assistant" } });
			now = 1100;
			handlers.message_update({
				message: { role: "assistant" },
				assistantMessageEvent: { type: "text_delta" },
			});
			now = 2100;
			handlers.message_end({
				message: {
					role: "assistant",
					usage: { input: 1000, cacheRead: 4000, cacheWrite: 0, output: 500 },
				},
			});

			// 1. Ultra wide (250 chars): full path, ttft, tps, 10-block bar, extra status, thinking level
			const r250 = footer.render(250);
			assert.equal(r250.length, 1);
			const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
			const plain250 = stripAnsi(r250[0]);
			assert.match(plain250, /ttft/);
			assert.match(plain250, /t\/s/);
			assert.match(plain250, /cache:/);
			assert.match(plain250, /syncing/);
			assert.match(plain250, /\[#####\.\.\.\.\.\]/);
			assert.match(plain250, /\(high\)/);

			// 2. Narrower widths: always 1 single row
			for (const w of [120, 80, 50, 25, 10]) {
				const rows = footer.render(w);
				assert.equal(rows.length, 1);
			}
		} finally {
			Date.now = realDateNow;
		}
	} finally {
		if (realHome === undefined) delete process.env.HOME;
		else process.env.HOME = realHome;
	}
});