import { constants } from "node:fs";
import { access, copyFile, cp, lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPathInside, isSafeOutputFileName } from "../shared/fileSystem";
import type { Plugin, ResolvedConfig } from "vite";
import type { StaticCopyPluginOptions, StaticCopyTarget } from "./type";

export type { StaticCopyPluginOptions, StaticCopyTarget } from "./type";

/**
 * 复制静态文件或目录，并将目标限制在当前 `outDir`。
 *
 * 源路径和目标路径都按 symlink/junction 边界检查；目标之间不能相同或互相包含。
 *
 * @param root - Vite 项目根目录的绝对路径。
 * @param outDir - 当前 output 的绝对目录。
 * @param targets - 要复制或转换的目标。
 * @param missing - 源不存在时的处理策略。
 * @param onWarning - `missing: "warn"` 时接收诊断信息的回调。
 * @returns 所有目标处理完成后解决的 Promise。
 */
async function copyTargets(
	root: string,
	outDir: string,
	targets: readonly StaticCopyTarget[],
	missing: NonNullable<StaticCopyPluginOptions["missing"]> = "error",
	onWarning: (message: string) => void = () => undefined
): Promise<void> {
	if (targets.length === 0) throw new Error("[fast-vite:static-copy] targets must contain at least one copy target.");
	const configuredMissing: unknown = missing;
	if (configuredMissing !== "error" && configuredMissing !== "warn" && configuredMissing !== "ignore") {
		throw new Error("[fast-vite:static-copy] missing must be error, warn, or ignore.");
	}
	await assertNoSymlinkInPath(path.parse(outDir).root, outDir, "Destination path");
	const destinations = new Set<string>();
	for (const target of targets) {
		if (!target.src.trim() || !target.dest.trim()) throw new Error("[fast-vite:static-copy] src and dest must not be empty paths.");
		if (!isSafeOutputFileName(target.dest)) throw new Error(`[fast-vite:static-copy] dest must be a valid build output name: ${target.dest}`);
		const source = path.resolve(root, target.src);
		const destination = path.resolve(outDir, target.dest);
		if (!isPathInside(outDir, destination)) throw new Error(`[fast-vite:static-copy] Destination must be within outDir: ${target.dest}`);
		if (isPathInside(source, destination) || isPathInside(destination, source)) {
			throw new Error(
				`[fast-vite:static-copy] Source and destination must not be identical or contain one another: ${target.src} -> ${target.dest}`
			);
		}
		const destinationKey = comparablePath(destination);
		if (destinations.has(destinationKey)) {
			throw new Error(`[fast-vite:static-copy] Multiple targets would overwrite the same path: ${target.dest}`);
		}
		for (const configuredDestination of destinations) {
			if (isPathInside(configuredDestination, destinationKey) || isPathInside(destinationKey, configuredDestination)) {
				throw new Error(`[fast-vite:static-copy] Destinations must not be identical or contain one another: ${target.dest}`);
			}
		}
		destinations.add(destinationKey);

		try {
			await access(source);
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			const message = `[fast-vite:static-copy] Source path does not exist: ${source}`;
			if (missing === "error") throw new Error(message, { cause: error });
			if (missing === "warn") onWarning(message);
			continue;
		}

		const sourceBoundary = isPathInside(root, source) ? root : path.parse(source).root;
		await assertNoSymlinkInPath(sourceBoundary, source, "Source path");
		const existingDestinationParent = await nearestExistingDirectory(path.dirname(destination));
		await assertNoSymlinkInPath(outDir, existingDestinationParent, "Destination path");

		const sourceStat = await stat(source);
		const overwrite = target.overwrite ?? true;
		if (sourceStat.isDirectory()) {
			if (target.transform) throw new Error(`[fast-vite:static-copy] transform is not supported for directory targets: ${target.src}`);
			await mkdir(path.dirname(destination), { recursive: true });
			await cp(source, destination, { errorOnExist: !overwrite, force: overwrite, recursive: true });
			continue;
		}
		if (!sourceStat.isFile()) throw new Error(`[fast-vite:static-copy] Only regular files and directories are supported: ${source}`);

		await mkdir(path.dirname(destination), { recursive: true });
		if (target.transform) {
			const transformed = await target.transform(await readFile(source), source);
			await writeFile(destination, transformed, { flag: overwrite ? "w" : "wx" });
		} else {
			await copyFile(source, destination, overwrite ? 0 : constants.COPYFILE_EXCL);
		}
	}
}

