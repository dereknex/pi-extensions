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

const tsSource = fs.readFileSync(srcTsPath, "utf8");
const { outputText } = ts.transpileModule(tsSource, {
	compilerOptions: {
		module: ts.ModuleKind.ESNext,
		target: ts.ScriptTarget.ES2022,
	},
});
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(compiledJsPath, outputText, "utf8");

const { computeCacheHitRate, computeWeightedTps } = await import(
	pathToFileURL(compiledJsPath).href
);

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