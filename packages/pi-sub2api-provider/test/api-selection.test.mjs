import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const testFile = fileURLToPath(import.meta.url);

// A trimmed magpie `/v1/models` reply: the metadata magpie publishes that pi's model
// definition can carry (window, reply cap, input modalities, thinking levels, prices).
const MAGPIE_MODELS = [
	{
		id: "codex/gpt-6.1-sol",
		display_name: "GPT-6.1-Sol",
		context_window: 500000,
		max_output_tokens: 128000,
		modalities: { input: ["text", "image"] },
		reasoning: true,
		reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"],
		pricing: {
			prompt: "0.000002",
			completion: "0.00001",
			input_cache_read: "0.0000001",
			input_cache_write: "0.0000025",
		},
		native_endpoints: ["/v1/responses"],
	},
	{
		id: "auto/deepseek-v4.1-flash",
		display_name: "DeepSeek-V4.1-Flash",
		context_window: 1048576,
		max_output_tokens: 384000,
		modalities: { input: ["text", "image"] },
		reasoning: true,
		reasoning_levels: ["low", "high", "max"],
	},
];

// A magpie `/v1/magpie/quotas` reply: one card per upstream account, `used` already a percentage.
const MAGPIE_QUOTAS = {
	object: "list",
	data: [
		{
			provider: "codex",
			name: "Codex",
			kind: "subscription",
			plan: "plus",
			user: "me@example.test",
			windows: [
				{ name: "5 hours", used: 10, remaining: 90, resetsAt: "2026-11-02T19:05:13Z" },
				{ name: "7 days", used: 31, remaining: 69, resetsAt: "2026-11-09T03:11:16Z" },
			],
		},
		{
			provider: "minimax-code",
			name: "MiniMax Code",
			kind: "subscription",
			plan: "M Plan Starter",
			windows: [
				{ name: "Credits", used: 100, remaining: 0, display: "2000 / 2000" },
				{ name: "7 days", used: 1, remaining: 99 },
			],
		},
	],
};

