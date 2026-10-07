import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	errorMessage,
	generatedFileHeader,
	isPathInside,
	normalizePath,
	resolvePathInside,
	scanFiles,
	writeFileIfChanged,
} from "../shared/fileSystem";
import { compareStrings, isValidBindingIdentifier, toJavaScriptStringLiteral, toPascalCase } from "../shared/naming";
import { createDebouncedTask, onServerClose } from "../shared/plugin";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type { ParsedSvg, ScannedSvgIcon, SvgAttributeValue, SvgIconNameContext, SvgIconsPluginOptions } from "./type";

export type { SvgAttributeValue, SvgIconNameContext, SvgIconsPluginOptions } from "./type";

interface ResolvedOptions {
	componentPrefix: string;
	componentSuffix: string;
	debounce: number;
	deep: boolean;
	defaultAttributes: Readonly<Record<string, SvgAttributeValue>>;
	dir: string;
	include: SvgIconsPluginOptions["include"];
	name: SvgIconsPluginOptions["name"];
	output: string;
	removeDimensions: boolean;
}

interface SvgIconOutput {
	filePath: string;
	icon: ScannedSvgIcon;
	modulePath: string;
}

const GENERATED_LINE_WIDTH = 150;

/**
 * 将完整 SVG 文本拆成根属性与内部标记。
 *
 * @param source - 包含单个完整 `<svg>...</svg>` 根元素的文本。
 * @returns 可用于生成 Vue 渲染函数的结构化结果。
 * @throws 输入缺少完整 SVG 根元素时抛出异常。
 */
