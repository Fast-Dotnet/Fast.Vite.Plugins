import { readFile } from "node:fs/promises";
import path from "node:path";
import { type ConfigEnv, type HtmlTagDescriptor, type Plugin, type ResolvedConfig, isCSSRequest } from "vite";
import { isValidIdentifier } from "../shared/naming";
import type { CdnImportPluginOptions, CdnModule, CdnModuleResolver, CdnModuleResolverContext, ResolvedCdnModule } from "./type";

export type { CdnImportPluginOptions, CdnModule, CdnModuleResolver, CdnModuleResolverContext, CdnTagAttributes } from "./type";

/** jsDelivr 的 npm 文件 URL 模板，可传给 `CdnImportPluginOptions.urlTemplate`。 */
export const cdnJsDelivrUrl = "https://cdn.jsdelivr.net/npm/{name}@{version}/{path}";

/** unpkg 的 npm 文件 URL 模板，可传给 `CdnImportPluginOptions.urlTemplate`。 */
export const cdnUnpkgUrl = "https://unpkg.com/{name}@{version}/{path}";

interface AstNode {
	type: string;
	start: number;
	end: number;
	[key: string]: unknown;
}

interface AstProgram {
	body: AstNode[];
}

interface Replacement {
	start: number;
	end: number;
	content: string;
}

interface GeneratedSourceMap {
	version: 3;
	names: string[];
	sources: string[];
	sourcesContent: string[];
	mappings: string;
}

/**
 * 使用模块名、版本和文件路径渲染 CDN URL。
 *
 * `http(s)`、协议相对、`data:` 与 `blob:` URL 会原样返回。
 *
 * @param template - 包含 `{name}`、`{version}` 与 `{path}` 占位符的 URL 模板。
 * @param data - 当前包名、版本和资源路径。
 * @returns 渲染后的完整 URL，或原样保留的绝对资源 URL。
 * @throws 模板需要 `{version}` 但没有可用版本时抛出异常。
 */
