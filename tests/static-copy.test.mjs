import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { staticCopy } from "../dist/index.mjs";

test("static copy transforms files and blocks destinations outside outDir", async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), "fast-vite-plugins-"));
	const sourceFile = path.join(temporaryRoot, "source.txt");
	const outDir = path.join(temporaryRoot, "dist");
	const destinationDirectory = path.join(outDir, "meta");
	const destinationFile = path.join(destinationDirectory, "copied.txt");
	await writeFile(sourceFile, "hello", "utf8");
	await mkdir(outDir);

	try {
		const plugin = staticCopy({
			targets: [{ src: "source.txt", dest: "meta/copied.txt", transform: (content) => content.toString("utf8").toUpperCase() }],
		});
		plugin.configResolved({ build: { outDir: "dist" }, logger: { warn: assert.fail }, root: temporaryRoot });
		plugin.buildStart();
		await plugin.writeBundle({ dir: outDir });
		assert.equal(await readFile(destinationFile, "utf8"), "HELLO");
		assert.throws(() => staticCopy({ targets: [{ src: "source.txt", dest: "../escape.txt" }] }), /build output/);
		assert.throws(() => staticCopy({ targets: null }), /targets/);
		assert.throws(() => staticCopy({ targets: [null] }), /Each target/);
		assert.throws(() => staticCopy({ targets: [{ src: "source.txt", dest: "copied.txt" }], missing: "" }), /missing/);
	} finally {
		await unlink(destinationFile);
		await unlink(sourceFile);
		await rmdir(destinationDirectory);
		await rmdir(outDir);
		await rmdir(temporaryRoot);
	}
});

test("static copy runs once when multiple outputs share the same directory", async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), "fast-vite-plugins-multi-"));
	const sourceFile = path.join(temporaryRoot, "source.txt");
	const outDir = path.join(temporaryRoot, "dist");
	const destinationFile = path.join(outDir, "copied.txt");
	await writeFile(sourceFile, "hello", "utf8");
	await mkdir(outDir);
	let transforms = 0;
	const plugin = staticCopy({
		targets: [
			{
				src: "source.txt",
				dest: "copied.txt",
				transform(content) {
					transforms += 1;
					return content;
				},
			},
		],
	});
	plugin.configResolved({ build: { outDir: "dist" }, logger: { warn: assert.fail }, root: temporaryRoot });
	plugin.buildStart();
	await plugin.writeBundle({ dir: outDir });
	await plugin.writeBundle({ dir: outDir });
	assert.equal(transforms, 1);

	await unlink(destinationFile);
	await unlink(sourceFile);
	await rmdir(outDir);
	await rmdir(temporaryRoot);
});
