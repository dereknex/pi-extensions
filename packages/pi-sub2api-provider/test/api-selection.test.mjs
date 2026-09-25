import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const testFile = fileURLToPath(import.meta.url);

async function runChild() {
	if (process.env.PI_USAGE_SWITCH_CHILD === "1") {
		globalThis.fetch = async (input) => {
			const url = String(input);
			if (url.startsWith("https://example.test/v1/usage")) {
				return Response.json({
					rate_limits: [
						{ limit: 100, remaining: 75, used: 25, window: "daily" },
					],
				});
			}
			return new Response(null, { status: 404 });
		};
	} else if (process.env.PI_REMOTE_MODELS_UNAVAILABLE === "1") {
		globalThis.fetch = async () => new Response(null, { status: 503 });
	}
	const { default: loadExtension } = await import(
		pathToFileURL(process.env.PI_TEST_EXTENSION).href
	);
	const registrations = [];
	const handlers = {};
	const pi = {
		registerProvider: (_id, config) => registrations.push(config),
		on: (event, handler) => {
			handlers[event] = handler;
		},
		registerCommand: () => undefined,
		unregisterProvider: () => undefined,
	};
	await loadExtension(pi);

	if (process.env.PI_USAGE_SWITCH_CHILD === "1") {
		const statuses = [];
		const ctx = {
			model: { provider: "test", id: "test-model" },
			ui: {
				setStatus: (_key, value) => statuses.push(value),
				theme: { fg: (_color, value) => value },
			},
		};
		handlers.model_select({ model: ctx.model }, ctx);
		const deadline = Date.now() + 1000;
		while (!statuses.at(-1)?.includes("test") && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		if (process.env.PI_TEST_USAGE_STYLE === "numeric") {
			assert.match(statuses.at(-1) ?? "", /test/);
			assert.match(statuses.at(-1) ?? "", /d 25%/);
			console.log("usage-numeric-style-passed");
			return;
		}
		if (process.env.PI_TEST_USAGE_STYLE === "none") {
			assert.equal(statuses.at(-1), undefined);
			console.log("usage-none-style-passed");
			return;
		}
		assert.match(statuses.at(-1) ?? "", /test/);
		assert.match(statuses.at(-1) ?? "", /\[[⡀⣀⣤⣶⣿]{5}\]/);

		ctx.model = { provider: "other", id: "other-model" };
		handlers.model_select({ model: ctx.model }, ctx);
		assert.equal(statuses.at(-1), undefined);
		console.log("usage-cleared-on-model-switch");
		return;
	}

	if (process.env.PI_LIVE_LOGOUT_CHILD === "1") {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		const authPath = path.join(agentDir, "auth.json");
		const modelsCachePath = path.join(agentDir, "models-cache.json");
		fs.writeFileSync(
			authPath,
			JSON.stringify({ other: { type: "api-key", key: "other-key" } }),
		);
		const deadline = Date.now() + 3000;
		while (Date.now() < deadline) {
			const cache = fs.existsSync(modelsCachePath)
				? JSON.parse(fs.readFileSync(modelsCachePath, "utf8"))
				: {};
			if (!("test" in cache) && Array.isArray(cache.other)) {
				assert.deepEqual(cache.other, [{ id: "keep-me" }]);
				console.log("live-logout-cleared");
				return;
			}
			await new Promise((r) => setTimeout(r, 50));
		}
		assert.fail("models cache for logged-out provider was not cleared");
	}

	if (process.env.PI_TEST_PRINT_BASE_URL === "1") {
		console.log(registrations[0]?.baseUrl ?? "");
		return;
	}

	const expectedRegistrations = Number(
		process.env.PI_EXPECTED_REGISTRATIONS ?? "1",
	);
	assert.equal(registrations.length, expectedRegistrations);
	if (registrations[0]) console.log(registrations[0].api);
}

function runScenario(
	compiledExtension,
	{
		api,
		includeModels = true,
		remoteModelsUnavailable = false,
		auth = { test: { type: "api-key", key: "test-key" } },
		modelsCache,
		settings,
		testUsageStyle,
		liveLogout = false,
		usageSwitch = false,
		baseUrl = "https://example.test/v1",
		printBaseUrl = false,
	} = {},
) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sub2api-home-"));
	const agentDir = path.join(home, ".pi", "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(
		path.join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				test: {
					baseUrl,
					...(api ? { api } : {}),
					...(includeModels ? { models: [{ id: "test-model" }] } : {}),
				},
				...(usageSwitch
					? {
							other: {
								baseUrl: "https://other.test/v1",
								models: [{ id: "other-model" }],
							},
						}
					: {}),
			},
		}),
	);
	fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify(auth));
	if (settings !== undefined) {
		fs.writeFileSync(
			path.join(agentDir, "settings.json"),
			JSON.stringify(settings, null, "\t"),
		);
	}
	if (modelsCache !== undefined) {
		fs.writeFileSync(
			path.join(agentDir, "models-cache.json"),
			JSON.stringify(modelsCache, null, "\t"),
		);
	}

	try {
		const result = spawnSync(process.execPath, [testFile], {
			env: {
				...process.env,
				HOME: home,
				PI_API_SELECTION_CHILD: "1",
				PI_TEST_EXTENSION: compiledExtension,
				PI_EXPECTED_REGISTRATIONS: usageSwitch
					? "2"
					: includeModels && auth.test
						? "1"
						: "0",
				PI_REMOTE_MODELS_UNAVAILABLE: remoteModelsUnavailable ? "1" : "0",
				...(printBaseUrl ? { PI_TEST_PRINT_BASE_URL: "1" } : {}),
				...(liveLogout ? { PI_LIVE_LOGOUT_CHILD: "1" } : {}),
				...(usageSwitch ? { PI_USAGE_SWITCH_CHILD: "1" } : {}),
				...(testUsageStyle ? { PI_TEST_USAGE_STYLE: testUsageStyle } : {}),
			},
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const modelsCachePath = path.join(agentDir, "models-cache.json");
		const modelsCacheAfter = fs.existsSync(modelsCachePath)
			? JSON.parse(fs.readFileSync(modelsCachePath, "utf8"))
			: {};
		return {
			stdout: result.stdout.trim(),
			stderr: result.stderr.trim(),
			home,
			modelsCacheAfter,
		};
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
}

if (process.env.PI_API_SELECTION_CHILD === "1") {
	await runChild();
} else {
	const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sub2api-build-"));
	const compiledExtension = path.join(buildDir, "index.mjs");
	try {
		const source = fs.readFileSync(
			new URL("../src/index.ts", import.meta.url),
			"utf8",
		);
		const output = ts.transpileModule(`${source}\nexport { buildRegisteredModels };`, {
			compilerOptions: {
				module: ts.ModuleKind.ES2022,
				target: ts.ScriptTarget.ES2022,
			},
		});
		fs.writeFileSync(compiledExtension, output.outputText);
		assert.equal(runScenario(compiledExtension).stdout, "openai-completions");
		assert.equal(
			runScenario(compiledExtension, { api: "openai-responses" }).stdout,
			"openai-responses",
			);
		assert.equal(
			runScenario(compiledExtension, { api: "anthropic-messages" }).stdout,
			"anthropic-messages",
			);

		// Registration-level base URL contract per API adapter: OpenAI adapters keep the
		// trailing /v1; anthropic-messages must NOT, because the Anthropic SDK appends its
		// own /v1/messages (a trailing /v1 produced <base>/v1/v1/messages → 404).
		const openaiBase = runScenario(compiledExtension, { printBaseUrl: true });
		assert.equal(openaiBase.stdout, "https://example.test/v1");
		const openaiBaseNoV1 = runScenario(compiledExtension, {
			baseUrl: "https://example.test",
			printBaseUrl: true,
		});
		assert.equal(openaiBaseNoV1.stdout, "https://example.test/v1");
		const responsesBase = runScenario(compiledExtension, {
			api: "openai-responses",
			printBaseUrl: true,
		});
		assert.equal(responsesBase.stdout, "https://example.test/v1");
		const anthropicBase = runScenario(compiledExtension, {
			api: "anthropic-messages",
			printBaseUrl: true,
		});
		assert.equal(anthropicBase.stdout, "https://example.test");
		const anthropicBaseNoV1 = runScenario(compiledExtension, {
			api: "anthropic-messages",
			baseUrl: "https://example.test",
			printBaseUrl: true,
		});
		assert.equal(anthropicBaseNoV1.stdout, "https://example.test");
		const unavailableModels = runScenario(compiledExtension, {
			includeModels: false,
			remoteModelsUnavailable: true,
		});
		assert.equal(unavailableModels.stdout, "");
		assert.equal(unavailableModels.stderr, "");
		const afterLogout = runScenario(compiledExtension, {
			auth: { other: { type: "api-key", key: "other-key" } },
			includeModels: true,
			modelsCache: {
				test: [{ id: "cached-model" }],
				other: [{ id: "keep-me" }],
			},
		});
		assert.equal("test" in afterLogout.modelsCacheAfter, false);
		assert.deepEqual(afterLogout.modelsCacheAfter.other, [{ id: "keep-me" }]);
		const liveLogout = runScenario(compiledExtension, {
			auth: {
				test: { type: "api-key", key: "test-key" },
				other: { type: "api-key", key: "other-key" },
			},
			modelsCache: {
				test: [{ id: "cached-model" }],
				other: [{ id: "keep-me" }],
			},
			liveLogout: true,
		});
		assert.equal(liveLogout.stdout, "live-logout-cleared");
		const usageSwitch = runScenario(compiledExtension, {
			auth: {
				test: { type: "api-key", key: "test-key" },
				other: { type: "api-key", key: "other-key" },
			},
			usageSwitch: true,
		});
		assert.equal(usageSwitch.stdout, "usage-cleared-on-model-switch");

		const usageNumeric = runScenario(compiledExtension, {
			auth: {
				test: { type: "api-key", key: "test-key" },
				other: { type: "api-key", key: "other-key" },
			},
			usageSwitch: true,
			settings: { sub2api: { statusBarUsage: "numeric" } },
			testUsageStyle: "numeric",
		});
		assert.equal(usageNumeric.stdout, "usage-numeric-style-passed");

		const usageNone = runScenario(compiledExtension, {
			auth: {
				test: { type: "api-key", key: "test-key" },
				other: { type: "api-key", key: "other-key" },
			},
			usageSwitch: true,
			settings: { sub2api: { statusBarUsage: "none" } },
			testUsageStyle: "none",
		});
		assert.equal(usageNone.stdout, "usage-none-style-passed");

		const {
			renderProgressBar,
			buildRegisteredModels,
			resolveApiBaseUrl,
			formatStatusText,
			normalizeUsageStyle,
			resolveUsageStyle,
		} = await import(pathToFileURL(compiledExtension).href);
		const baseUrlCases = [
			["https://example.test/v1", "anthropic-messages", "https://example.test"],
			["https://example.test/v1/", "anthropic-messages", "https://example.test"],
			["https://example.test", "anthropic-messages", "https://example.test"],
			["https://example.test/step_plan", "anthropic-messages", "https://example.test/step_plan"],
			["https://example.test/step_plan/v1", "anthropic-messages", "https://example.test/step_plan"],
			["https://example.test/v1", "openai-completions", "https://example.test/v1"],
			["https://example.test", "openai-completions", "https://example.test/v1"],
			["https://example.test", "openai-responses", "https://example.test/v1"],
			["https://example.test/v1", undefined, "https://example.test/v1"],
			["https://example.test/step_plan", undefined, "https://example.test/step_plan/v1"],
		];
		for (const [base, api, expected] of baseUrlCases) {
			assert.equal(
				resolveApiBaseUrl(base, api),
				expected,
				`resolveApiBaseUrl(${base}, ${api})`,
			);
		}
		// Anthropic models are registered without a trailing /v1 on every per-model entry.
		const anthropicModels = buildRegisteredModels(
			{ baseUrl: "https://example.test/v1", api: "anthropic-messages", models: [{ id: "a" }, { id: "b" }] },
			"anthropic-messages",
		);
		assert.deepEqual(
			anthropicModels.map((m) => m.baseUrl),
			["https://example.test", "https://example.test"],
		);
		// A per-model baseUrl override is respected verbatim.
		const overridden = buildRegisteredModels(
			{
				baseUrl: "https://example.test/v1",
				api: "anthropic-messages",
				models: [{ id: "a", baseUrl: "https://other.test/v1" }],
			},
			"anthropic-messages",
		);
		assert.equal(overridden[0].baseUrl, "https://other.test/v1");
		const reasoningCases = [
			{ id: "gpt-6-astra", expected: true },
			{ id: "gpt-6-luna", expected: true },
			{ id: "gpt-6-sol", expected: true },
			{ id: "gpt-5.5", expected: true },
			{ id: "gpt-5.6-luna", expected: true },
			{ id: "unknown-model", expected: false },
			{ id: "remote-model", remote: true, expected: true },
			{ id: "gpt-5.6-luna", remote: false, expected: false },
			{ id: "gpt-6-astra", remote: true, local: false, expected: false },
			{ id: "remote-model", remote: false, local: true, expected: true },
			{ id: "unknown-model", remote: "true", expected: false },
			{ id: "gpt-6-astra", remote: "false", expected: true },
		];
		for (const { id, remote, local, expected } of reasoningCases) {
			const [model] = buildRegisteredModels(
				{ models: local === undefined ? [] : [{ id, reasoning: local }] },
				"openai-completions",
				[{ id, reasoning: remote }],
			);
			const label = JSON.stringify({ id, remote, local });
			assert.equal(model.reasoning, expected, label);
			assert.equal(Boolean(model.thinkingLevelMap), expected, label);
		}
		assert.equal(
			buildRegisteredModels({ models: [{ id: "gpt-6-astra" }] }, "openai-completions")[0]
				.reasoning,
			true,
		);
		assert.equal(renderProgressBar(0, 5), "[⡀⡀⡀⡀⡀]");
		assert.equal(renderProgressBar(25, 5), "[⣿⣀⡀⡀⡀]");
		assert.equal(renderProgressBar(50, 5), "[⣿⣿⣤⡀⡀]");
		assert.equal(renderProgressBar(75, 5), "[⣿⣿⣿⣶⡀]");
		assert.equal(renderProgressBar(100, 5), "[⣿⣿⣿⣿⣿]");
		assert.equal(renderProgressBar(25, 10), "[⣿⣿⣤⡀⡀⡀⡀⡀⡀⡀]");
		assert.equal(renderProgressBar(150, 5), "[⣿⣿⣿⣿⣿]");
		assert.equal(renderProgressBar(-10, 5), "[⡀⡀⡀⡀⡀]");

		// normalizeUsageStyle unit checks
		assert.equal(normalizeUsageStyle("numeric"), "numeric");
		assert.equal(normalizeUsageStyle("number"), "numeric");
		assert.equal(normalizeUsageStyle("percent"), "numeric");
		assert.equal(normalizeUsageStyle("progress"), "progress");
		assert.equal(normalizeUsageStyle("bar"), "progress");
		assert.equal(normalizeUsageStyle("progress-bar"), "progress");
		assert.equal(normalizeUsageStyle("none"), "none");
		assert.equal(normalizeUsageStyle("off"), "none");
		assert.equal(normalizeUsageStyle(false), "none");
		assert.equal(normalizeUsageStyle(undefined), "progress");
		assert.equal(normalizeUsageStyle("unknown"), "progress");

		// formatStatusText unit checks: subscription
		const subInfo = {
			subscription: {
				dailyUsage: 25,
				dailyLimit: 100,
				weeklyUsage: 50,
				weeklyLimit: 100,
				monthlyUsage: 0,
				monthlyLimit: null,
			},
			quota: null,
			rateLimits: [],
			balance: null,
			todayCost: 0,
			unit: "USD",
		};
		assert.equal(
			formatStatusText("test", subInfo, "progress"),
			"● test d [⣿⣀⡀⡀⡀] · w [⣿⣿⣤⡀⡀]",
		);
		assert.equal(
			formatStatusText("test", subInfo, "numeric"),
			"● test d 25% · w 50%",
		);

		// formatStatusText unit checks: quota
		const quotaInfo = {
			subscription: null,
			quota: { used: 30, limit: 100 },
			rateLimits: [
				{ window: "5h", used: 10, limit: 100, remaining: 90 },
			],
			balance: null,
			todayCost: 0,
			unit: "USD",
		};
		assert.equal(
			formatStatusText("test", quotaInfo, "progress"),
			"● test quota [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]",
		);
		assert.equal(
			formatStatusText("test", quotaInfo, "numeric"),
			"● test quota 30% · 5h 10%",
		);

		// formatStatusText unit checks: rateLimits only
		const rlInfo = {
			subscription: null,
			quota: null,
			rateLimits: [
				{ window: "daily", used: 75, limit: 100, remaining: 25 },
			],
			balance: null,
			todayCost: 0,
			unit: "USD",
		};
		assert.equal(
			formatStatusText("test", rlInfo, "progress"),
			"● test d [⣿⣿⣿⣶⡀]",
		);
		assert.equal(
			formatStatusText("test", rlInfo, "numeric"),
			"● test d 75%",
		);

		// formatStatusText unit checks: balance & todayCost (no percent)
		const balInfo = {
			subscription: null,
			quota: null,
			rateLimits: [],
			balance: 12.5,
			todayCost: 1.2,
			unit: "USD",
		};
		assert.equal(
			formatStatusText("test", balInfo, "progress"),
			"● test $12.50",
		);
		assert.equal(
			formatStatusText("test", balInfo, "numeric"),
			"● test $12.50",
		);

		console.log("API adapter selection, model probing, reasoning metadata, and usage reset passed");
	} finally {
		fs.rmSync(buildDir, { recursive: true, force: true });
	}
}
