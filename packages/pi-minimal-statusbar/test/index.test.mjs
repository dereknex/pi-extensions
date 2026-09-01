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
		'const truncateToWidth = (text) => text;\nconst visibleWidth = (text) => text.length;',
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

		// In narrow width (forces two rows):
		// Row 0 should have identity/state (path, branch, model, goal)
		// Row 1 should have tail usage/quota and context bar/percent
		const rows = footer.render(30);
		assert.equal(rows.length, 2);
		assert.match(rows[0], /project/);
		assert.match(rows[0], /git:main/);
		assert.match(rows[0], /fix-bug/);
		assert.match(rows[1], /\$1\.50\/\$10/);
		assert.match(rows[1], /42%/);
		assert.match(rows[1], /200K/);
	} finally {
		if (realHome === undefined) delete process.env.HOME;
		else process.env.HOME = realHome;
	}
});