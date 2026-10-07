import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { componentRegistry, routerMeta, svgIcons } from "../dist/index.mjs";

const workspaceRoot = process.cwd();

function configure(plugin, root, logger = { error: assert.fail, warn: assert.fail }) {
	plugin.configResolved({ logger, root });
	return plugin;
}

test("component, router and SVG generators expose their behavior through plugin hooks", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "fast-vite-generators-"));
	const componentsDirectory = path.join(root, "components");
	const formDirectory = path.join(componentsDirectory, "form");
	const viewsDirectory = path.join(root, "views");
	const iconsDirectory = path.join(root, "icons");
	const emptyIconsDirectory = path.join(root, "empty-icons");
	await mkdir(formDirectory, { recursive: true });
	await mkdir(viewsDirectory);
	await mkdir(iconsDirectory);
	await mkdir(emptyIconsDirectory);
	await writeFile(path.join(componentsDirectory, "base-button.vue"), "<template><button /></template>");
	await writeFile(path.join(formDirectory, "index.vue"), "<template><form /></template>");
	await writeFile(
		path.join(componentsDirectory, "fast-table.tsx"),
		'import { defineComponent } from "vue"; export default defineComponent({ name: "FastTable", render: () => null });'
	);
	await writeFile(
		path.join(componentsDirectory, "generic-list.vue"),
		'<script setup lang="ts" generic="T">defineOptions({ name: "GenericList" });</script>'
	);
	await writeFile(path.join(componentsDirectory, "plain-card.tsx"), "// defineComponent({ name: 'Ignored' })\nexport default () => null;");
	await writeFile(
		path.join(componentsDirectory, "unnamed-table.tsx"),
		'import { defineComponent } from "vue"; export default defineComponent({ render: () => null });'
	);
	await writeFile(
		path.join(viewsDirectory, "home.vue"),
		String.raw`// defineOptions({ name: "CommentName" })
defineOptions({ title: "name: \"StringName\"", nested: { name: "NestedName" }, name: "HomePage" });`
	);
	await writeFile(
		path.join(viewsDirectory, "plain.vue"),
		'// defineOptions({ name: "CommentName" })\ndefineOptions({ enabled: true }); const later = { name: "LaterName" };'
	);
	const longPathData = `M${"1 1 ".repeat(45).trim()}`;
	await writeFile(path.join(iconsDirectory, "add.svg"), `<svg width="24" height="24"><path d="${longPathData}" fill="currentColor" /></svg>`);
	await writeFile(path.join(iconsDirectory, "remove.svg"), '<svg viewBox="0 0 24 24"><path stroke="currentColor" /></svg>');

	const registryFile = path.join(root, "generated/components.ts");
	const customRegistryFile = path.join(root, "generated/custom-components.ts");
	const declarationsFile = path.join(root, "generated/components.d.ts");
	const routesFile = path.join(root, "generated/routes.json");
	const iconsFile = path.join(root, "generated/icons.ts");
	const iconComponentDirectory = path.join(root, "generated/add");
	const iconComponentFile = path.join(iconComponentDirectory, "index.tsx");
	const removeIconComponentDirectory = path.join(root, "generated/remove");
	const removeIconComponentFile = path.join(removeIconComponentDirectory, "index.tsx");
	const emptyIconsFile = path.join(root, "generated/empty-icons.ts");
	const warnings = [];
	try {
		await configure(componentRegistry({ dirs: "components", output: "generated/components.ts", dts: "generated/components.d.ts" }), root, {
			error: assert.fail,
			warn: (message) => warnings.push(message),
		}).buildStart();
		const registry = await readFile(registryFile, "utf8");
		const declarations = await readFile(declarationsFile, "utf8");
		assert.match(registry, /@generated 由 fast-vite-plugins 的 `componentRegistry` 方法自动生成。/);
		assert.match(registry, /\*\/\n\nimport BaseButton/);
		assert.doesNotMatch(registry, /\.name\s*\?\?|if \(BaseButton\.name\)|console\.warn|export const components|eslint-disable|prettier-ignore/);
		assert.match(registry, /import type \{ App \} from "vue";/);
		assert.doesNotMatch(registry, /Definition|readonly name: string/);
		assert.match(registry, /export function registerComponents\(app: App\): void/);
		assert.match(registry, /app\.component\(BaseButton\.name, BaseButton\);/);
		assert.match(registry, /export \{ BaseButton \}/);
		assert.match(registry, /export type BaseButtonInstance = InstanceType<typeof BaseButton>/);
		assert.match(registry, /export type FastTableInstance = InstanceType<typeof FastTable>/);
		assert.match(registry, /export type FormInstance = InstanceType<typeof Form>/);
		assert.match(registry, /export type GenericListInstance = InstanceType<typeof GenericList>/);
		assert.match(registry, /export type PlainCardInstance = InstanceType<typeof PlainCard>/);
		assert.match(registry, /export type UnnamedTableInstance = InstanceType<typeof UnnamedTable>/);
		assert.doesNotMatch(registry, /@ts-nocheck/);
		assert.equal(warnings.length, 3);
		assert.ok(warnings.some((message) => /base-button\.vue/.test(message)));
		assert.ok(warnings.some((message) => /form\/index\.vue/.test(message)));
		assert.ok(warnings.some((message) => /unnamed-table\.tsx/.test(message)));
		assert.match(declarations, /@generated 由 fast-vite-plugins 的 `componentRegistry` 方法自动生成。/);
		assert.doesNotMatch(declarations, /eslint-disable|prettier-ignore/);
		assert.match(declarations, /declare module "vue"/);
		assert.match(declarations, /BaseButton:/);

		await configure(
			componentRegistry({
				dirs: "components",
				output: "generated/custom-components.ts",
				dts: false,
				name: ({ defaultName }) => {
					if (defaultName === "BaseButton") return "ZBaseButton";
					if (defaultName === "FastTable") return "AFastTable";
					return defaultName;
				},
			}),
			root,
			{ error: assert.fail, warn: () => undefined }
		).buildStart();
		const customRegistry = await readFile(customRegistryFile, "utf8");
		assert.ok(
			customRegistry.indexOf('import ZBaseButton from "../components/base-button.vue";') <
				customRegistry.indexOf('import AFastTable from "../components/fast-table.tsx";')
		);
		assert.ok(
			customRegistry.indexOf('import UnnamedTable from "../components/unnamed-table.tsx";') <
				customRegistry.indexOf('import type { App } from "vue";')
		);
		assert.match(customRegistry, /registerComponents/);
		assert.doesNotMatch(customRegistry, /\.name\s*\?\?|export const components/);

		await configure(routerMeta({ dir: "views", output: "generated/routes.json" }), root).buildStart();
		assert.deepEqual(JSON.parse(await readFile(routesFile, "utf8")), {
			"/views/home.vue": "HomePage",
			"/views/plain.vue": "Plain",
		});

		await configure(svgIcons({ dir: "icons", output: "generated/icons.ts", removeDimensions: true }), root).buildStart();
		const iconIndex = await readFile(iconsFile, "utf8");
		const iconComponent = await readFile(iconComponentFile, "utf8");
		assert.match(iconIndex, /@generated 由 fast-vite-plugins 的 `svgIcons` 方法自动生成。/);
		assert.match(iconIndex, /\*\/\n\nimport Add from "\.\/add\/index";/);
		assert.match(iconIndex, /export \{ Add \};\nexport \{ Remove \};\n\nexport default \{\n\tAdd,\n\tRemove,\n\} as const;/);
		assert.doesNotMatch(iconIndex, /export const icons|defineComponent|eslint-disable|prettier-ignore/);
		assert.match(iconComponent, /@generated 由 fast-vite-plugins 的 `svgIcons` 方法自动生成。/);
		assert.match(iconComponent, /import \{ defineComponent \} from "vue";/);
		assert.match(iconComponent, /\*\*\n \* Add 图标组件。\n \*\//);
		assert.match(iconComponent, /export const Add/);
		assert.match(iconComponent, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24">/);
		assert.match(iconComponent, /<path\n\t+d="M1 1/);
		assert.match(iconComponent, /\n\t+fill="currentColor"\n\t+\/>/);
		assert.doesNotMatch(iconComponent, /width=/);
		assert.doesNotMatch(iconComponent, /\bh\(|innerHTML/);
		assert.match(iconComponent, /export default Add/);
		assert.doesNotMatch(iconComponent, /eslint-disable|prettier-ignore/);

		await configure(svgIcons({ dir: "empty-icons", output: "generated/empty-icons.ts" }), root).buildStart();
		const emptyIconIndex = await readFile(emptyIconsFile, "utf8");
		assert.match(emptyIconIndex, /\*\/\n\nexport default \{\} as const;\n$/);
		assert.doesNotMatch(emptyIconIndex, /eslint-disable|prettier-ignore/);
	} finally {
		await unlink(registryFile);
		await unlink(customRegistryFile);
		await unlink(declarationsFile);
		await unlink(routesFile);
		await unlink(iconsFile);
		await unlink(iconComponentFile);
		await unlink(removeIconComponentFile);
		await unlink(emptyIconsFile);
		await unlink(path.join(componentsDirectory, "base-button.vue"));
		await unlink(path.join(componentsDirectory, "fast-table.tsx"));
		await unlink(path.join(componentsDirectory, "generic-list.vue"));
		await unlink(path.join(componentsDirectory, "plain-card.tsx"));
		await unlink(path.join(componentsDirectory, "unnamed-table.tsx"));
		await unlink(path.join(formDirectory, "index.vue"));
		await unlink(path.join(viewsDirectory, "home.vue"));
		await unlink(path.join(viewsDirectory, "plain.vue"));
		await unlink(path.join(iconsDirectory, "add.svg"));
		await unlink(path.join(iconsDirectory, "remove.svg"));
		await rmdir(formDirectory);
		await rmdir(componentsDirectory);
		await rmdir(viewsDirectory);
		await rmdir(iconsDirectory);
		await rmdir(emptyIconsDirectory);
		await rmdir(iconComponentDirectory);
		await rmdir(removeIconComponentDirectory);
		await rmdir(path.join(root, "generated"));
		await rmdir(root);
	}
});

test("generator plugins reject conflicts, unsupported outputs and paths outside root", async () => {
	assert.throws(() => componentRegistry({ conflict: "" }), /conflict/);
	assert.throws(() => componentRegistry({ output: "types/components.d.ts", dts: "types/components.d.ts" }), /must not refer to the same file/);
	assert.throws(() => componentRegistry({ output: "src/components.js" }), /TypeScript/);
	assert.throws(() => componentRegistry({ dts: "types/components.ts" }), /\.d\.ts/);
	assert.throws(() => svgIcons({ output: "src/icons.js" }), /TypeScript/);

	const componentPlugin = configure(componentRegistry({ dirs: "tests/fixtures/components", output: "../components.ts" }), workspaceRoot);
	await assert.rejects(componentPlugin.buildStart(), /must be (?:a safe relative file path )?within Vite root/);
	const routerPlugin = configure(routerMeta({ dir: "tests/fixtures/views", output: "../routes.json" }), workspaceRoot);
	await assert.rejects(routerPlugin.buildStart(), /must be (?:a safe relative file path )?within Vite root/);

	const duplicatePlugin = configure(
		componentRegistry({ dirs: "tests/fixtures/components", output: "duplicate.generated.ts", dts: false, name: () => "Duplicate" }),
		workspaceRoot,
		{ error: assert.fail, warn: () => undefined }
	);
	await assert.rejects(duplicatePlugin.buildStart(), /Conflicting component name/);
});

test("generator watchers clean up when a middleware-mode server closes", () => {
	class FakeWatcher extends EventEmitter {
		add() {}
	}
	for (const plugin of [componentRegistry(), routerMeta(), svgIcons()]) {
		const watcher = new FakeWatcher();
		plugin.configResolved({ logger: { error: assert.fail }, root: workspaceRoot });
		plugin.configureServer({ httpServer: null, watcher });
		assert.ok(watcher.listenerCount("all") > 0);
		watcher.emit("close");
		assert.equal(watcher.listenerCount("all"), 0);
	}
});
