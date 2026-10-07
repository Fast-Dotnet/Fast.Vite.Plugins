import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { build } from "vite";
import { bundleBudget, compression, devRestart, envGuard, subresourceIntegrity } from "../dist/index.mjs";

test("bundle budget reports per-file, total and missing-match failures", async () => {
	const plugin = bundleBudget({
		onExceed: "warn",
		budgets: [
			{ name: "scripts", filter: /\.js$/, limit: 4 },
			{ name: "code", filter: /\.(?:css|js)$/, limit: 7, scope: "total" },
			{ name: "images", filter: /\.png$/, limit: 10, requireMatch: true },
		],
	});
	const warnings = [];
	await plugin.generateBundle.handler.call(
		{ error: assert.fail, warn: (message) => warnings.push(message) },
		{},
		{
			"assets/app.js": { code: "12345", fileName: "assets/app.js", type: "chunk" },
			"assets/app.css": { fileName: "assets/app.css", source: "123", type: "asset" },
			"assets/app.js.map": { fileName: "assets/app.js.map", source: "ignored", type: "asset" },
		}
	);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /scripts: assets\/app\.js/);
	assert.match(warnings[0], /code: total 8 B > 7 B/);
	assert.match(warnings[0], /images: requireMatch/);
});

test("plugin functions reject ambiguous or unsafe configuration", () => {
	assert.throws(() => bundleBudget({ budgets: [] }), /budgets/);
	assert.throws(
		() =>
			bundleBudget({
				budgets: [
					{ limit: 1, name: "same" },
					{ limit: 2, name: "same" },
				],
			}),
		/Duplicate budget name/
	);
	assert.throws(() => devRestart({ paths: "schema/**/*.json" }), /glob/);
	assert.throws(() => subresourceIntegrity({ algorithms: [] }), /algorithms/);
	assert.throws(() => subresourceIntegrity({ algorithms: null }), /algorithms/);
	assert.throws(() => compression({ minRatio: Number.NaN }), /finite/);
	assert.throws(() => bundleBudget({ budgets: [{ limit: 1 }, { limit: 2, name: "budget-1" }] }), /Duplicate budget name/);
	assert.throws(() => bundleBudget({ budgets: [{ limit: 1, scope: "" }] }), /scope/);
	assert.throws(() => bundleBudget({ budgets: [{ limit: 1, mode: null }] }), /mode/);
	assert.throws(() => bundleBudget({ budgets: [{ limit: 1 }], onExceed: "" }), /onExceed/);
	assert.throws(() => envGuard({ schema: { VITE_API_URL: true }, onInvalid: null }), /onInvalid/);
	for (const schema of [undefined, null, "invalid", [], {}]) {
		assert.throws(() => envGuard({ schema }), /schema/);
	}
	assert.throws(() => envGuard({ schema: { VITE_API_URL: null } }), /must be true or an object/);
});

test("bundle budget plugin can fail a real Vite Web application build", async () => {
	const root = path.resolve("tests/fixtures/integration");
	await assert.rejects(
		build({
			root,
			logLevel: "silent",
			plugins: [bundleBudget({ budgets: [{ filter: /\.js$/, limit: 1, requireMatch: true }] })],
			build: {
				minify: false,
				write: false,
			},
		}),
		/fast-vite:bundle-budget/
	);
});

test("post-build plugin order is accepted forward and rejected in reverse", async () => {
	const root = path.resolve("tests/fixtures/integration");
	const buildOptions = {
		root,
		logLevel: "silent",
		build: { rollupOptions: { external: ["external-library", "virtual:test-config"] }, write: false },
	};
	await build({
		...buildOptions,
		plugins: [subresourceIntegrity(), bundleBudget({ budgets: [{ limit: Number.MAX_SAFE_INTEGER }] }), compression()],
	});
	await assert.rejects(
		build({
			...buildOptions,
			plugins: [compression(), bundleBudget({ budgets: [{ limit: 1 }] }), subresourceIntegrity()],
		}),
		/order must be subresource-integrity/
	);
});

test("SRI injects only local assets, preserves attributes and skips comments", () => {
	const plugin = subresourceIntegrity({ algorithms: ["sha384", "sha512"], overwrite: false });
	plugin.configResolved({ base: "https://example.com/app/", plugins: [plugin] });
	const bundle = {
		"assets/app.js": { code: "console.log('fast')", fileName: "assets/app.js", type: "chunk" },
		"index.html": {
			fileName: "index.html",
			source: '<!-- <script src="/app/commented.js"></script> --><script data-label="a > b" crossorigin="use-credentials" src="/app/assets/app.js"></script><script src="https://example.com/outside.js"></script><script src="/outside.js"></script>',
			type: "asset",
		},
	};
	plugin.generateBundle.handler.call({ emitFile: assert.fail, error: assert.fail }, {}, bundle);
	const html = bundle["index.html"].source;
	assert.equal((html.match(/ integrity=/g) ?? []).length, 1);
	assert.match(html, /data-label="a > b" crossorigin="use-credentials"[^>]+integrity="sha384-[^"]+ sha512-[^"]+"/);
	assert.doesNotMatch(html, /commented\.js" integrity=/);
	assert.match(html, /https:\/\/example\.com\/outside\.js/);
	assert.match(html, /src="\/outside\.js"/);
});

test("dev restart plugin debounces watched changes and runs its hook", async () => {
	class FakeWatcher extends EventEmitter {
		added = [];

		add(paths) {
			this.added.push(...paths);
		}
	}

	const watcher = new FakeWatcher();
	const restarts = [];
	const beforeRestart = [];
	const plugin = devRestart({
		paths: "tests/fixtures",
		debounce: 5,
		log: false,
		beforeRestart: (context) => beforeRestart.push(context),
	});
	const server = {
		config: { root: path.resolve("."), logger: { error: assert.fail, info: assert.fail } },
		restart: async (force) => restarts.push(force),
		watcher,
	};

	await plugin.configureServer(server);
	watcher.emit("all", "change", path.resolve("tests/fixtures/integration/index.html"));
	watcher.emit("all", "change", path.resolve("tests/fixtures/integration/src/main.js"));
	await new Promise((resolve) => {
		setTimeout(resolve, 25);
	});

	assert.deepEqual(restarts, [false]);
	assert.equal(beforeRestart.length, 1);
	assert.match(beforeRestart[0].file, /main\.js$/);
	plugin.buildEnd();
});

test("dev restart disposal clears work queued while a restart is running", async () => {
	class FakeWatcher extends EventEmitter {
		add() {}
	}
	const watcher = new FakeWatcher();
	let release;
	const running = new Promise((resolve) => {
		release = resolve;
	});
	let restartCount = 0;
	const plugin = devRestart({
		paths: "tests/fixtures",
		debounce: 0,
		log: false,
		beforeRestart: () => running,
	});
	const server = {
		config: { root: path.resolve("."), logger: { error: assert.fail, info: assert.fail } },
		restart: async () => {
			restartCount += 1;
		},
		watcher,
	};
	await plugin.configureServer(server);
	const file = path.resolve("tests/fixtures/integration/index.html");
	watcher.emit("all", "change", file);
	await new Promise((resolve) => {
		setTimeout(resolve, 5);
	});
	watcher.emit("all", "change", file);
	watcher.emit("close");
	release();
	await new Promise((resolve) => {
		setTimeout(resolve, 10);
	});
	assert.equal(restartCount, 1);
});
