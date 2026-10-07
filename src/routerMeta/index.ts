import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	errorMessage,
	hasExtension,
	isPathInside,
	normalizeExtensions,
	normalizePath,
	resolvePathInside,
	scanFiles,
	writeFileIfChanged,
} from "../shared/fileSystem";
import { compareStrings, toPascalCase } from "../shared/naming";
import { createDebouncedTask, onServerClose } from "../shared/plugin";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type { RouterMetaContext, RouterMetaMap, RouterMetaPluginOptions } from "./type";

export type { RouterMetaContext, RouterMetaPluginOptions } from "./type";

const DEFAULT_EXTENSIONS = ["vue", "tsx", "jsx"] as const;

interface ResolvedOptions {
	debounce: number;
	deep: boolean;
	dir: string;
	extensions: ReadonlySet<string>;
	include: RouterMetaPluginOptions["include"];
	indent: number;
	key: RouterMetaPluginOptions["key"];
	name: RouterMetaPluginOptions["name"];
	output: string;
}

/**
 * 从 `defineOptions()` 的顶层对象中读取静态组件名。
 *
 * 扫描会跳过注释、字符串、模板字符串和嵌套对象；动态表达式返回 `undefined`。
 *
 * @param source - Vue 或 TypeScript 页面源码。
 * @returns 可静态确定的组件名；未找到时返回 `undefined`。
 */
function extractComponentName(source: string): string | undefined {
	let index = 0;
	while (index < source.length) {
		index = skipTrivia(source, index);
		const skipped = skipQuoted(source, index);
		if (skipped !== index) {
			index = skipped;
			continue;
		}
		if (!source.startsWith("defineOptions", index) || isIdentifierCharacter(source[index - 1]) || isIdentifierCharacter(source[index + 13])) {
			index += 1;
			continue;
		}

		let cursor = skipTrivia(source, index + 13);
		if (source[cursor] === "<") {
			cursor = skipBalanced(source, cursor, "<", ">");
			cursor = skipTrivia(source, cursor);
		}
		if (source[cursor] !== "(") {
			index += 13;
			continue;
		}
		cursor = skipTrivia(source, cursor + 1);
		if (source[cursor] !== "{") {
			index += 13;
			continue;
		}
		const name = readTopLevelName(source, cursor);
		if (name !== undefined) return name;
		index = cursor + 1;
	}
	return undefined;
}

function readTopLevelName(source: string, objectStart: number): string | undefined {
	let braceDepth = 1;
	let bracketDepth = 0;
	let parenthesisDepth = 0;
	let index = objectStart + 1;
	while (index < source.length && braceDepth > 0) {
		index = skipTrivia(source, index);
		if (braceDepth === 1 && bracketDepth === 0 && parenthesisDepth === 0) {
			const property = readPropertyName(source, index);
			if (property) {
				let cursor = skipTrivia(source, property.end);
				if (source[cursor] === "?" && source[cursor + 1] !== "?") cursor = skipTrivia(source, cursor + 1);
				if (source[cursor] === ":" && property.name === "name") {
					cursor = skipTrivia(source, cursor + 1);
					const value = readStaticString(source, cursor);
					if (value) return value.value;
				}
			}
		}

		const quotedEnd = skipQuoted(source, index);
		if (quotedEnd !== index) {
			index = quotedEnd;
			continue;
		}
		const character = source.at(index);
		if (character === undefined) return undefined;
		switch (character) {
			case "{":
				braceDepth += 1;
				break;
			case "}":
				braceDepth -= 1;
				break;
			case "[":
				bracketDepth += 1;
				break;
			case "]":
				bracketDepth = Math.max(0, bracketDepth - 1);
				break;
			case "(":
				parenthesisDepth += 1;
				break;
			case ")":
				parenthesisDepth = Math.max(0, parenthesisDepth - 1);
				break;
		}
		index += 1;
	}
	return undefined;
}

