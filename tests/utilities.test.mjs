import assert from "node:assert/strict";
import { test } from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { buildInfo, compression, envGuard, htmlTemplate, virtualModules } from "../dist/index.mjs";

test("build information is deterministic with an injected clock", async () => {
	const plugin = buildInfo({
		version: "2.0.0",
		commit: "abc123",
		data: { channel: "stable" },
		now: () => new Date("2026-01-02T03:04:05.000Z"),
	});
	plugin.config({}, { command: "build", mode: "production" });
	await plugin.configResolved({ root: process.cwd() });
	let emitted;
	await plugin.generateBundle.call({ emitFile: (asset) => (emitted = asset) });
	const info = JSON.parse(emitted.source);
	assert.deepEqual(info, {
		channel: "stable",
		version: "2.0.0",
		builtAt: "2026-01-02T03:04:05.000Z",
		mode: "production",
		commit: "abc123",
	});
});

test("compression produces valid gzip and brotli streams", async () => {
	const source = Buffer.from("fast-vite-plugins ".repeat(200));
	const plugin = compression({ threshold: 0, minRatio: 1 });
	plugin.configResolved({ plugins: [plugin] });
	const assets = [];
	await plugin.generateBundle.handler.call(
		{ emitFile: (asset) => assets.push(asset) },
		{},
		{ "app.js": { code: source.toString("utf8"), fileName: "app.js", type: "chunk" } }
	);
	assert.deepEqual(gunzipSync(assets.find(({ fileName }) => fileName.endsWith(".gz")).source), source);
	assert.deepEqual(brotliDecompressSync(assets.find(({ fileName }) => fileName.endsWith(".br")).source), source);
});

test("environment guard reports all invalid variables without exposing their values", () => {
	const plugin = envGuard({
		schema: {
			VITE_API_URL: { pattern: /^https:\/\// },
			VITE_STAGE: { values: ["development", "production"] },
			OPTIONAL: { required: false },
		},
	});
	const previousUrl = process.env.VITE_API_URL;
	const previousStage = process.env.VITE_STAGE;
	process.env.VITE_API_URL = "not-a-url";
	process.env.VITE_STAGE = "preview";
	try {
		assert.throws(
			() => plugin.config.call({ error: (message) => assert.fail(message) }, { envDir: false }, { mode: "test" }),
			(error) => /VITE_API_URL/.test(error.message) && /VITE_STAGE/.test(error.message) && !/not-a-url|preview/.test(error.message)
		);
	} finally {
		if (previousUrl === undefined) delete process.env.VITE_API_URL;
		else process.env.VITE_API_URL = previousUrl;
		if (previousStage === undefined) delete process.env.VITE_STAGE;
		else process.env.VITE_STAGE = previousStage;
	}
});

test("environment required and allowEmpty rules are independent", () => {
	const key = "FAST_VITE_EMPTY_TEST";
	const previous = process.env[key];
	try {
		delete process.env[key];
		assert.doesNotThrow(() => envGuard({ schema: { [key]: { required: false } } }).config.call({}, { envDir: false }, { mode: "test" }));
		process.env[key] = "";
		assert.throws(
			() =>
				envGuard({ schema: { [key]: { required: false } } }).config.call(
					{ error: (message) => assert.fail(message) },
					{ envDir: false },
					{ mode: "test" }
				),
			/Variable is empty/
		);
		assert.doesNotThrow(() => envGuard({ schema: { [key]: { allowEmpty: true } } }).config.call({}, { envDir: false }, { mode: "test" }));
	} finally {
		if (previous === undefined) delete process.env[key];
		else process.env[key] = previous;
	}
});

test("environment guard uses English diagnostics and preserves custom validation messages", () => {
	const key = "FAST_VITE_DIAGNOSTIC_TEST";
	const previous = process.env[key];
	const warnings = [];
	const validate = (rule) =>
		envGuard({ schema: { [key]: rule }, onInvalid: "warn" }).config.call(
			{ warn: (message) => warnings.push(message) },
			{ envDir: false },
			{ mode: "test" }
		);
	try {
		delete process.env[key];
		validate(true);
		assert.equal(warnings.pop(), `[fast-vite:env-guard] Environment variable validation failed:\n- ${key}: Required variable is missing`);
		process.env[key] = "test-value";
		validate({ validate: () => false });
		assert.equal(warnings.pop(), `[fast-vite:env-guard] Environment variable validation failed:\n- ${key}: Custom validation failed`);
		validate({ validate: () => "调用方自定义校验消息" });
		assert.equal(warnings.pop(), `[fast-vite:env-guard] Environment variable validation failed:\n- ${key}: 调用方自定义校验消息`);
	} finally {
		if (previous === undefined) delete process.env[key];
		else process.env[key] = previous;
	}
});

test("HTML template replacement escapes values and keeps unknown placeholders", () => {
	const plugin = htmlTemplate({ data: { TITLE: "A & <B>" } });
	plugin.config({}, { command: "build", mode: "production" });
	return plugin
		.transformIndexHtml("<title>{{ TITLE }}</title><p>{{ UNKNOWN }}</p>", { path: "/index.html" })
		.then(({ html }) => assert.equal(html, "<title>A &amp; &lt;B&gt;</title><p>{{ UNKNOWN }}</p>"));
});

test("virtual modules resolve sync and async sources", async () => {
	const plugin = virtualModules({
		modules: {
			"virtual:plain": "export default 1;",
			"virtual:mode": ({ mode }) => `export default ${JSON.stringify(mode)};`,
		},
	});
	plugin.config({}, { command: "build", mode: "test" });
	plugin.configResolved({ root: process.cwd() });
	const resolved = plugin.resolveId("virtual:mode");
	assert.match(resolved, /^\0fast-vite:virtual:/);
	assert.equal(await plugin.load(resolved), 'export default "test";');
});

test("plugin functions reject empty or unsafe configuration", () => {
	assert.throws(() => buildInfo({ virtualModuleId: "build-info" }), /must start with virtual:/);
	assert.throws(() => buildInfo({ fileName: "." }), /relative path/);
	assert.throws(() => compression({ threshold: Number.POSITIVE_INFINITY }), /finite/);
	assert.throws(() => compression({ algorithms: null }), /algorithms/);
	assert.throws(() => htmlTemplate({ data: null }), /data/);
	assert.throws(() => htmlTemplate({ data: [] }), /data/);
	assert.throws(() => virtualModules({ modules: null }), /modules/);
	assert.throws(() => virtualModules({ modules: [] }), /modules/);
	assert.throws(() => virtualModules({ modules: {} }), /must contain at least one module/);
});
