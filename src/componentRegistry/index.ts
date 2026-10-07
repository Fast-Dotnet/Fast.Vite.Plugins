import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	errorMessage,
	generatedFileHeader,
	hasExtension,
	isPathInside,
	normalizeExtensions,
	normalizePath,
	relativeImportPath,
	resolvePathInside,
	scanFiles,
	writeFileIfChanged,
} from "../shared/fileSystem";
import { compareStrings, isValidBindingIdentifier, toJavaScriptStringLiteral, toPascalCase } from "../shared/naming";
import { createDebouncedTask, onServerClose } from "../shared/plugin";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type { ComponentNameContext, ComponentRegistryPluginOptions, ScannedComponent } from "./type";

export type { ComponentNameContext, ComponentRegistryPluginOptions } from "./type";

const DEFAULT_EXTENSIONS = ["vue", "tsx", "jsx"] as const;

interface ResolvedOptions {
	conflict: NonNullable<ComponentRegistryPluginOptions["conflict"]>;
	debounce: number;
	deep: boolean;
	dirs: readonly string[];
	dts: false | string;
	extensions: ReadonlySet<string>;
	include: ComponentRegistryPluginOptions["include"];
	name: ComponentRegistryPluginOptions["name"];
	output: false | string;
}

type ComponentNameInspection = "configured" | "missing" | "unknown";
type OptionsInspection = "absent" | ComponentNameInspection;

interface ScriptBlock {
	attributes: string;
	source: string;
}

/** 静态检查组件源码中能够明确识别的运行时 `name`。 */
function inspectComponentName(source: string, extension: string): ComponentNameInspection {
	if (extension === ".vue") {
		const scripts = extractScriptBlocks(source);
		if (scripts.length === 0) return "missing";

		const inspections: OptionsInspection[] = [];
		let hasScriptSetup = false;
		for (const script of scripts) {
			if (/(?:^|\s)src\s*=/iu.test(script.attributes)) {
				inspections.push("unknown");
				continue;
			}
			if (/(?:^|\s)setup(?:\s|$)/iu.test(script.attributes)) {
				hasScriptSetup = true;
				const inspection = inspectNamedCalls(script.source, "defineOptions");
				inspections.push(inspection === "absent" ? "missing" : inspection);
			} else {
				inspections.push(inspectDefaultComponentOptions(script.source));
			}
		}

		return combineNameInspections(inspections, hasScriptSetup ? "missing" : "unknown");
	}

	if (extension === ".tsx") {
		const defaultComponent = inspectDefaultComponentOptions(source);
		return defaultComponent === "absent" ? "unknown" : defaultComponent;
	}

	return "unknown";
}

function extractScriptBlocks(source: string): ScriptBlock[] {
	const scripts: ScriptBlock[] = [];
	const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
	for (const match of source.matchAll(pattern)) {
		scripts.push({ attributes: match[1] ?? "", source: match[2] ?? "" });
	}
	return scripts;
}

function inspectDefaultComponentOptions(source: string): OptionsInspection {
	let index = 0;
	while (index < source.length) {
		index = skipTrivia(source, index);
		const quotedEnd = skipQuoted(source, index);
		if (quotedEnd !== index) {
			index = quotedEnd;
			continue;
		}
		if (!matchesIdentifier(source, index, "export")) {
			index += 1;
			continue;
		}

		let cursor = skipTrivia(source, index + 6);
		if (!matchesIdentifier(source, cursor, "default")) {
			index += 6;
			continue;
		}
		cursor = skipTrivia(source, cursor + 7);
		if (source[cursor] === "{") return inspectObjectName(source, cursor);
		if (matchesIdentifier(source, cursor, "defineComponent")) {
			return inspectCallAt(source, cursor, "defineComponent") ?? "unknown";
		}
		return "unknown";
	}
	return "absent";
}

function inspectNamedCalls(source: string, name: string): OptionsInspection {
	const inspections: ComponentNameInspection[] = [];
	let index = 0;
	while (index < source.length) {
		index = skipTrivia(source, index);
		const quotedEnd = skipQuoted(source, index);
		if (quotedEnd !== index) {
			index = quotedEnd;
			continue;
		}
		if (!matchesIdentifier(source, index, name)) {
			index += 1;
			continue;
		}
		const inspection = inspectCallAt(source, index, name);
		if (inspection) inspections.push(inspection);
		index += name.length;
	}
	if (inspections.length === 0) return "absent";
	return combineNameInspections(inspections, "unknown");
}

