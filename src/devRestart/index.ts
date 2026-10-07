import { stat } from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "../shared/fileSystem";
import { createDebouncedTask, onServerClose } from "../shared/plugin";
import type { Plugin } from "vite";
import type { DevRestartContext, DevRestartEvent, DevRestartPluginOptions, ResolvedRestartPath } from "./type";

export type { DevRestartContext, DevRestartEvent, DevRestartPluginOptions } from "./type";

const SUPPORTED_EVENTS = new Set<DevRestartEvent>(["add", "addDir", "change", "unlink", "unlinkDir"]);
const GLOB_PATTERN = /[*?[\]{}!]/;

/**
 * 判断文件是否等于监听目标，或位于一个已确认存在的监听目录内。
 *
 * Windows 上比较不区分大小写；其他平台遵循文件系统通常的大小写语义。
 *
 * @param filePath - Chokidar 报告的绝对文件或目录路径。
 * @param targets - 已解析的精确文件和目录目标。
 * @returns 命中任一精确目标或目录后代时返回 `true`。
 */
function matchesWatchedPath(filePath: string, targets: readonly ResolvedRestartPath[]): boolean {
	const candidate = comparablePath(filePath);
	return targets.some((target) => {
		const watched = comparablePath(target.path);
		if (candidate === watched) return true;
		return target.directory && candidate.startsWith(`${watched}${path.sep}`);
	});
}

/**
 * 在外部配置、代码生成输入或 monorepo 共享文件变化时重启 Vite 开发服务器。
 *
 * Vite 已经原生监听 vite.config 与 `.env`，无需重复配置这些文件。本插件适用于 Vite
 * 模块图之外、但会影响插件初始化结果的文件。生产构建不会注册任何监听器。
 *
 * @param options - 监听路径、防抖、依赖预构建和重启前钩子配置。
 * @returns 仅在开发服务器中生效的 Vite 重启插件。
 * @throws 路径集合、glob 或防抖数值无效时抛出异常。
 */
export function devRestart(options: DevRestartPluginOptions): Plugin {
	const configuredPathsValue: unknown = options.paths;
	if (typeof configuredPathsValue !== "string" && !Array.isArray(configuredPathsValue)) {
		throw new Error("[fast-vite:dev-restart] paths must be a string or an array of strings.");
	}
	const configuredPaths = typeof options.paths === "string" ? [options.paths] : [...options.paths];
	const debounce = options.debounce ?? 100;
	validateOptions(configuredPaths, debounce);
	let dispose: (() => void) | undefined;

	return {
		name: "fast-vite:dev-restart",
		apply: "serve",
		async configureServer(server): Promise<void> {
			const targets = await Promise.all(
				configuredPaths.map(async (configuredPath): Promise<ResolvedRestartPath> => {
					const absolutePath = path.resolve(server.config.root, configuredPath);
					let directory = false;
					try {
						directory = (await stat(absolutePath)).isDirectory();
					} catch (error) {
						if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
					}
					return { path: absolutePath, directory };
				})
			);
			let pending: DevRestartContext | undefined;
			const restart = createDebouncedTask(
				async () => {
					const context = pending;
					pending = undefined;
					if (!context) return;
					await options.beforeRestart?.(context);
					if (options.log ?? true) {
						const relativePath = path.relative(server.config.root, context.file) || path.basename(context.file);
						server.config.logger.info(`[fast-vite:dev-restart] ${context.event}: ${relativePath}，正在重启开发服务器。`);
					}
					await server.restart(options.forceOptimizeDeps ?? false);
				},
				debounce,
				(error) => server.config.logger.error(`[fast-vite:dev-restart] Failed to restart the development server: ${errorMessage(error)}`)
			);
			const handleEvent = (event: string, file: string): void => {
				if (!SUPPORTED_EVENTS.has(event as DevRestartEvent) || !matchesWatchedPath(file, targets)) return;
				pending = { event: event as DevRestartEvent, file: path.resolve(file) };
				restart();
			};

			server.watcher.add(targets.map((target) => target.path));
			server.watcher.on("all", handleEvent);
			dispose = (): void => {
				restart.cancel();
				server.watcher.off("all", handleEvent);
			};
			onServerClose(server, () => {
				dispose?.();
				dispose = undefined;
			});
		},
		buildEnd(): void {
			dispose?.();
			dispose = undefined;
		},
	};
}

function validateOptions(paths: readonly string[], debounce: number): void {
	if (paths.length === 0) throw new Error("[fast-vite:dev-restart] paths must contain at least one file or directory.");
	for (const configuredPath of paths) {
		if (!configuredPath.trim()) throw new Error("[fast-vite:dev-restart] paths must not contain empty paths.");
		if (GLOB_PATTERN.test(configuredPath)) {
			GLOB_PATTERN.lastIndex = 0;
			throw new Error(`[fast-vite:dev-restart] paths does not support glob patterns: ${configuredPath}`);
		}
	}
	if (!Number.isFinite(debounce) || debounce < 0) throw new Error("[fast-vite:dev-restart] debounce must be a finite non-negative number.");
}

function comparablePath(filePath: string): string {
	const normalized = path.resolve(filePath);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
