// Quiet spinner: floor every pi-tui spinner frame interval so long sessions stop
// burning a core on decorative redraws.
//
// Problem: pi redraws the whole TUI ~12x/s while any spinner is on screen. Every
// redraw scans the entire transcript line array (~0.8-1.2us per rendered line, not
// just the viewport), so a 90k-line session burns ~65-85% of a core while it merely
// waits for a tool to finish. Measured on a 54k-line session: 58% -> 8% of one core.
//
// The animations that cost this are pi-tui `Loader` instances (working-status
// indicator, the inline spinner of a running bash call, dialog loaders). None of them
// is configurable, so this floors their frame interval globally. Rendering still
// happens on every real event; only the decorative tick slows down.
//
// EXIT PLAN: delete this package once upstream stops re-rendering the whole transcript
// per frame (earendil-works/pi#9549 / #6665). Re-check by running `!sleep 60` in a
// large session and watching `ps -o time= -p <pid>`; if that no longer pegs a core,
// this workaround is obsolete.
import { Loader } from "@earendil-works/pi-tui";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Upstream `Loader` frame interval, used when a loader carries no usable value. */
const UPSTREAM_INTERVAL_MS = 80;

/** Largest usable timer delay; Node clamps a delay outside 1..this to 1 ms, inverting the floor. */
const MAX_INTERVAL_MS = 2_147_483_647;

/** Upstream braille cycle; presets take prefixes of it so no new glyph vocabulary appears. */
const UPSTREAM_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The `settings.json` key this package reads. */
const CONFIG_KEY = "quiet-spinner";

const CONFIG_KEYS = ["preset", "intervalMs", "frames"] as const;

export const PRESET_NAMES = ["still", "quiet", "calm", "default"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export interface QuietSpinnerOptions {
	/** Frames to force on every loader, or `null` to keep each loader's own frames. */
	frames: string[] | null;
	/** Frame interval floor in milliseconds. */
	intervalMs: number;
}

/** The `quiet-spinner` settings block; values stay `unknown` until validated. */
export interface QuietSpinnerConfig {
	preset?: unknown;
	intervalMs?: unknown;
	frames?: unknown;
}

/** A slower spinner reads as motion only if its cycle is short enough, so each preset pairs both. */
const PRESETS: Record<Exclude<PresetName, "default">, QuietSpinnerOptions> = {
	still: { frames: ["⠿"], intervalMs: 1000 },
	quiet: { frames: UPSTREAM_FRAMES.slice(0, 4), intervalMs: 1000 },
	calm: { frames: UPSTREAM_FRAMES.slice(0, 8), intervalMs: 400 },
};

const DEFAULT_PRESET: PresetName = "quiet";

/**
 * Resolve the `quiet-spinner` settings block into loader options, or `null` for
 * "install no patch". Throws on a value it cannot honor rather than silently
 * falling back.
 */
export function resolveOptions(config: QuietSpinnerConfig = {}): QuietSpinnerOptions | null {
	assertConfigObject(config);
	for (const key of Object.keys(config))
		if (!(CONFIG_KEYS as readonly string[]).includes(key))
			throw new Error(
				`pi-quiet-spinner: ${CONFIG_KEY} has unknown key "${key}" (expected ${CONFIG_KEYS.join(", ")})`,
			);
	const preset = parsePreset(config.preset);
	const intervalMs = parseInterval(config.intervalMs);
	const frames = parseFrames(config.frames);
	if (preset === "default" && intervalMs === null && frames === null) return null;
	const base = preset === "default" ? null : PRESETS[preset];
	return {
		frames: frames ?? base?.frames ?? null,
		intervalMs: intervalMs ?? base?.intervalMs ?? UPSTREAM_INTERVAL_MS,
	};
}

/** Read and merge the `quiet-spinner` block; project settings override global ones. */
export function loadConfig(cwd: string, home: string): QuietSpinnerConfig {
	return {
		...readConfigFile(join(home, CONFIG_DIR_NAME, "agent", "settings.json")),
		...readConfigFile(join(cwd, CONFIG_DIR_NAME, "settings.json")),
	};
}

function readConfigFile(path: string): QuietSpinnerConfig {
	if (!existsSync(path)) return {};
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		throw new Error(`pi-quiet-spinner: cannot read ${path}: ${messageOf(error)}`);
	}
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (error) {
		throw new Error(`pi-quiet-spinner: cannot parse ${path}: ${messageOf(error)}`);
	}
	if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
	const block = (data as Record<string, unknown>)[CONFIG_KEY];
	if (block === undefined) return {};
	assertConfigObject(block);
	return block;
}