/**
 * 在 Vite 写出构建产物后复制许可证、robots.txt 或其他静态目录。
 *
 * @param options - 复制目标及源路径缺失时的处理方式。
 * @returns 可直接加入 Vite `plugins` 的静态复制插件。
 * @throws 目标为空、路径重叠、symlink/junction、覆盖或多 output 冲突时抛出异常。
 */
export function staticCopy(options: StaticCopyPluginOptions): Plugin {
	const configuredTargets: unknown = options.targets;
	if (!Array.isArray(configuredTargets)) throw new Error("[fast-vite:static-copy] targets must be an array.");
	if (options.targets.length === 0) throw new Error("[fast-vite:static-copy] targets must contain at least one copy target.");
	for (const target of options.targets) {
		const configuredTarget: unknown = target;
		if (typeof configuredTarget !== "object" || configuredTarget === null || Array.isArray(configuredTarget)) {
			throw new Error("[fast-vite:static-copy] Each target must contain string src and dest properties.");
		}
		const targetRecord = configuredTarget as Record<string, unknown>;
		if (typeof targetRecord.src !== "string" || typeof targetRecord.dest !== "string") {
			throw new Error("[fast-vite:static-copy] Each target must contain string src and dest properties.");
		}
		if (!target.src.trim() || !isSafeOutputFileName(target.dest)) {
			throw new Error("[fast-vite:static-copy] src must not be empty, and dest must be a valid build output name.");
		}
	}
	const configuredMissing: unknown = options.missing;
	if (configuredMissing !== undefined && configuredMissing !== "error" && configuredMissing !== "warn" && configuredMissing !== "ignore") {
		throw new Error("[fast-vite:static-copy] missing must be error, warn, or ignore.");
	}
	let config: ResolvedConfig;
	const copiedOutputDirectories = new Set<string>();

	return {
		name: "fast-vite:static-copy",
		apply: "build",
		configResolved(resolvedConfig): void {
			config = resolvedConfig;
		},
		buildStart(): void {
			copiedOutputDirectories.clear();
		},
		async writeBundle(outputOptions): Promise<void> {
			const configuredOutDir = outputOptions.dir ?? (outputOptions.file ? path.dirname(outputOptions.file) : config.build.outDir);
			const outDir = path.resolve(config.root, configuredOutDir);
			const key = comparablePath(outDir);
			if (copiedOutputDirectories.has(key)) return;
			copiedOutputDirectories.add(key);
			await copyTargets(config.root, outDir, options.targets, options.missing, (message) => config.logger.warn(message));
		},
	};
}

async function nearestExistingDirectory(directory: string): Promise<string> {
	let current = directory;
	for (;;) {
		try {
			if ((await stat(current)).isDirectory()) return current;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		const parent = path.dirname(current);
		if (parent === current) return current;
		current = parent;
	}
}

function comparablePath(filePath: string): string {
	const resolved = path.resolve(filePath);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function assertNoSymlinkInPath(base: string, candidate: string, label: string): Promise<void> {
	const relativePath = path.relative(path.resolve(base), path.resolve(candidate));
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		throw new Error(`[fast-vite:static-copy] ${label} is outside the allowed boundary: ${candidate}`);
	}
	let current = path.resolve(base);
	for (const segment of relativePath.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		try {
			if ((await lstat(current)).isSymbolicLink()) {
				throw new Error(`[fast-vite:static-copy] ${label} must not pass through a symlink or junction: ${candidate}`);
			}
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
			throw error;
		}
	}
}