function inspectCallAt(source: string, index: number, name: string): ComponentNameInspection | undefined {
	let cursor = skipTrivia(source, index + name.length);
	if (source[cursor] === "<") cursor = skipTrivia(source, skipBalanced(source, cursor, "<", ">"));
	if (source[cursor] !== "(") return undefined;
	cursor = skipTrivia(source, cursor + 1);
	return source[cursor] === "{" ? inspectObjectName(source, cursor) : "unknown";
}

function inspectObjectName(source: string, objectStart: number): ComponentNameInspection {
	let braceDepth = 1;
	let bracketDepth = 0;
	let parenthesisDepth = 0;
	let expectProperty = true;
	let uncertain = false;
	let index = objectStart + 1;
	while (index < source.length && braceDepth > 0) {
		index = skipTrivia(source, index);
		if (braceDepth === 1 && bracketDepth === 0 && parenthesisDepth === 0 && expectProperty) {
			if (source.startsWith("...", index) || source[index] === "[") uncertain = true;
			const property = readPropertyName(source, index);
			if (property?.name === "name") return "configured";
			expectProperty = false;
		}

		const quotedEnd = skipQuoted(source, index);
		if (quotedEnd !== index) {
			index = quotedEnd;
			continue;
		}
		const character = source.at(index);
		if (character === undefined) return "unknown";
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
			case ",":
				if (braceDepth === 1 && bracketDepth === 0 && parenthesisDepth === 0) expectProperty = true;
				break;
		}
		index += 1;
	}
	return uncertain || braceDepth !== 0 ? "unknown" : "missing";
}

function combineNameInspections(inspections: readonly OptionsInspection[], fallback: ComponentNameInspection): ComponentNameInspection {
	const relevant = inspections.filter((inspection): inspection is ComponentNameInspection => inspection !== "absent");
	if (relevant.includes("configured")) return "configured";
	if (relevant.includes("unknown")) return "unknown";
	return relevant.length > 0 ? "missing" : fallback;
}

function readPropertyName(source: string, index: number): { name: string } | undefined {
	const string = readStaticString(source, index);
	if (string) return { name: string.value };
	if (!isIdentifierStart(source[index])) return undefined;
	let end = index + 1;
	while (isIdentifierCharacter(source[end])) end += 1;
	return { name: source.slice(index, end) };
}