async function runChild() {
	let fetchCalls = 0;
	const fetchedUrls = [];
	if (process.env.PI_MAGPIE_QUOTA_CHILD === "1") {
		// A magpie gateway: no sub2api usage endpoint, quotas under /v1/magpie/quotas
		globalThis.fetch = async (input) => {
			const url = String(input);
			fetchedUrls.push(url);
			if (url.includes("/magpie/quotas")) return Response.json(MAGPIE_QUOTAS);
			return Response.json({ error: { message: "not found" } }, { status: 404 });
		};
	} else if (process.env.PI_MAGPIE_MODELS_CHILD === "1") {
		globalThis.fetch = async (input) => {
			fetchCalls++;
			const url = String(input);
			if (url.endsWith("/models")) {
				return Response.json({ object: "list", data: MAGPIE_MODELS });
			}
			return new Response(null, { status: 404 });
		};
	} else if (process.env.PI_USAGE_SWITCH_CHILD === "1") {
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
	const commands = new Map();
	const pi = {
		registerProvider: (_id, config) => registrations.push(config),
		on: (event, handler) => {
			handlers[event] = handler;
		},
		registerCommand: (name, config) => {
			commands.set(name, config);
		},
		unregisterProvider: () => undefined,
	};
	await loadExtension(pi);

	if (process.env.PI_MAGPIE_QUOTA_CHILD === "1") {
		const statuses = [];
		const toasts = [];
		const ctx = {
			cwd: process.cwd(),
			model: { provider: "test", id: "codex/gpt-6.1-sol" },
			ui: {
				setStatus: (_key, value) => statuses.push(value),
				notify: (message) => toasts.push(message),
				theme: { fg: (_color, value) => value },
			},
		};
		handlers.model_select({ model: ctx.model }, ctx);
		const deadline = Date.now() + 3000;
		while (!statuses.at(-1) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		const urlsAfterPoll = [...fetchedUrls];
		const printed = [];
		const realError = console.error;
		console.error = (...args) => printed.push(args.join(" "));
		await commands.get("quota").handler("", ctx);
		console.error = realError;
		console.log(
			JSON.stringify({
				status: statuses.at(-1),
				urlsAfterPoll,
				urlsAfterQuota: fetchedUrls,
				quota: printed.join("\n"),
				toast: toasts.at(-1),
			}),
		);
		return;
	}

	if (process.env.PI_MAGPIE_MODELS_CHILD === "1") {
		assert.equal(typeof registrations[0]?.refreshModels, "function");
		const signal = new AbortController().signal;
		const offline = await registrations[0].refreshModels({ allowNetwork: false, signal });
		const callsAfterOffline = fetchCalls;
		const online = await registrations[0].refreshModels({ allowNetwork: true, signal });
		console.log(
			JSON.stringify({
				offline,
				online,
				callsAfterOffline,
				callsAfterOnline: fetchCalls,
			}),
		);
		return;
	}

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

	if (process.env.PI_TEST_PRINT_REGISTRATION === "1") {
		console.log(JSON.stringify(registrations[0] ?? null));
		return;
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
		providerId = "test",
		includeModels = true,
		remoteModelsUnavailable = false,
		auth = { test: { type: "api-key", key: "test-key" } },
		modelsCache,
		settings,
		testUsageStyle,
		liveLogout = false,
		usageSwitch = false,
		baseUrl = "https://example.test/v1",
		inlineApiKey = false,
		localModels,
		printBaseUrl = false,
		printRegistration = false,
		printMagpieModels = false,
		printMagpieQuota = false,
	} = {},
) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sub2api-home-"));
	const agentDir = path.join(home, ".pi", "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(
		path.join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				[providerId]: {
					baseUrl,
					...(api ? { api } : {}),
					...(inlineApiKey ? { apiKey: "inline-key" } : {}),
					...(includeModels
						? { models: localModels ?? [{ id: "test-model" }] }
						: {}),
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
					: includeModels && auth[providerId]
						? "1"
						: "0",
				PI_REMOTE_MODELS_UNAVAILABLE: remoteModelsUnavailable ? "1" : "0",
				...(printBaseUrl ? { PI_TEST_PRINT_BASE_URL: "1" } : {}),
				...(printRegistration ? { PI_TEST_PRINT_REGISTRATION: "1" } : {}),
				...(printMagpieModels ? { PI_MAGPIE_MODELS_CHILD: "1" } : {}),
				...(printMagpieQuota ? { PI_MAGPIE_QUOTA_CHILD: "1" } : {}),
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
		const output = ts.transpileModule(`${source}\nexport { buildRegisteredModels, pickMagpieCard };`, {
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

		// Registration scope: whenever pi can resolve a provider on its own, the extension
		// must contribute models ONLY, so name/api/baseUrl/apiKey/authHeader keep falling back
		// to pi's own layers instead of being overridden by this extension.
		const registration = (overrides) =>
			JSON.parse(
				runScenario(compiledExtension, { printRegistration: true, ...overrides }).stdout,
			);

		// Custom id whose only credential lives in auth.json — the one case that genuinely
		// needs the extension to supply the key (pi reports credentials_not_configured).
		const custom = registration({});
		assert.equal(custom.name, "test");
		assert.equal(custom.api, "openai-completions");
		assert.equal(custom.apiKey, "test-key");
		assert.equal(custom.authHeader, true);
		assert.equal(custom.baseUrl, "https://example.test/v1");
		assert.equal(custom.models[0].baseUrl, "https://example.test/v1");

		// OAuth credential — the raw access token must never be injected as a Bearer key.
		const oauth = registration({
			auth: { test: { type: "oauth", access: "oauth-access", refresh: "r" } },
		});
		assert.deepEqual(Object.keys(oauth).sort(), ["models"]);
		assert.equal(oauth.models.length, 1);
		assert.equal(oauth.models[0].baseUrl, undefined);

		// models.json declares its own credentials.
		const inline = registration({ inlineApiKey: true });
		assert.deepEqual(Object.keys(inline).sort(), ["models"]);
		assert.equal(inline.models[0].baseUrl, undefined);

		// Built-in provider id — pi owns the catalog definition (auth, api, baseUrl).
		const builtin = registration({
			providerId: "anthropic",
			auth: { anthropic: { type: "api-key", key: "sk-anthropic" } },
			api: "anthropic-messages",
			baseUrl: "https://proxy.test",
		});
		assert.deepEqual(Object.keys(builtin).sort(), ["models"]);
		assert.equal(builtin.models[0].baseUrl, undefined);

		// magpie-style gateways: pi's model refresh pulls the live /v1/models catalog,
		// merged with models.json — remote metadata fills what a local entry leaves out,
		// local values win, and a locally configured model the upstream does not list is
		// kept. An offline refresh returns the local list and makes no request.
		const magpie = JSON.parse(
			runScenario(compiledExtension, {
				printMagpieModels: true,
				localModels: [
					{ id: "codex/gpt-6.1-sol" },
					{
						id: "auto/deepseek-v4.1-flash",
						contextWindow: 111,
						maxTokens: 222,
						input: ["text"],
					},
					{ id: "local-only/model" },
				],
			}).stdout,
		);
		const localIds = [
			"codex/gpt-6.1-sol",
			"auto/deepseek-v4.1-flash",
			"local-only/model",
		];
		assert.deepEqual(magpie.offline.map((m) => m.id), localIds);
		assert.deepEqual(magpie.online.map((m) => m.id), localIds);
		assert.equal(magpie.callsAfterOffline, 0, "offline refresh made a request");
		assert.equal(magpie.callsAfterOnline, 1);
		const sol = magpie.online[0];
		assert.equal(sol.name, "GPT-6.1-Sol");
		assert.equal(sol.contextWindow, 500000);
		assert.equal(sol.maxTokens, 128000);
		assert.deepEqual(sol.input, ["text", "image"]);
		assert.equal(sol.cost.input, 2);
		assert.equal(sol.cost.output, 10);
		assert.ok(Math.abs(sol.cost.cacheRead - 0.1) < 1e-9, `cacheRead ${sol.cost.cacheRead}`);
		assert.equal(sol.cost.cacheWrite, 2.5);
		// the model's own levels mapped to pi's, the ones it lacks hidden (`ultra` ignored)
		assert.deepEqual(sol.thinkingLevelMap, {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
		// a local value wins over the remote one
		assert.equal(magpie.online[1].contextWindow, 111);
		assert.equal(magpie.online[1].maxTokens, 222);
		assert.deepEqual(magpie.online[1].input, ["text"]);
		// a model only models.json knows keeps the built-in fallbacks
		assert.equal(magpie.online[2].contextWindow, 128000);
		assert.equal(magpie.online[2].maxTokens, 16384);
		assert.deepEqual(magpie.online[2].input, ["text"]);

		// magpie gateways: /v1/usage answers 404, so the probe falls through to
		// /v1/magpie/quotas (cached read), and the status bar shows the card of the
		// account serving the current model, most-used window first.
		const magpieQuota = JSON.parse(
			runScenario(compiledExtension, { printMagpieQuota: true }).stdout,
		);
		assert.equal(
			magpieQuota.status,
			"● test codex w [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]",
		);
		assert.equal(
			magpieQuota.toast,
			"codex w [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]",
		);
		// the polled read is the cached one; only /quota asks magpie for a fresh read
		assert.equal(magpieQuota.urlsAfterPoll.length, 3);
		assert.match(magpieQuota.urlsAfterPoll[0], /\/v1\/usage\?days=30&timezone=/);
		assert.match(magpieQuota.urlsAfterPoll[1], /\/v1\/magpie\/quotas\?kept=1$/);
		// the probe's hit is read again for the quota itself
		assert.equal(magpieQuota.urlsAfterPoll[2], magpieQuota.urlsAfterPoll[1]);
		assert.deepEqual(
			magpieQuota.urlsAfterQuota.slice(0, 3),
			magpieQuota.urlsAfterPoll,
		);
		assert.equal(
			magpieQuota.urlsAfterQuota[3],
			"https://example.test/v1/magpie/quotas",
		);
		for (const line of [
			"Provider:     test",
			"Source:       magpie (https://example.test/v1/magpie/quotas)",
			"Accounts:     2",
			"Codex (codex) · subscription · plus · me@example.test",
			"5 hours",
			"7 days",
			"MiniMax Code (minimax-code) · subscription · M Plan Starter",
			"2000 / 2000",
		]) {
			assert.ok(magpieQuota.quota.includes(line), `quota output misses ${line}`);
		}
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
			resolveRegistrationScope,
			isBuiltinProviderId,
			BUILTIN_PROVIDER_IDS,
			formatStatusText,
			normalizeUsageStyle,
			resolveUsageStyle,
			pickMagpieCard,
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

		// resolveRegistrationScope decision table
		const base = { baseUrl: "https://demo.test/v1" };
		const scopeCases = [
			["custom id + auth.json api key", "stepfun", base, "api_key", false],
			["oauth credential", "stepfun", base, "oauth", true],
			["missing credential type", "stepfun", base, undefined, false],
			["models.json apiKey", "stepfun", { ...base, apiKey: "$K" }, "api_key", true],
			["models.json headers", "stepfun", { ...base, headers: { a: "b" } }, "api_key", true],
			["built-in id", "anthropic", base, "api_key", true],
			["built-in id + oauth", "xai", base, "oauth", true],
		];
		for (const [label, providerId, providerVal, credentialType, expected] of scopeCases) {
			const scope = resolveRegistrationScope(providerId, providerVal, credentialType);
			assert.equal(scope.minimal, expected, label);
			assert.ok(typeof scope.reason === "string" && scope.reason.length > 0, label);
		}
		assert.ok(BUILTIN_PROVIDER_IDS.has("anthropic"));
		assert.ok(BUILTIN_PROVIDER_IDS.has("openai"));
		assert.ok(!BUILTIN_PROVIDER_IDS.has("stepfun"));
		assert.equal(isBuiltinProviderId("xai"), true);

		// The bundled built-in id list is a snapshot of pi's catalog; assert it still covers the
		// pi version installed as a dev dependency so catalog drift is caught by tests.
		try {
			const resolved = await import.meta.resolve("@earendil-works/pi-coding-agent");
			const piPackageDir = path.resolve(fileURLToPath(resolved), "..", "..");
			const catalogPath = path.join(
				piPackageDir,
				"node_modules",
				"@earendil-works",
				"pi-ai",
				"dist",
				"providers",
				"all.js",
			);
			const catalog = await import(pathToFileURL(catalogPath).href);
			const missing = catalog
				.builtinProviders()
				.map((provider) => provider.id)
				.filter((id) => !BUILTIN_PROVIDER_IDS.has(id));
			assert.deepEqual(missing, [], `built-in catalog ids missing from BUILTIN_PROVIDER_IDS: ${missing.join(", ")}`);
		} catch (e) {
			if (e instanceof assert.AssertionError) throw e;
			console.error(`skipped catalog coverage check: ${e.message}`);
		}
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

		// formatStatusText unit checks: magpie cards
		const magpieCard = (provider, name, windows) => ({
			provider,
			name,
			kind: "subscription",
			plan: null,
			user: null,
			balance: null,
			unit: "USD",
			readAt: null,
			until: null,
			windows,
		});
		const magpieInfo = {
			source: {
				kind: "magpie",
				url: "https://example.test/v1/magpie/quotas?kept=1",
				refreshUrl: "https://example.test/v1/magpie/quotas",
			},
			magpie: [
				magpieCard("codex", "Codex", [
					{ name: "5 hours", label: "5h", used: 10, remaining: 90, resetsAt: null, display: null },
					{ name: "7 days", label: "weekly", used: 31, remaining: 69, resetsAt: null, display: null },
				]),
				magpieCard("minimax-code", "MiniMax Code", [
					{ name: "Credits", label: "Credits", used: 100, remaining: 0, resetsAt: null, display: "2000 / 2000" },
				]),
			],
			rateLimits: [],
			dailyUsage: [],
			todayCost: 0,
			totalCost: 0,
			status: "valid",
			mode: "magpie",
			lastUpdated: 0,
			quota: null,
			subscription: null,
			balance: null,
			unit: "USD",
			planName: null,
			remaining: null,
			expiresAt: null,
			todayUsage: null,
			totalUsage: null,
		};
		// the account the model belongs to, its most-used window first
		assert.equal(
			formatStatusText("test", magpieInfo, "progress", "codex/gpt-6.1-sol"),
			"● test codex w [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]",
		);
		assert.equal(
			formatStatusText("test", magpieInfo, "numeric", "codex/gpt-6.1-sol"),
			"● test codex w 31% · 5h 10%",
		);
		assert.equal(
			formatStatusText("test", magpieInfo, "progress", "minimax-code/MiniMax-M3.1-Flash"),
			"● test minimax-code Credits [⣿⣿⣿⣿⣿]",
		);
		// no model to match (or an unknown one): the card closest to running out
		assert.equal(
			formatStatusText("test", magpieInfo, "progress"),
			"● test minimax-code Credits [⣿⣿⣿⣿⣿]",
		);
		assert.equal(pickMagpieCard(magpieInfo.magpie, "nope/x").provider, "minimax-code");
		assert.equal(pickMagpieCard(magpieInfo.magpie, "codex/x").provider, "codex");
		assert.equal(pickMagpieCard([], "codex/x"), null);
		assert.equal(
			pickMagpieCard([magpieCard("codex", "Codex", [])], "codex/x"),
			null,
		);

		console.log("API adapter selection, model probing, reasoning metadata, and usage reset passed");
	} finally {
		fs.rmSync(buildDir, { recursive: true, force: true });
	}
}
