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
	const { default: loadExtension } = await import(pathToFileURL(process.env.PI_TEST_EXTENSION).href);
	const registrations = [];
	const pi = {
		registerProvider: (_id, config) => registrations.push(config),
		on: () => undefined,
		registerCommand: () => undefined,
	};
	await loadExtension(pi);
	const expectedRegistrations = Number(process.env.PI_EXPECTED_REGISTRATIONS ?? "1");
	assert.equal(registrations.length, expectedRegistrations);
	if (registrations[0]) console.log(registrations[0].api);
}

function runScenario(compiledExtension, { api, includeModels = true, remoteModelsUnavailable = false } = {}) {
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
	fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ test: { type: "api-key", key: "test-key" } }));

	try {
		const result = spawnSync(process.execPath, [testFile], {
			env: {
				...process.env,
				HOME: home,
				PI_API_SELECTION_CHILD: "1",
				PI_TEST_EXTENSION: compiledExtension,
				PI_EXPECTED_REGISTRATIONS: includeModels ? "1" : "0",
				PI_REMOTE_MODELS_UNAVAILABLE: remoteModelsUnavailable ? "1" : "0",
			},
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
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
		const source = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
		const output = ts.transpileModule(source, {
			compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
		});
		fs.writeFileSync(compiledExtension, output.outputText);
		assert.equal(runScenario(compiledExtension).stdout, "openai-completions");
		assert.equal(runScenario(compiledExtension, { api: "openai-responses" }).stdout, "openai-responses");
		const unavailableModels = runScenario(compiledExtension, {
			includeModels: false,
			remoteModelsUnavailable: true,
		});
		assert.equal(unavailableModels.stdout, "");
		assert.equal(unavailableModels.stderr, "");
		console.log("API adapter selection and silent model probing passed");
	} finally {
		fs.rmSync(buildDir, { recursive: true, force: true });
	}
}