function assertConfigObject(config: unknown): asserts config is QuietSpinnerConfig {
	if (config === null || typeof config !== "object" || Array.isArray(config))
		throw new Error(
			`pi-quiet-spinner: ${CONFIG_KEY} must be a settings object but was ${describe(config)}`,
		);
}

function parsePreset(raw: unknown): PresetName {
	if (raw === undefined) return DEFAULT_PRESET;
	if ((PRESET_NAMES as readonly unknown[]).includes(raw)) return raw as PresetName;
	throw new Error(
		`pi-quiet-spinner: ${CONFIG_KEY}.preset must be one of ${PRESET_NAMES.join(", ")} but was ${describe(raw)}`,
	);
}

function parseInterval(raw: unknown): number | null {
	if (raw === undefined) return null;
	if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1 || raw > MAX_INTERVAL_MS)
		throw new Error(
			`pi-quiet-spinner: ${CONFIG_KEY}.intervalMs must be an integer between 1 and ${MAX_INTERVAL_MS} but was ${describe(raw)}`,
		);
	return raw;
}

function parseFrames(raw: unknown): string[] | null {
	if (raw === undefined) return null;
	// Frame content is the whole point of this key, so an empty list or a blank
	// entry is a configuration error: it would render an invisible indicator.
	if (Array.isArray(raw) && raw.length > 0 && raw.every((f) => typeof f === "string" && f.trim() !== ""))
		return [...raw];
	throw new Error(
		`pi-quiet-spinner: ${CONFIG_KEY}.frames must be a non-empty array of non-empty strings but was ${describe(raw)}`,
	);
}

/** Render an offending value for an error message. */
function describe(value: unknown): string {
	return JSON.stringify(value) ?? String(value);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The `Loader` surface this patch touches. */
interface LoaderLike {
	frames: string[];
	intervalMs: number;
	currentFrame: number;
	restartAnimation(): void;
	setIndicator(indicator?: { frames?: string[]; intervalMs?: number }): void;
}

/** Structural view of `Loader.prototype`, so the patch can be installed and tested without a TUI. */
export interface LoaderPrototype {
	restartAnimation?: unknown;
	setIndicator?: unknown;
}

const INSTALLED = Symbol.for("pi-quiet-spinner/installed");

/**
 * Install the interval floor (and optional frame override) on a `Loader`-shaped
 * prototype. Idempotent: a second install leaves the first one in place.
 */
export function installQuietSpinner(proto: LoaderPrototype, options: QuietSpinnerOptions): void {
	if ((proto as Record<symbol, unknown>)[INSTALLED] === true) return;
	const originalRestartAnimation = proto.restartAnimation;
	const originalSetIndicator = proto.setIndicator;
	if (typeof originalRestartAnimation !== "function")
		throw new Error(
			"pi-quiet-spinner: @earendil-works/pi-tui Loader.restartAnimation is missing — update this package",
		);
	if (typeof originalSetIndicator !== "function")
		throw new Error(
			"pi-quiet-spinner: @earendil-works/pi-tui Loader.setIndicator is missing — update this package",
		);

	// The floor lives in one place: every animation start routes through here.
	proto.restartAnimation = function (this: LoaderLike) {
		this.intervalMs = floorInterval(this.intervalMs, options.intervalMs);
		return originalRestartAnimation.call(this);
	};
	proto.setIndicator = function (this: LoaderLike, indicator?: { frames?: string[]; intervalMs?: number }) {
		originalSetIndicator.call(this, indicator);
		if (options.frames === null) return;
		// Replace the frames after the loader has chosen them, then re-arm: a
		// single-frame override must stop the timer instead of ticking on it.
		// `renderIndicatorVerbatim` belongs to the caller and is left untouched.
		this.frames = [...options.frames];
		this.currentFrame = 0;
		this.restartAnimation();
	};
	Object.defineProperty(proto, INSTALLED, { value: true, enumerable: false });
}

function floorInterval(current: unknown, floor: number): number {
	const base =
		typeof current === "number" && Number.isFinite(current) && current > 0 ? current : UPSTREAM_INTERVAL_MS;
	return Math.max(base, floor);
}

export default function (_pi: ExtensionAPI): void {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const options = resolveOptions(loadConfig(process.cwd(), home));
	if (options === null) return;
	installQuietSpinner(Loader.prototype as unknown as LoaderPrototype, options);
}
