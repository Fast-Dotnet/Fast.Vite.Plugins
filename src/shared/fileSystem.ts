import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareStrings } from "./naming";

/**
 * 将 Windows 路径转换成 Vite 与源码导入统一使用的正斜杠路径。
 *
 * @param filePath - 任意平台文件路径。
 * @returns 使用 `/` 分隔的路径。
 */
export function normalizePath(filePath: string): string {
	return filePath.replaceAll("\\", "/");
}

/**
 * 生成统一的 TypeScript 文件头，标明负责生成该文件的公开插件方法。
 *
 * @param method - 生成文件的插件方法名。
 * @returns 以空行结尾的中文 `@generated` 文件头。
 */
export function generatedFileHeader(method: string): string {
	return `/**\n * @generated 由 fast-vite-plugins 的 \`${method}\` 方法自动生成。\n *\n * 请勿手动编辑，重新运行生成器时所有修改都会被覆盖。\n */\n\n`;
}

/**
 * 规范化扩展名，调用方既可以传入 `vue`，也可以传入 `.vue`。
 *
 * @param extensions - 允许的文件扩展名。
 * @returns 去点号、转小写且去重后的只读集合。
 */
export function normalizeExtensions(extensions: readonly string[]): ReadonlySet<string> {
	if (!Array.isArray(extensions)) throw new TypeError("extensions 必须是字符串数组。");
	const normalized = extensions.map((extension) => {
		if (typeof extension !== "string" || !/^\.?[a-z\d]+$/i.test(extension)) {
			throw new Error(`非法文件扩展名：${String(extension)}`);
		}
		return extension.replace(/^\./, "").toLowerCase();
	});
	return new Set(normalized);
}

/**
 * 判断文件是否具有允许的扩展名。
 *
 * @param filePath - 要检查的文件路径。
 * @param extensions - 已规范化的扩展名集合。
 * @returns 扩展名命中集合时返回 `true`。
 */
export function hasExtension(filePath: string, extensions: ReadonlySet<string>): boolean {
	return extensions.has(path.extname(filePath).slice(1).toLowerCase());
}

/**
 * 判断 candidate 是否等于 parent 或位于 parent 内，避免简单字符串前缀造成误判。
 *
 * @param parent - 允许的父目录边界。
 * @param candidate - 待检查的目标路径。
 * @returns 目标等于父目录或位于其内部时返回 `true`。
 */
export function isPathInside(parent: string, candidate: string): boolean {
	const relativePath = path.relative(path.resolve(parent), path.resolve(candidate));
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/**
 * 判断文件名是否是非空、不会越出构建输出目录的相对路径。
 *
 * @param fileName - 构建产物中的相对文件名。
 * @returns 路径非空、非绝对且不包含 `..` 片段时返回 `true`。
 */
export function isSafeOutputFileName(fileName: string): boolean {
	const normalized = normalizePath(fileName);
	const segments = normalized.split("/");
	return (
		Boolean(normalized) &&
		normalized !== "." &&
		!normalized.endsWith("/") &&
		!normalized.startsWith("/") &&
		!/^[a-z]:\//i.test(normalized) &&
		segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
	);
}

/**
 * 将配置路径解析为基准目录内的绝对路径，并拒绝 `..` 或绝对路径造成的越界。
 *
 * @param base - 允许写入的目录边界。
 * @param configuredPath - 用户配置的相对路径或边界内绝对路径。
 * @param feature - 用于错误信息的插件名称。
 * @returns 位于边界内的规范化绝对路径。
 * @throws 目标越出基准目录时抛出异常。
 */
export function resolvePathInside(base: string, configuredPath: string, feature: string): string {
	if (!isSafeOutputFileName(configuredPath)) {
		throw new Error(`[fast-vite:${feature}] 输出路径必须位于 Vite root 内且是安全相对文件路径：${configuredPath}`);
	}
	const resolved = path.resolve(base, configuredPath);
	if (!isPathInside(base, resolved)) {
		throw new Error(`[fast-vite:${feature}] 输出路径必须位于 Vite root 内：${configuredPath}`);
	}
	return resolved;
}

/** 稳定文件扫描器的目录深度与过滤选项 */
export interface ScanFilesOptions {
	/** 是否递归扫描子目录 @defaultValue `true` */
	deep?: boolean;
	/** 返回 `false` 时排除当前绝对路径。 */
	filter?: (absolutePath: string) => boolean;
}

/**
 * 以稳定顺序扫描目录。目录不存在时返回空数组，让插件可以生成空结果并清理陈旧内容。
 *
 * @param directory - 要扫描的绝对目录路径。
 * @param options - 递归深度与文件过滤器。
 * @returns 按路径稳定排序的绝对文件路径。
 */
export async function scanFiles(directory: string, options: ScanFilesOptions = {}): Promise<string[]> {
	const { deep = true, filter = (): boolean => true } = options;
	let entries;

	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return [];
		throw error;
	}

	const files: string[] = [];
	for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (deep) files.push(...(await scanFiles(absolutePath, options)));
			continue;
		}

		if (entry.isFile() && filter(absolutePath)) files.push(absolutePath);
	}

	return files;
}

/**
 * 仅在内容变化时写文件，减少无意义的 HMR、构建缓存失效与 Git diff。
 *
 * @param filePath - 目标文件绝对路径。
 * @param content - 要写入的 UTF-8 文本或字节内容。
 * @returns 实际写入时返回 `true`，内容未变化时返回 `false`。
 */
export async function writeFileIfChanged(filePath: string, content: string | Uint8Array): Promise<boolean> {
	await assertNoSymbolicLinks(filePath);
	let current: Buffer | undefined;
	try {
		current = await readFile(filePath);
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ENOENT") throw error;
	}

	const next = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
	if (current?.equals(next)) return false;

	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, next);
	return true;
}

async function assertNoSymbolicLinks(filePath: string): Promise<void> {
	const resolved = path.resolve(filePath);
	const root = path.parse(resolved).root;
	let current = root;
	for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		try {
			if ((await lstat(current)).isSymbolicLink()) {
				throw new Error(`拒绝通过 symlink 或 junction 写入生成文件：${filePath}`);
			}
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
			throw error;
		}
	}
}

/**
 * 生成相对于某个输出文件的 ESM 导入路径。
 *
 * @param fromFile - 生成模块的绝对文件路径。
 * @param targetFile - 被导入文件的绝对路径。
 * @returns 使用 `/` 且带 `./` 或 `../` 前缀的相对导入路径。
 */
export function relativeImportPath(fromFile: string, targetFile: string): string {
	const relativePath = normalizePath(path.relative(path.dirname(fromFile), targetFile));
	return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

/**
 * 将未知异常转换为可展示的错误文本。
 *
 * @param error - 任意捕获值。
 * @returns Error 的 message 或安全字符串表示。
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