function parseSvg(source: string): ParsedSvg {
	const normalized = source
		.replace(/<\?xml[\s\S]*?\?>/gi, "")
		.replace(/<!doctype[\s\S]*?>/gi, "")
		.trim();
	const match = /<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/i.exec(normalized);
	if (!match) throw new Error("[fast-vite:svg-icons] SVG files must contain a complete <svg>...</svg> root element.");

	const attributes: Record<string, SvgAttributeValue> = {};
	const attributeSource = match[1] ?? "";
	const attributePattern = /([:@_a-z][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
	for (const attribute of attributeSource.matchAll(attributePattern)) {
		const name = attribute[1];
		if (!name) continue;
		attributes[name] = attribute[2] ?? attribute[3] ?? attribute[4] ?? true;
	}

	if (!("xmlns" in attributes)) attributes.xmlns = "http://www.w3.org/2000/svg";
	if (!("viewBox" in attributes)) {
		const width = numericDimension(attributes.width);
		const height = numericDimension(attributes.height);
		if (width !== undefined && height !== undefined) attributes.viewBox = `0 0 ${width} ${height}`;
	}

	return { attributes, content: (match[2] ?? "").trim() };
}

/**
 * 以稳定顺序扫描并解析 SVG 文件，同时验证生成的组件名称。
 *
 * @param root - Vite 项目根目录的绝对路径。
 * @param options - 扫描目录、命名和根属性选项。
 * @returns 按最终组件名称排序的图标描述。
 */
async function scanSvgIcons(root: string, options: SvgIconsPluginOptions = {}): Promise<ScannedSvgIcon[]> {
	const resolved = resolveOptions(options);
	const directory = path.resolve(root, resolved.dir);
	const files = await scanFiles(directory, {
		deep: resolved.deep,
		filter: (filePath) => path.extname(filePath).toLowerCase() === ".svg",
	});
	const icons = new Map<string, ScannedSvgIcon>();

	for (const absolutePath of files) {
		const relativePath = normalizePath(path.relative(directory, absolutePath));
		const relativeName = relativePath.slice(0, -path.extname(relativePath).length);
		const defaultName = `${resolved.componentPrefix}${toPascalCase(relativeName)}${resolved.componentSuffix}`;
		const context: SvgIconNameContext = { absolutePath, defaultName, relativePath };
		if (resolved.include && !resolved.include(context)) continue;

		const name = resolved.name?.(context) ?? defaultName;
		if (!isValidBindingIdentifier(name)) {
			throw new Error(
				`[fast-vite:svg-icons] Component name ${JSON.stringify(name)} is not a valid binding identifier for generated code: ${relativePath}`
			);
		}
		const previous = icons.get(name);
		if (previous) {
			throw new Error(
				`[fast-vite:svg-icons] Conflicting icon component name ${JSON.stringify(name)}: ${previous.relativePath} and ${relativePath}`
			);
		}

		const parsed = parseSvg(await readFile(absolutePath, "utf8"));
		const attributes = { ...resolved.defaultAttributes, ...parsed.attributes };
		if (resolved.removeDimensions) {
			delete attributes.width;
			delete attributes.height;
		}
		icons.set(name, { ...context, ...parsed, attributes, name });
	}

	return [...icons.values()].sort((left, right) => compareStrings(left.name, right.name));
}

/**
 * 计算每个 SVG 图标对应的独立组件模块路径。
 *
 * @param outputFile - 根索引文件的绝对路径。
 * @param icons - 已完成命名、解析并按名称排序的 SVG 图标。
 * @returns 每个图标的模块导入路径与 `index.tsx` 输出路径。
 * @throws 不同 SVG 路径在跨平台模块解析时发生冲突时抛出异常。
 */
function resolveSvgIconOutputs(outputFile: string, icons: readonly ScannedSvgIcon[]): SvgIconOutput[] {
	const outputDirectory = path.dirname(outputFile);
	const outputs = icons.map((icon) => {
		const relativeName = normalizePath(icon.relativePath.slice(0, -path.extname(icon.relativePath).length));
		const modulePath = `./${relativeName}/index`;
		const filePath = path.resolve(outputDirectory, relativeName, "index.tsx");
		if (!isPathInside(outputDirectory, filePath)) {
			throw new Error(`[fast-vite:svg-icons] Icon component output path is outside the index directory: ${icon.relativePath}`);
		}
		return { filePath, icon, modulePath };
	});
	const modulePaths = new Map<string, SvgIconOutput>();
	for (const output of outputs) {
		const key = output.modulePath.toLowerCase();
		const previous = modulePaths.get(key);
		if (previous) {
			throw new Error(`[fast-vite:svg-icons] Conflicting icon module paths: ${previous.icon.relativePath} and ${output.icon.relativePath}`);
		}
		modulePaths.set(key, output);
	}
	return outputs;
}

/** 渲染单个 SVG 图标的独立 Vue TSX 组件模块。 */
function renderSvgIconComponent(icon: ScannedSvgIcon): string {
	const lines = [
		'import { defineComponent } from "vue";',
		"",
		"/**",
		` * ${icon.name} 图标组件。`,
		" */",
		`export const ${icon.name} = defineComponent({`,
		`\tname: ${toJavaScriptStringLiteral(icon.name)},`,
		"\trender() {",
		"\t\treturn (",
		...renderSvgElementStart("svg", renderRootSvgAttributes(icon.attributes), false, 3),
		...renderSvgContent(icon.content, 4),
		"\t\t\t</svg>",
		"\t\t);",
		"\t},",
		"});",
		"",
		`export default ${icon.name};`,
	];
	return `${generatedFileHeader("svgIcons")}${lines.join("\n")}\n`;
}

function renderRootSvgAttributes(attributes: Readonly<Record<string, SvgAttributeValue>>): string[] {
	const priority = new Map([
		["xmlns", 0],
		["viewBox", 1],
		["width", 2],
		["height", 3],
	]);
	return Object.entries(attributes)
		.map(([name, value], index) => ({ index, name, value }))
		.sort((left, right) => (priority.get(left.name) ?? 4) - (priority.get(right.name) ?? 4) || left.index - right.index)
		.map(({ name, value }) => renderRootSvgAttribute(name, value));
}

function renderRootSvgAttribute(name: string, value: SvgAttributeValue): string {
	if (value === true) return name;
	if (typeof value !== "string") return `${name}={${JSON.stringify(value)}}`;
	if (!/["&<>\r\n]/u.test(value)) return `${name}="${value}"`;
	return `${name}={${toJavaScriptStringLiteral(value)}}`;
}

function renderSvgContent(content: string, initialDepth: number): string[] {
	const lines: string[] = [];
	let depth = initialDepth;
	for (const token of tokenizeSvgContent(content)) {
		if (token.startsWith("<!--")) continue;
		if (token.startsWith("</")) depth = Math.max(initialDepth, depth - 1);

		if (token.startsWith("<")) {
			lines.push(...renderSvgTag(token, depth));
		} else {
			lines.push(`${"\t".repeat(depth)}{${toJavaScriptStringLiteral(token)}}`);
		}

		if (token.startsWith("<") && !token.startsWith("</") && !token.startsWith("<!") && !token.startsWith("<?") && !token.endsWith("/>")) {
			depth += 1;
		}
	}
	return lines;
}

function tokenizeSvgContent(content: string): string[] {
	const tokens: string[] = [];
	let index = 0;
	while (index < content.length) {
		const tagStart = content.indexOf("<", index);
		if (tagStart < 0) {
			const text = content.slice(index).trim();
			if (text) tokens.push(text);
			break;
		}

		const text = content.slice(index, tagStart).trim();
		if (text) tokens.push(text);
		if (content.startsWith("<!--", tagStart)) {
			const commentEnd = content.indexOf("-->", tagStart + 4);
			if (commentEnd < 0) throw new Error("[fast-vite:svg-icons] Unterminated SVG comment.");
			tokens.push(content.slice(tagStart, commentEnd + 3));
			index = commentEnd + 3;
			continue;
		}

		let quote: "'" | '"' | undefined;
		let tagEnd = -1;
		for (let cursor = tagStart + 1; cursor < content.length; cursor += 1) {
			const character = content[cursor];
			if (quote) {
				if (character === quote) quote = undefined;
				continue;
			}
			if (character === "'" || character === '"') {
				quote = character;
			} else if (character === ">") {
				tagEnd = cursor;
				break;
			}
		}
		if (tagEnd < 0) throw new Error("[fast-vite:svg-icons] Unterminated SVG tag.");
		tokens.push(content.slice(tagStart, tagEnd + 1).trim());
		index = tagEnd + 1;
	}
	return tokens;
}

function renderSvgTag(tag: string, depth: number): string[] {
	if (tag.startsWith("<!") || tag.startsWith("<?")) {
		throw new Error(`[fast-vite:svg-icons] SVG contains an unsupported declaration: ${tag}`);
	}
	if (tag.startsWith("</")) return [`${"\t".repeat(depth)}${tag}`];

	const selfClosing = tag.endsWith("/>");
	const body = tag.slice(1, selfClosing ? -2 : -1).trim();
	const whitespaceIndex = body.search(/\s/u);
	const name = whitespaceIndex < 0 ? body : body.slice(0, whitespaceIndex);
	if (!name || name.includes("/")) throw new Error(`[fast-vite:svg-icons] Unable to parse SVG tag: ${tag}`);
	const attributes = splitSvgAttributes(whitespaceIndex < 0 ? "" : body.slice(whitespaceIndex + 1));
	return renderSvgElementStart(name, attributes, selfClosing, depth);
}

function splitSvgAttributes(source: string): string[] {
	const attributes: string[] = [];
	let index = 0;
	while (index < source.length) {
		while (/\s/u.test(source[index] ?? "")) index += 1;
		if (index >= source.length) break;

		const start = index;
		let quote: "'" | '"' | undefined;
		while (index < source.length) {
			const character = source[index];
			if (quote) {
				if (character === quote) quote = undefined;
				index += 1;
				continue;
			}
			if (character === "'" || character === '"') quote = character;
			else if (/\s/u.test(character ?? "")) break;
			index += 1;
		}
		if (quote) throw new Error(`[fast-vite:svg-icons] Unterminated quoted SVG attribute: ${source.slice(start)}`);
		attributes.push(source.slice(start, index));
	}
	return attributes;
}

function renderSvgElementStart(name: string, attributes: readonly string[], selfClosing: boolean, depth: number): string[] {
	const indentation = "\t".repeat(depth);
	const ending = selfClosing ? " />" : ">";
	const singleLine = `${indentation}<${name}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}${ending}`;
	if (singleLine.replaceAll("\t", "    ").length <= GENERATED_LINE_WIDTH) return [singleLine];

	return [`${indentation}<${name}`, ...attributes.map((attribute) => `${indentation}\t${attribute}`), `${indentation}${selfClosing ? "/>" : ">"}`];
}

/** 渲染图标根索引，提供命名导出与直接默认导出的只读组件对象。 */
function renderSvgIconIndex(outputs: readonly SvgIconOutput[]): string {
	const lines: string[] = [];
	const imports = [...outputs].sort((left, right) => {
		const insensitiveOrder = compareStrings(left.modulePath.toLowerCase(), right.modulePath.toLowerCase());
		return insensitiveOrder || compareStrings(left.modulePath, right.modulePath);
	});
	for (const output of imports) lines.push(`import ${output.icon.name} from ${toJavaScriptStringLiteral(output.modulePath)};`);
	if (imports.length > 0) lines.push("");

	const names = outputs.map(({ icon }) => icon.name);
	if (names.length === 0) {
		lines.push("export default {} as const;");
	} else {
		for (const name of names) lines.push(`export { ${name} };`);
		lines.push("", "export default {");
		for (const name of names) lines.push(`\t${name},`);
		lines.push("} as const;");
	}
	return `${generatedFileHeader("svgIcons")}${lines.join("\n")}\n`;
}

/**
 * 将 SVG 目录编译为独立的 Vue 图标组件与根索引。
 *
 * 生成组件通过 `defineComponent` 与内联 SVG JSX 渲染，消费项目需要启用 Vue JSX/TSX 转换。
 *
 * @param options - SVG 目录、输出文件、命名、过滤和根属性配置。
 * @returns 可直接加入 Vite `plugins` 的 SVG 图标生成插件。
 * @throws 路径、扩展名、防抖参数或生成绑定名无效时抛出异常。
 */
export function svgIcons(options: SvgIconsPluginOptions = {}): Plugin {
	const resolved = resolveOptions(options);
	let config: ResolvedConfig;

	const generate = async (): Promise<void> => {
		const outputFile = resolvePathInside(config.root, resolved.output, "svg-icons");
		const icons = await scanSvgIcons(config.root, options);
		const outputs = resolveSvgIconOutputs(outputFile, icons);
		for (const output of outputs) await writeFileIfChanged(output.filePath, renderSvgIconComponent(output.icon));
		await writeFileIfChanged(outputFile, renderSvgIconIndex(outputs));
	};

	return {
		name: "fast-vite:svg-icons",
		enforce: "post",
		configResolved(resolvedConfig): void {
			config = resolvedConfig;
		},
		async buildStart(): Promise<void> {
			await generate();
		},
		configureServer(server: ViteDevServer): void {
			const directory = path.resolve(config.root, resolved.dir);
			const outputFile = resolvePathInside(config.root, resolved.output, "svg-icons");
			server.watcher.add(directory);

			const schedule = createDebouncedTask(generate, resolved.debounce, (error) => {
				config.logger.error(`[fast-vite:svg-icons] ${errorMessage(error)}`);
			});
			const handle = (_event: string, file: string): void => {
				if (path.resolve(file) === outputFile || !isPathInside(directory, file)) return;
				if (path.extname(file).toLowerCase() === ".svg") schedule();
			};

			server.watcher.on("all", handle);
			onServerClose(server, () => {
				server.watcher.off("all", handle);
				schedule.cancel();
			});
		},
	};
}

function numericDimension(value: SvgAttributeValue | undefined): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const match = /^([\d.]+)(?:px)?$/i.exec(value.trim());
	if (!match?.[1]) return undefined;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveOptions(options: SvgIconsPluginOptions): ResolvedOptions {
	if (options.debounce !== undefined && (!Number.isFinite(options.debounce) || options.debounce < 0)) {
		throw new Error("[fast-vite:svg-icons] debounce must be a finite non-negative number.");
	}
	const output = options.output ?? "src/icons/index.ts";
	if (!/\.[cm]?ts$/i.test(output)) {
		throw new Error("[fast-vite:svg-icons] output must use a TypeScript extension: .ts, .mts, or .cts.");
	}
	if (options.dir !== undefined && !options.dir.trim()) throw new Error("[fast-vite:svg-icons] dir must not be an empty path.");
	return {
		componentPrefix: options.componentPrefix ?? "",
		componentSuffix: options.componentSuffix ?? "",
		debounce: options.debounce ?? 80,
		deep: options.deep ?? true,
		defaultAttributes: options.defaultAttributes ?? {},
		dir: options.dir ?? "src/assets/icons",
		include: options.include,
		name: options.name,
		output,
		removeDimensions: options.removeDimensions ?? false,
	};
}
