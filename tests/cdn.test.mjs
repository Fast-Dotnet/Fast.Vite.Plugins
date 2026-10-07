import assert from "node:assert/strict";
import { test } from "node:test";
import { cdnImport, cdnJsDelivrUrl, cdnUnpkgUrl } from "../dist/index.mjs";

const environment = { command: "build", mode: "production" };

test("CDN URL templates remain public constants", () => {
	assert.equal(cdnJsDelivrUrl, "https://cdn.jsdelivr.net/npm/{name}@{version}/{path}");
	assert.equal(cdnUnpkgUrl, "https://unpkg.com/{name}@{version}/{path}");
});

test("CDN plugin defaults to the jsDelivr URL template", async () => {
	const plugin = await configure({
		modules: { global: "Vue", js: "dist/vue.global.prod.js", name: "vue", version: "3.5.0" },
	});
	assert.equal(plugin.transformIndexHtml()[0]?.attrs.src, "https://cdn.jsdelivr.net/npm/vue@3.5.0/dist/vue.global.prod.js");
});

async function configure(options) {
	const plugin = cdnImport(options);
	plugin.config({}, environment);
	await plugin.configResolved({ command: "build", root: process.cwd() });
	return plugin;
}

function transform(plugin, code, program) {
	return plugin.transform.call({ parse: () => program }, code, "source.js", {});
}

test("CDN plugin resolves URLs and preserves module order", async () => {
	const plugin = await configure({
		urlTemplate: "https://unpkg.com/{name}@{version}/{path}",
		modules: [
			{ name: "vue", global: "Vue", version: "3.5.0", js: "dist/vue.global.prod.js" },
			{ name: "dayjs", global: "dayjs", version: "1.11.0", js: "dayjs.min.js", css: "theme.css" },
		],
	});
	const tags = plugin.transformIndexHtml();
	assert.deepEqual(
		tags.map(({ attrs, tag }) => ({ src: attrs.href ?? attrs.src, tag })),
		[
			{ src: "https://unpkg.com/vue@3.5.0/dist/vue.global.prod.js", tag: "script" },
			{ src: "https://unpkg.com/dayjs@1.11.0/theme.css", tag: "link" },
			{ src: "https://unpkg.com/dayjs@1.11.0/dayjs.min.js", tag: "script" },
		]
	);
});

test("CDN transformation uses AST boundaries and returns a composable source map", async () => {
	const plugin = await configure({ modules: { name: "vue", global: "Vue", version: "3.5.0", js: "vue.js" } });
	const code = 'import Vue, { ref as vueRef } from "vue";\nconst lazy = import("vue");';
	const importEnd = code.indexOf(";") + 1;
	const dynamicStart = code.lastIndexOf("import(");
	const dynamicEnd = dynamicStart + 'import("vue")'.length;
	const program = {
		body: [
			{
				type: "ImportDeclaration",
				start: 0,
				end: importEnd,
				source: { value: "vue" },
				specifiers: [
					{ type: "ImportDefaultSpecifier", start: 7, end: 10, local: { name: "Vue" } },
					{ type: "ImportSpecifier", start: 14, end: 27, imported: { name: "ref" }, local: { name: "vueRef" } },
				],
			},
			{
				type: "VariableDeclaration",
				start: importEnd + 1,
				end: code.length,
				declarations: [
					{
						type: "VariableDeclarator",
						start: code.indexOf("lazy"),
						end: dynamicEnd,
						init: { type: "ImportExpression", start: dynamicStart, end: dynamicEnd, source: { value: "vue" } },
					},
				],
			},
		],
	};

	const result = transform(plugin, code, program);
	assert.match(result.code, /const Vue = globalThis\["Vue"\]/);
	assert.match(result.code, /const vueRef = globalThis\["Vue"\]\["ref"\]/);
	assert.match(result.code, /Promise\.resolve\(globalThis\["Vue"\]\)/);
	assert.deepEqual(result.map.sourcesContent, [code]);
});

test("CDN transformation ignores Vite HTML proxy CSS requests in development", async () => {
	const plugin = cdnImport({
		dev: true,
		modules: { name: "vue", global: "Vue", version: "3.5.0", js: "vue.js" },
	});
	plugin.config({}, { command: "serve", mode: "development" });
	await plugin.configResolved({ command: "serve", root: process.cwd() });

	const result = plugin.transform.call(
		{
			parse() {
				throw new Error("CSS must not be parsed as JavaScript");
			},
		},
		":root { color-scheme: light; }",
		"/index.html?html-proxy&direct&index=0.css",
		{}
	);

	assert.equal(result, undefined);
});

test("CDN module names use own properties and generated bindings avoid user code", async () => {
	const plugin = await configure({ modules: { name: "constructor", global: "Vue", version: "1.0.0", js: "vue.js" } });
	const code = 'const __fast_cdn_export_0_0 = "user";\nexport { ref as value } from "constructor";';
	const exportStart = code.lastIndexOf("export");
	const program = {
		body: [
			{
				type: "VariableDeclaration",
				start: 0,
				end: exportStart - 1,
				declarations: [
					{
						type: "VariableDeclarator",
						start: 6,
						end: exportStart - 2,
						id: { type: "Identifier", start: 6, end: 27, name: "__fast_cdn_export_0_0" },
					},
				],
			},
			{
				type: "ExportNamedDeclaration",
				start: exportStart,
				end: code.length,
				source: { value: "constructor" },
				specifiers: [{ type: "ExportSpecifier", local: { name: "ref" }, exported: { name: "value" } }],
			},
		],
	};

	const result = transform(plugin, code, program);
	assert.match(result.code, /const __fast_cdn_export_0_0_1 =/);
	assert.match(result.code, /export \{ __fast_cdn_export_0_0_1 as value \}/);
});

test("CDN plugin rejects invalid global names through its public configuration", async () => {
	const plugin = cdnImport({ modules: { name: "vue", global: "window.alert()", version: "3.5.0", js: "vue.js" } });
	plugin.config({}, environment);
	await assert.rejects(plugin.configResolved({ command: "build", root: process.cwd() }), /Invalid browser global variable/);
});

test("CDN plugin rejects invalid runtime module configuration", async () => {
	assert.throws(() => cdnImport({ modules: undefined }), /modules/);
	await assert.rejects(configure({ modules: null }), /Module configuration must be an object/);
});