function readPropertyName(source: string, index: number): { end: number; name: string } | undefined {
	const string = readStaticString(source, index);
	if (string) return { end: string.end, name: string.value };
	if (!isIdentifierStart(source[index])) return undefined;
	let end = index + 1;
	while (isIdentifierCharacter(source[end])) end += 1;
	return { end, name: source.slice(index, end) };
}

function readStaticString(source: string, index: number): { end: number; value: string } | undefined {
	const quote = source[index];
	if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
	let value = "";
	for (let cursor = index + 1; cursor < source.length; cursor += 1) {
		const character = source.at(cursor);
		if (character === undefined) return undefined;
		if (character === "\\") {
			const escaped = source.at(cursor + 1);
			if (escaped === undefined) return undefined;
			value += escaped;
			cursor += 1;
			continue;
		}
		if (quote === "`" && character === "$" && source[cursor + 1] === "{") return undefined;
		if (character === quote) return { end: cursor + 1, value };
		value += character;
	}
	return undefined;
}

function skipTrivia(source: string, start: number): number {
	let index = start;
	while (index < source.length) {
		if (/\s/u.test(source[index] ?? "")) {
			index += 1;
			continue;
		}
		if (source.startsWith("//", index)) {
			const end = source.indexOf("\n", index + 2);
			index = end < 0 ? source.length : end + 1;
			continue;
		}
		if (source.startsWith("/*", index)) {
			const end = source.indexOf("*/", index + 2);
			index = end < 0 ? source.length : end + 2;
			continue;
		}
		break;
	}
	return index;
}

function skipQuoted(source: string, index: number): number {
	const quote = source[index];
	if (quote !== '"' && quote !== "'" && quote !== "`") return index;
	for (let cursor = index + 1; cursor < source.length; cursor += 1) {
		if (source[cursor] === "\\") cursor += 1;
		else if (source[cursor] === quote) return cursor + 1;
	}
	return source.length;
}

function skipBalanced(source: string, start: number, open: string, close: string): number {
	let depth = 0;
	let index = start;
	while (index < source.length) {
		index = skipTrivia(source, index);
		const quotedEnd = skipQuoted(source, index);
		if (quotedEnd !== index) {
			index = quotedEnd;
			continue;
		}
		if (source[index] === open) depth += 1;
		else if (source[index] === close && --depth === 0) return index + 1;
		index += 1;
	}
	return source.length;
}

function isIdentifierStart(value: string | undefined): boolean {
	return value !== undefined && /^[$_\p{ID_Start}]$/u.test(value);
}

function isIdentifierCharacter(value: string | undefined): boolean {
	return value !== undefined && /^[$\u200C\u200D\p{ID_Continue}]$/u.test(value);
}

/**
 * 扫描页面文件并生成稳定排序的“文件路径 -> 组件名称”映射。
 *
 * @param root - Vite 项目根目录的绝对路径。
 * @param options - 页面目录、过滤、命名和输出键规则。
 * @returns 按路径键稳定排序的页面名称映射。
 */
async function generateRouterMeta(root: string, options: RouterMetaPluginOptions = {}): Promise<RouterMetaMap> {
	const resolved = resolveOptions(options);
	const directory = path.resolve(root, resolved.dir);
	const outputFile = resolvePathInside(root, resolved.output, "router-meta");
	const files = await scanFiles(directory, {
		deep: resolved.deep,
		filter: (filePath) => path.resolve(filePath) !== outputFile && hasExtension(filePath, resolved.extensions),
	});
	const records: [string, string][] = [];
	const keys = new Set<string>();

	for (const absolutePath of files) {
		const source = await readFile(absolutePath, "utf8");
		const relativePath = normalizePath(path.relative(root, absolutePath));
		const basename = path.basename(absolutePath, path.extname(absolutePath));
		const defaultName = toPascalCase(basename.toLowerCase() === "index" ? path.basename(path.dirname(absolutePath)) : basename);
		const extractedName = extractComponentName(source);
		const context: RouterMetaContext = { absolutePath, defaultName, extractedName, relativePath };

		if (resolved.include && !resolved.include(context)) continue;
		const key = resolved.key?.(context) ?? `/${relativePath}`;
		const name = resolved.name?.(context) ?? extractedName ?? defaultName;
		if (!key) throw new Error(`[fast-vite:router-meta] An empty path key was generated for ${relativePath}.`);
		if (!name) throw new Error(`[fast-vite:router-meta] An empty component name was generated for ${relativePath}.`);
		if (keys.has(key)) throw new Error(`[fast-vite:router-meta] Conflicting path key: ${key}`);
		keys.add(key);
		records.push([key, name]);
	}

	return Object.fromEntries(records.sort(([left], [right]) => compareStrings(left, right)));
}