function renderCdnUrl(template: string, data: { name: string; path: string; version: string }): string {
	if (/^(?:https?:)?\/\//i.test(data.path) || /^(?:data|blob):/i.test(data.path)) return data.path;
	if (!data.version && template.includes("{version}")) {
		throw new Error(`[fast-vite:cdn-import] Unable to determine the version of ${data.name}. Configure version explicitly.`);
	}
	return template.replaceAll("{name}", data.name).replaceAll("{version}", data.version).replaceAll("{path}", data.path.replace(/^\//, ""));
}

/**
 * 将 `Vue` 或 `ReactDOM.client` 转换为不依赖局部变量的 `globalThis` 访问表达式。
 *
 * @param globalName - 以点号分隔的浏览器全局变量路径。
 * @returns 仅包含安全属性访问的 `globalThis` 表达式。
 * @throws 任一名称片段不是合法 ECMAScript 标识符时抛出异常。
 */
function globalExpression(globalName: string): string {
	const parts = globalName.split(".");
	if (parts.some((part) => !isValidIdentifier(part))) {
		throw new Error(`[fast-vite:cdn-import] Invalid browser global variable: ${globalName}`);
	}
	return parts.reduce((expression, part) => `${expression}[${JSON.stringify(part)}]`, "globalThis");
}

/**
 * 按 Vite 提供的 ESTree 节点范围转换 import、re-export 与动态 import。
 *
 * 仅处理配置为 CDN 外部依赖的模块，不扫描或替换注释、字符串和普通业务代码。
 *
 * @param code - Vite 当前转换钩子收到的模块源码。
 * @param externals - 模块名到浏览器全局变量路径的自有属性映射。
 * @param parsedProgram - 由 Vite 插件上下文解析的 ESTree Program。
 * @param sourceName - 写入 source map 的源码标识。
 * @returns 有替换时返回转换代码与可组合的精确 source map，否则返回 `undefined`。
 */
function transformCdnImports(
	code: string,
	externals: Readonly<Record<string, string>>,
	parsedProgram: unknown,
	sourceName = "source.js"
): { code: string; map: GeneratedSourceMap } | undefined {
	if (typeof parsedProgram !== "object" || parsedProgram === null) return undefined;
	const program = parsedProgram as AstProgram;
	if (!Array.isArray(program.body)) return undefined;

	const replacements: Replacement[] = [];
	const usedBindings = collectIdentifierNames(program);
	const allocateBinding = (base: string): string => {
		let candidate = base;
		let suffix = 1;
		while (usedBindings.has(candidate)) candidate = `${base}_${suffix++}`;
		usedBindings.add(candidate);
		return candidate;
	};
	let exportIndex = 0;
	for (const node of program.body) {
		const moduleName = sourceValue(node.source);
		if (!moduleName || !Object.hasOwn(externals, moduleName)) continue;
		const expression = globalExpression(externals[moduleName] ?? "");

		if (node.type === "ImportDeclaration") {
			replacements.push({ ...nodeRange(node), content: renderImportDeclaration(node, expression) });
			continue;
		}
		if (node.type === "ExportNamedDeclaration") {
			replacements.push({ ...nodeRange(node), content: renderNamedExport(node, expression, exportIndex, allocateBinding) });
			exportIndex += 1;
			continue;
		}
		if (node.type === "ExportAllDeclaration") {
			replacements.push({ ...nodeRange(node), content: renderExportAll(node, expression) });
		}
	}

	visitAst(program, (node) => {
		if (node.type !== "ImportExpression") return;
		const moduleName = sourceValue(node.source);
		if (!moduleName || !Object.hasOwn(externals, moduleName)) return;
		replacements.push({ ...nodeRange(node), content: `Promise.resolve(${globalExpression(externals[moduleName] ?? "")})` });
	});

	if (replacements.length === 0) return undefined;
	return applyReplacements(code, replacements, sourceName);
}

/**
 * 解析 CDN 模块、自动读取版本并生成最终资源 URL。
 *
 * @param root - Vite 项目根目录的绝对路径。
 * @param options - CDN 模块、URL 模板和标签行为配置。
 * @param env - 当前 Vite 命令和模式。
 * @returns 按配置顺序补全版本、CSS URL 和 JavaScript URL 的模块列表。
 */
async function resolveCdnModules(root: string, options: CdnImportPluginOptions, env: ConfigEnv): Promise<ResolvedCdnModule[]> {
	const urlTemplate = options.urlTemplate ?? cdnJsDelivrUrl;
	const configured = (Array.isArray(options.modules) ? options.modules : [options.modules]) as readonly (CdnModule | CdnModuleResolver)[];
	if (configured.length === 0) throw new Error("[fast-vite:cdn-import] modules must contain at least one module.");
	const context: CdnModuleResolverContext = { ...env, root, urlTemplate };
	const resolved: ResolvedCdnModule[] = [];

	for (const item of configured) {
		const module = typeof item === "function" ? await item(context) : item;
		validateModule(module);
		const version = module.version ?? (options.resolveVersion === false ? "" : await findPackageVersion(root, module.name));
		const template = module.urlTemplate ?? urlTemplate;
		const render = (resourcePath: string): string => renderCdnUrl(template, { name: module.name, path: resourcePath, version });
		resolved.push({
			...module,
			cssUrls: toArray(module.css).map(render),
			jsUrls: toArray(module.js).map(render),
			version,
		});
	}

	return resolved;
}

/**
 * 将指定依赖替换为 CDN 全局变量，并按依赖顺序向 HTML 注入 CSS 与 JavaScript。
 *
 * @param options - CDN 模块、版本解析、开发模式、SSR 与标签配置。
 * @returns 可直接加入 Vite `plugins` 的 CDN 导入插件。
 * @throws 模块、别名、URL、全局变量或标签枚举无效时抛出异常。
 */
export function cdnImport(options: CdnImportPluginOptions): Plugin {
	const configuredModules: unknown = options.modules;
	if (configuredModules === undefined) throw new Error("[fast-vite:cdn-import] modules must contain at least one module.");
	if (options.urlTemplate !== undefined && !options.urlTemplate.trim()) throw new Error("[fast-vite:cdn-import] urlTemplate must not be empty.");
	if (options.crossorigin !== undefined && ![false, "anonymous", "use-credentials"].includes(options.crossorigin)) {
		throw new Error("[fast-vite:cdn-import] crossorigin must be false, anonymous, or use-credentials.");
	}
	let config: ResolvedConfig;
	let env: ConfigEnv;
	let modules: ResolvedCdnModule[] = [];
	let externalMap: Record<string, string> = {};

	return {
		name: "fast-vite:cdn-import",
		enforce: "post",
		config(_config, configEnv): void {
			env = configEnv;
		},
		async configResolved(resolvedConfig): Promise<void> {
			config = resolvedConfig;
			modules = await resolveCdnModules(config.root, options, env);
			externalMap = createExternalMap(modules);
		},
		transform(code, id, transformOptions): ReturnType<typeof transformCdnImports> {
			if (transformOptions?.ssr && options.ssr !== true) return undefined;
			if (config.command === "serve" && options.dev !== true) return undefined;
			if (isCSSRequest(id)) return undefined;
			return transformCdnImports(code, externalMap, this.parse(code), id);
		},
		transformIndexHtml(): HtmlTagDescriptor[] {
			if (config.command === "serve" && options.dev !== true) return [];

			const tags: HtmlTagDescriptor[] = [];
			const injectTo = options.injectTo ?? "head-prepend";
			for (const module of modules) {
				for (const url of module.cssUrls) {
					const custom = options.generateStyleTag?.(module, url) ?? {};
					const { attrs: customAttributes, ...customDescriptor } = custom;
					tags.push({
						tag: "link",
						injectTo,
						...customDescriptor,
						attrs: {
							href: url,
							rel: "stylesheet",
							...(options.crossorigin === false ? {} : { crossorigin: options.crossorigin ?? "anonymous" }),
							...module.styleAttributes,
							...customAttributes,
						},
					});
				}

				for (const url of module.jsUrls) {
					const custom = options.generateScriptTag?.(module, url) ?? {};
					const { attrs: customAttributes, ...customDescriptor } = custom;
					tags.push({
						tag: "script",
						injectTo,
						...customDescriptor,
						attrs: {
							src: url,
							...(options.crossorigin === false ? {} : { crossorigin: options.crossorigin ?? "anonymous" }),
							...module.scriptAttributes,
							...customAttributes,
						},
					});
				}
			}
			return tags;
		},
	};
}

function renderImportDeclaration(node: AstNode, expression: string): string {
	if (node.importKind === "type") return "";
	const specifiers = Array.isArray(node.specifiers) ? (node.specifiers as AstNode[]) : [];
	if (specifiers.length === 0) return `void ${expression};`;

	const declarations: string[] = [];
	for (const specifier of specifiers) {
		if (specifier.importKind === "type") continue;
		const localName = identifierName(specifier.local);
		if (!localName) continue;
		if (specifier.type === "ImportDefaultSpecifier" || specifier.type === "ImportNamespaceSpecifier") {
			declarations.push(`const ${localName} = ${expression};`);
			continue;
		}
		const importedName = identifierName(specifier.imported);
		if (importedName) declarations.push(`const ${localName} = ${propertyAccess(expression, importedName)};`);
	}
	return declarations.join("\n");
}

function renderNamedExport(node: AstNode, expression: string, exportIndex: number, allocateBinding: (base: string) => string): string {
	if (node.exportKind === "type") return "";
	const specifiers = Array.isArray(node.specifiers) ? (node.specifiers as AstNode[]) : [];
	const declarations: string[] = [];
	const exports: string[] = [];
	for (const [index, specifier] of specifiers.entries()) {
		if (specifier.exportKind === "type") continue;
		const importedName = identifierName(specifier.local);
		const exportedName = identifierName(specifier.exported);
		if (!importedName || !exportedName) continue;
		const localName = allocateBinding(`__fast_cdn_export_${exportIndex}_${index}`);
		declarations.push(`const ${localName} = ${propertyAccess(expression, importedName)};`);
		exports.push(`${localName} as ${exportedName}`);
	}
	return exports.length === 0 ? "" : `${declarations.join("\n")}\nexport { ${exports.join(", ")} };`;
}

function renderExportAll(node: AstNode, expression: string): string {
	const exportedName = identifierName(node.exported);
	if (!exportedName) throw new Error("[fast-vite:cdn-import] Cannot map export * to a global variable. Use explicit named exports instead.");
	return `const ${exportedName} = ${expression};\nexport { ${exportedName} };`;
}

function propertyAccess(expression: string, name: string): string {
	return name === "default" ? expression : `${expression}[${JSON.stringify(name)}]`;
}

function identifierName(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as { name?: unknown; value?: unknown };
	if (typeof record.name === "string") return record.name;
	return typeof record.value === "string" ? record.value : undefined;
}

function sourceValue(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const source = value as { value?: unknown };
	return typeof source.value === "string" ? source.value : undefined;
}

function nodeRange(node: AstNode): Pick<Replacement, "end" | "start"> {
	return { end: node.end, start: node.start };
}

function applyReplacements(code: string, replacements: Replacement[], sourceName: string): { code: string; map: GeneratedSourceMap } {
	const accepted: Replacement[] = [];
	let previousEnd = -1;
	for (const replacement of replacements.sort((left, right) => left.start - right.start)) {
		if (replacement.start < previousEnd) continue;
		accepted.push(replacement);
		previousEnd = replacement.end;
	}

	let transformed = "";
	const origins: number[] = [];
	let cursor = 0;
	const append = (value: string, originalStart: number, copied: boolean): void => {
		transformed += value;
		for (let index = 0; index < value.length; index += 1) origins.push(copied ? originalStart + index : originalStart);
	};
	for (const replacement of accepted) {
		append(code.slice(cursor, replacement.start), cursor, true);
		append(replacement.content, replacement.start, false);
		cursor = replacement.end;
	}
	append(code.slice(cursor), cursor, true);

	return {
		code: transformed,
		map: createSourceMap(code, transformed, origins, sourceName),
	};
}

function collectIdentifierNames(program: AstProgram): Set<string> {
	const names = new Set<string>();
	visitAst(program, (node) => {
		if (node.type === "Identifier" && typeof node.name === "string") names.add(node.name);
	});
	return names;
}

function createSourceMap(source: string, generated: string, origins: readonly number[], sourceName: string): GeneratedSourceMap {
	const originalPositions: { column: number; line: number }[] = [];
	let line = 0;
	let column = 0;
	for (let index = 0; index <= source.length; index += 1) {
		originalPositions.push({ column, line });
		if (source[index] === "\n") {
			line += 1;
			column = 0;
		} else {
			column += 1;
		}
	}

	const lines: string[][] = [[]];
	let generatedColumn = 0;
	let previousSource = 0;
	let previousOriginalLine = 0;
	let previousOriginalColumn = 0;
	for (let index = 0; index < generated.length; index += 1) {
		const position = originalPositions[origins[index] ?? source.length] ?? { column: 0, line: 0 };
		const segment =
			encodeVlq(generatedColumn - (lines.at(-1)?.length ? generatedColumn - 1 : 0)) +
			encodeVlq(0 - previousSource) +
			encodeVlq(position.line - previousOriginalLine) +
			encodeVlq(position.column - previousOriginalColumn);
		lines.at(-1)?.push(segment);
		previousSource = 0;
		previousOriginalLine = position.line;
		previousOriginalColumn = position.column;
		if (generated[index] === "\n") {
			lines.push([]);
			generatedColumn = 0;
		} else {
			generatedColumn += 1;
		}
	}
	return { version: 3, names: [], sources: [sourceName], sourcesContent: [source], mappings: lines.map((items) => items.join(",")).join(";") };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value: number): string {
	let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
	let encoded = "";
	do {
		let digit = vlq & 31;
		vlq >>>= 5;
		if (vlq > 0) digit |= 32;
		encoded += BASE64[digit] ?? "";
	} while (vlq > 0);
	return encoded;
}

function visitAst(value: unknown, visitor: (node: AstNode) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) visitAst(item, visitor);
		return;
	}
	if (!value || typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	if (typeof record.type === "string" && typeof record.start === "number" && typeof record.end === "number") {
		visitor(record as AstNode);
	}
	for (const [key, child] of Object.entries(record)) {
		if (key !== "parent") visitAst(child, visitor);
	}
}

async function findPackageVersion(root: string, packageName: string): Promise<string> {
	let directory = path.resolve(root);
	for (;;) {
		const packageFile = path.join(directory, "node_modules", packageName, "package.json");
		try {
			const parsed = JSON.parse(await readFile(packageFile, "utf8")) as { version?: unknown };
			if (typeof parsed.version === "string") return parsed.version;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}

		const parent = path.dirname(directory);
		if (parent === directory) return "";
		directory = parent;
	}
}

function toArray(value: string | readonly string[] | undefined): readonly string[] {
	if (!value) return [];
	return typeof value === "string" ? [value] : value;
}

function validateModule(module: CdnModule): void {
	const configuredModule: unknown = module;
	if (typeof configuredModule !== "object" || configuredModule === null || Array.isArray(configuredModule)) {
		throw new Error("[fast-vite:cdn-import] Module configuration must be an object.");
	}
	const moduleRecord = configuredModule as Record<string, unknown>;
	if (typeof moduleRecord.name !== "string" || !moduleRecord.name.trim()) throw new Error("[fast-vite:cdn-import] Module name must not be empty.");
	if (!module.global) throw new Error(`[fast-vite:cdn-import] global must not be empty for ${module.name}.`);
	if (toArray(module.js).length === 0 || toArray(module.js).some((file) => typeof file !== "string" || !file.trim())) {
		throw new Error(`[fast-vite:cdn-import] ${module.name} requires at least one non-empty JavaScript file.`);
	}
	if (toArray(module.css).some((file) => typeof file !== "string" || !file.trim())) {
		throw new Error(`[fast-vite:cdn-import] CSS files must not be empty for ${module.name}.`);
	}
	if (module.aliases?.some((alias) => !alias.trim())) {
		throw new Error(`[fast-vite:cdn-import] aliases must not contain empty names for ${module.name}.`);
	}
	globalExpression(module.global);
}

function createExternalMap(modules: readonly ResolvedCdnModule[]): Record<string, string> {
	const result: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const module of modules) {
		for (const name of [module.name, ...(module.aliases ?? [])]) {
			if (Object.hasOwn(result, name)) throw new Error(`[fast-vite:cdn-import] Duplicate module name or alias: ${name}`);
			result[name] = module.global;
		}
	}
	return result;
}