function readStaticString(source: string, index: number): { value: string } | undefined {
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
		if (character === quote) return { value };
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

function matchesIdentifier(source: string, index: number, value: string): boolean {
	return source.startsWith(value, index) && !isIdentifierCharacter(source[index - 1]) && !isIdentifierCharacter(source[index + value.length]);
}

function isIdentifierStart(value: string | undefined): boolean {
	return value !== undefined && /^[$_\p{ID_Start}]$/u.test(value);
}

function isIdentifierCharacter(value: string | undefined): boolean {
	return value !== undefined && /^[$\u200C\u200D\p{ID_Continue}]$/u.test(value);
}

/**
 * 扫描组件目录并执行名称、扩展名和冲突策略检查。
 *
 * @param root - Vite 项目根目录的绝对路径。
 * @param options - 目录、过滤、命名和冲突策略。
 * @param onWarning - 接收缺少运行时名称及 `conflict: "warn"` 诊断信息的回调。
 * @returns 按最终组件名称排序的组件描述。
 */
async function scanComponents(
	root: string,
	options: ComponentRegistryPluginOptions = {},
	onWarning: (message: string) => void = () => undefined
): Promise<ScannedComponent[]> {
	const resolved = resolveOptions(options);
	const components = new Map<string, ScannedComponent>();
	const visitedFiles = new Set<string>();
	const generatedFiles = new Set(
		[resolved.output, resolved.dts]
			.filter((filePath): filePath is string => Boolean(filePath))
			.map((filePath) => resolvePathInside(root, filePath, "component-registry"))
	);

	for (const configuredDirectory of resolved.dirs) {
		const directory = path.resolve(root, configuredDirectory);
		const files = await scanFiles(directory, {
			deep: resolved.deep,
			filter: (filePath) => hasExtension(filePath, resolved.extensions) && !generatedFiles.has(path.resolve(filePath)),
		});

		for (const absolutePath of files) {
			if (visitedFiles.has(absolutePath)) continue;
			visitedFiles.add(absolutePath);
			const relativePath = normalizePath(path.relative(directory, absolutePath));
			const extension = path.extname(relativePath);
			const pathWithoutExtension = relativePath.slice(0, -extension.length);
			const basename = path.basename(pathWithoutExtension);
			const sourceName = basename.toLowerCase() === "index" ? path.basename(path.dirname(pathWithoutExtension)) : basename;
			const defaultName = toPascalCase(sourceName);
			const context: ComponentNameContext = { absolutePath, defaultName, relativePath };

			if (resolved.include && !resolved.include(context)) continue;

			const name = resolved.name?.(context) ?? defaultName;
			if (!isValidBindingIdentifier(name)) {
				throw new Error(
					`[fast-vite:component-registry] Component name ${JSON.stringify(name)} is not a valid binding identifier for generated code: ${relativePath}`
				);
			}
			const source = await readFile(absolutePath, "utf8");
			if (inspectComponentName(source, extension.toLowerCase()) === "missing") {
				onWarning(
					`[fast-vite:component-registry] The component has no explicit runtime name. Registration code will use the configured name: ${relativePath}`
				);
			}

			const component: ScannedComponent = { ...context, name };
			const previous = components.get(name);
			if (previous && resolved.conflict === "error") {
				throw new Error(
					`[fast-vite:component-registry] Conflicting component name ${JSON.stringify(name)}: ${previous.absolutePath} and ${absolutePath}`
				);
			}
			if (previous && resolved.conflict === "warn") {
				onWarning(
					`[fast-vite:component-registry] Ignoring duplicate component ${JSON.stringify(name)}: ${absolutePath}; already registered from ${previous.absolutePath}`
				);
			}
			if (!previous || resolved.conflict === "overwrite") components.set(name, component);
		}
	}

	return [...components.values()].sort((left, right) => compareStrings(left.name, right.name));
}

/**
 * 生成组件、实例类型与全局注册方法源码。
 *
 * @param outputFile - 生成文件的绝对路径，用于计算稳定的相对导入路径。
 * @param components - 已扫描并完成名称校验的组件描述。
 * @returns 包含命名导出、实例类型和 `registerComponents` 的 TypeScript 源码。
 */
function renderComponentRegistry(outputFile: string, components: readonly ScannedComponent[]): string {
	const lines: string[] = [];
	const componentImports = components
		.map((component) => ({ component, importPath: relativeImportPath(outputFile, component.absolutePath) }))
		.sort((left, right) => {
			const insensitiveOrder = compareStrings(left.importPath.toLowerCase(), right.importPath.toLowerCase());
			return insensitiveOrder || compareStrings(left.importPath, right.importPath);
		});

	for (const { component, importPath } of componentImports) {
		lines.push(`import ${component.name} from ${toJavaScriptStringLiteral(importPath)};`);
	}
	lines.push('import type { App } from "vue";', "");

	for (const component of components) {
		lines.push(`export { ${component.name} };`);
		lines.push(`export type ${component.name}Instance = InstanceType<typeof ${component.name}>;`);
	}
	if (components.length > 0) lines.push("");

	lines.push("/** 将扫描到的组件注册为 Vue 全局组件。 */", "export function registerComponents(app: App): void {");
	for (const component of components) {
		lines.push(`\tapp.component(${component.name}.name, ${component.name});`);
	}
	lines.push("}");

	return `${generatedFileHeader("componentRegistry")}${lines.join("\n")}\n`;
}

/**
 * 生成 Vue 模板类型检查可识别的 `GlobalComponents` 模块增强声明。
 *
 * @param dtsFile - 声明文件的绝对路径，用于计算组件类型导入路径。
 * @param components - 已扫描并完成名称校验的组件描述。
 * @returns 可供 Vue 模板类型检查读取的模块增强声明源码。
 */
function renderComponentDeclarations(dtsFile: string, components: readonly ScannedComponent[]): string {
	const lines = ["export {};", "", 'declare module "vue" {', "\texport interface GlobalComponents {"];
	for (const component of components) {
		const importPath = relativeImportPath(dtsFile, component.absolutePath);
		lines.push(`\t\t${component.name}: (typeof import(${toJavaScriptStringLiteral(importPath)}))["default"];`);
	}
	lines.push("\t}", "}", "");
	return `${generatedFileHeader("componentRegistry")}${lines.join("\n")}\n`;
}

/**
 * 扫描 Vue/TSX/JSX 组件，并生成命名导出、实例类型、全局注册方法和全局组件类型。
 *
 * @param options - 扫描目录、输出文件、过滤、命名和冲突策略。
 * @returns 可直接加入 Vite `plugins` 的组件入口生成插件。
 * @throws 目录、扩展名、输出路径、绑定名或冲突策略无效时抛出异常。
 */
export function componentRegistry(options: ComponentRegistryPluginOptions = {}): Plugin {
	const resolved = resolveOptions(options);
	let config: ResolvedConfig;

	const generate = async (): Promise<void> => {
		const components = await scanComponents(config.root, options, (message) => config.logger.warn(message));
		if (resolved.output) {
			const outputFile = resolvePathInside(config.root, resolved.output, "component-registry");
			await writeFileIfChanged(outputFile, renderComponentRegistry(outputFile, components));
		}
		if (resolved.dts) {
			const dtsFile = resolvePathInside(config.root, resolved.dts, "component-registry");
			await writeFileIfChanged(dtsFile, renderComponentDeclarations(dtsFile, components));
		}
	};

	return {
		name: "fast-vite:component-registry",
		enforce: "post",
		configResolved(resolvedConfig): void {
			config = resolvedConfig;
		},
		async buildStart(): Promise<void> {
			await generate();
		},
		configureServer(server: ViteDevServer): void {
			const directories = resolved.dirs.map((directory) => path.resolve(config.root, directory));
			const generatedFiles = [resolved.output, resolved.dts]
				.filter((filePath): filePath is string => Boolean(filePath))
				.map((filePath) => resolvePathInside(config.root, filePath, "component-registry"));
			server.watcher.add(directories);

			const schedule = createDebouncedTask(generate, resolved.debounce, (error) => {
				config.logger.error(`[fast-vite:component-registry] ${errorMessage(error)}`);
			});
			const handle = (_event: string, file: string): void => {
				if (generatedFiles.some((generatedFile) => path.resolve(file) === generatedFile)) return;
				if (!directories.some((directory) => isPathInside(directory, file))) return;
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

function resolveOptions(options: ComponentRegistryPluginOptions): ResolvedOptions {
	const dirs = options.dirs ?? "src/components";
	const resolvedDirs = typeof dirs === "string" ? [dirs] : dirs;
	const extensions = normalizeExtensions(options.extensions ?? DEFAULT_EXTENSIONS);
	if (resolvedDirs.length === 0) throw new Error("[fast-vite:component-registry] dirs must contain at least one directory.");
	if (resolvedDirs.some((directory) => typeof directory !== "string" || !directory.trim())) {
		throw new Error("[fast-vite:component-registry] dirs must not contain empty paths.");
	}
	if (extensions.size === 0) throw new Error("[fast-vite:component-registry] extensions must contain at least one extension.");
	const configuredConflict: unknown = options.conflict;
	if (configuredConflict !== undefined && configuredConflict !== "error" && configuredConflict !== "warn" && configuredConflict !== "overwrite") {
		throw new Error("[fast-vite:component-registry] conflict must be error, warn, or overwrite.");
	}
	if (options.output === false && options.dts === false) {
		throw new Error("[fast-vite:component-registry] output and dts must not both be disabled.");
	}
	if (options.debounce !== undefined && (!Number.isFinite(options.debounce) || options.debounce < 0)) {
		throw new Error("[fast-vite:component-registry] debounce must be a finite non-negative number.");
	}
	const output = options.output ?? "src/components/index.ts";
	const dts = options.dts ?? "types/components.d.ts";
	if (output && !/\.[cm]?ts$/i.test(output)) {
		throw new Error("[fast-vite:component-registry] output must use a TypeScript extension: .ts, .mts, or .cts.");
	}
	if (dts && !/\.d\.ts$/i.test(dts)) throw new Error("[fast-vite:component-registry] dts must end with .d.ts.");
	if (output && dts && path.resolve(output) === path.resolve(dts)) {
		throw new Error("[fast-vite:component-registry] output and dts must not refer to the same file.");
	}
	return {
		conflict: options.conflict ?? "error",
		debounce: options.debounce ?? 80,
		deep: options.deep ?? true,
		dirs: resolvedDirs,
		dts,
		extensions,
		include: options.include,
		name: options.name,
		output,
	};
}