/**
 * 为路由缓存、KeepAlive 或权限配置生成页面文件路径与稳定组件名的 JSON 映射。
 *
 * @param options - 页面扫描、命名、路径键、JSON 输出和监听配置。
 * @returns 可直接加入 Vite `plugins` 的路由元数据生成插件。
 * @throws 目录、扩展名、输出、数值或生成键冲突时抛出异常。
 */
export function routerMeta(options: RouterMetaPluginOptions = {}): Plugin {
	const resolved = resolveOptions(options);
	let config: ResolvedConfig;

	const generate = async (): Promise<void> => {
		const map = await generateRouterMeta(config.root, options);
		const outputFile = resolvePathInside(config.root, resolved.output, "router-meta");
		await writeFileIfChanged(outputFile, `${JSON.stringify(map, null, resolved.indent)}\n`);
	};

	return {
		name: "fast-vite:router-meta",
		enforce: "post",
		configResolved(resolvedConfig): void {
			config = resolvedConfig;
		},
		async buildStart(): Promise<void> {
			await generate();
		},
		configureServer(server: ViteDevServer): void {
			const directory = path.resolve(config.root, resolved.dir);
			const outputFile = resolvePathInside(config.root, resolved.output, "router-meta");
			server.watcher.add(directory);

			const schedule = createDebouncedTask(generate, resolved.debounce, (error) => {
				config.logger.error(`[fast-vite:router-meta] ${errorMessage(error)}`);
			});
			const handle = (_event: string, file: string): void => {
				if (path.resolve(file) === outputFile || !isPathInside(directory, file)) return;
				if (hasExtension(file, resolved.extensions)) schedule();
			};

			server.watcher.on("all", handle);
			onServerClose(server, () => {
				server.watcher.off("all", handle);
				schedule.cancel();
			});
		},
	};
}

function resolveOptions(options: RouterMetaPluginOptions): ResolvedOptions {
	const extensions = normalizeExtensions(options.extensions ?? DEFAULT_EXTENSIONS);
	if (options.dir !== undefined && !options.dir.trim()) throw new Error("[fast-vite:router-meta] dir must not be an empty path.");
	if (options.output !== undefined && !/\.json$/i.test(options.output)) throw new Error("[fast-vite:router-meta] output must be a .json file.");
	if (extensions.size === 0) throw new Error("[fast-vite:router-meta] extensions must contain at least one extension.");
	if (options.indent !== undefined && (!Number.isInteger(options.indent) || options.indent < 0 || options.indent > 10)) {
		throw new Error("[fast-vite:router-meta] indent must be an integer between 0 and 10.");
	}
	if (options.debounce !== undefined && (!Number.isFinite(options.debounce) || options.debounce < 0)) {
		throw new Error("[fast-vite:router-meta] debounce must be a finite non-negative number.");
	}
	return {
		debounce: options.debounce ?? 80,
		deep: options.deep ?? true,
		dir: options.dir ?? "src/views",
		extensions,
		include: options.include,
		indent: options.indent ?? 2,
		key: options.key,
		name: options.name,
		output: options.output ?? "src/router/routes.generated.json",
	};
}
