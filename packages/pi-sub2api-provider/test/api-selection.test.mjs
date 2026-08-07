import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const testFile = fileURLToPath(import.meta.url);

async function runChild() {
	if (process.env.PI_REMOTE_MODELS_UNAVAILABLE === "1") {
		globalThis.fetch = async () => new Response(null, { status: 503 });
	}
	const { default: loadExtension } = await import(
		pathToFileURL(process.env.PI_TEST_EXTENSION).href
	);
	const registrations = [];
	const pi = {
		registerProvider: (_id, config) => registrations.push(config),
		on: () => undefined,
		registerCommand: () => undefined,
		unregisterProvider: () => undefined,
	};
	await loadExtension(pi);

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
		liveLogout = false,
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
					baseUrl: "https://example.test/v1",
					...(api ? { api } : {}),
					...(includeModels ? { models: [{ id: "test-model" }] } : {}),
				},
			},
		}),
	);
	fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify(auth));
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
				PI_EXPECTED_REGISTRATIONS: includeModels && auth.test ? "1" : "0",
				PI_REMOTE_MODELS_UNAVAILABLE: remoteModelsUnavailable ? "1" : "0",
				...(liveLogout ? { PI_LIVE_LOGOUT_CHILD: "1" } : {}),
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
		const output = ts.transpileModule(source, {
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
		console.log("API adapter selection and silent model probing passed");
	} finally {
		fs.rmSync(buildDir, { recursive: true, force: true });
	}
}
