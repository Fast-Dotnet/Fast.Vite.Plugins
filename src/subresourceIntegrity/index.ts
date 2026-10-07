import { createHash } from "node:crypto";
import path from "node:path";
import { isSafeOutputFileName, normalizePath } from "../shared/fileSystem";
import { compareStrings } from "../shared/naming";
import { assertPostBuildPluginOrder } from "../shared/order";
import type { Plugin, ResolvedConfig } from "vite";
import type {
	IntegrityInjectionOptions,
	IntegrityInjectionResult,
	SubresourceIntegrityAlgorithm,
	SubresourceIntegrityFilter,
	SubresourceIntegrityPluginOptions,
} from "./type";

export type { IntegrityCrossorigin, SubresourceIntegrityAlgorithm, SubresourceIntegrityFilter, SubresourceIntegrityPluginOptions } from "./type";

const DEFAULT_FILTER = /\.(?:css|m?js)$/i;
const SUPPORTED_ALGORITHMS = new Set<SubresourceIntegrityAlgorithm>(["sha256", "sha384", "sha512"]);

/**
 * 为内容生成符合浏览器 SRI 语法的一个或多个摘要。
 *
 * @param content - 最终写入构建产物的字节或 UTF-8 字符串。
 * @param algorithms - 摘要算法；重复项去重并保留首次出现顺序。
 * @returns 以空格连接、可直接写入 `integrity` 属性的摘要。
 */
function generateIntegrity(
	content: string | Uint8Array,
	algorithms: SubresourceIntegrityAlgorithm | readonly SubresourceIntegrityAlgorithm[] = "sha384"
): string {
	const values = normalizeAlgorithms(algorithms);
	const bytes = typeof content === "string" ? Buffer.from(content) : content;
	return values.map((algorithm) => `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`).join(" ");
}

/**
 * 给 HTML 中属于当前构建的 script、stylesheet 和 modulepreload 标签注入 SRI。
 *
 * 只有与绝对 `base` 同源且位于其路径边界内的 URL 才视为本地产物；注释、远程 URL、
 * `data:`、`blob:` 和页面锚点保持不变。
 *
 * @param html - 构建后的 HTML 源码。
 * @param options - HTML 文件名、Vite base、摘要映射与覆盖策略。
 * @returns 转换后的 HTML、已注入产物和缺失本地资源。
 */
function injectIntegrity(html: string, options: IntegrityInjectionOptions): IntegrityInjectionResult {
	const configuredIntegrities: unknown = options.integrities;
	if (typeof configuredIntegrities !== "object" || configuredIntegrities === null || Array.isArray(configuredIntegrities)) {
		throw new Error("[fast-vite:subresource-integrity] integrities must be an object.");
	}
	const injected = new Set<string>();
	const missing = new Set<string>();
	const htmlFileName = normalizePath(options.htmlFileName ?? "index.html");
	const base = options.base ?? "/";
	const crossorigin = options.crossorigin ?? "anonymous";
	const overwrite = options.overwrite ?? true;
	if (!isSafeOutputFileName(htmlFileName)) throw new Error("[fast-vite:subresource-integrity] htmlFileName must be a safe build output name.");
	if (options.crossorigin !== undefined && ![false, "anonymous", "use-credentials"].includes(options.crossorigin)) {
		throw new Error("[fast-vite:subresource-integrity] crossorigin must be false, anonymous, or use-credentials.");
	}

	const transformed = transformHtmlTags(html, (tag) => {
		const resourceUrl = eligibleResourceUrl(tag);
		if (!resourceUrl) return tag;
		const fileName = resolveHtmlResource(resourceUrl, htmlFileName, base);
		if (fileName === undefined) return tag;
		const integrity = Object.hasOwn(options.integrities, fileName) ? options.integrities[fileName] : undefined;
		if (!integrity) {
			missing.add(resourceUrl);
			return tag;
		}
		if (!overwrite && hasAttribute(tag, "integrity")) return tag;

		let nextTag = setAttribute(tag, "integrity", integrity);
		if (crossorigin !== false && (overwrite || !hasAttribute(tag, "crossorigin"))) {
			nextTag = setAttribute(nextTag, "crossorigin", crossorigin);
		}
		injected.add(fileName);
		return nextTag;
	});

	return {
		html: transformed,
		injected: [...injected].sort(compareStrings),
		missing: [...missing].sort(compareStrings),
	};
}

/**
 * 为 Vite 最终 JavaScript/CSS 产物生成 SRI，并更新构建后的 HTML 入口。
 *
 * 插件在输出阶段末尾运行；若同时使用预压缩插件，应把本插件放在压缩插件之前，使
 * `.gz` / `.br` HTML 与注入后的原文件保持一致。
 *
 * @param options - 摘要算法、资源过滤、CORS、覆盖、清单和严格模式配置。
 * @returns 可直接加入 Vite `plugins` 的 Subresource Integrity 插件。
 * @throws 算法、CORS、清单、资源映射或产物顺序无效时抛出异常。
 */
export function subresourceIntegrity(options: SubresourceIntegrityPluginOptions = {}): Plugin {
	if (options.crossorigin !== undefined && ![false, "anonymous", "use-credentials"].includes(options.crossorigin)) {
		throw new Error("[fast-vite:subresource-integrity] crossorigin must be false, anonymous, or use-credentials.");
	}
	const configuredAlgorithms: unknown = options.algorithms;
	const algorithms = normalizeAlgorithms(configuredAlgorithms === undefined ? "sha384" : configuredAlgorithms);
	const filter = options.filter ?? DEFAULT_FILTER;
	const manifestFileName = resolveManifestFileName(options.manifest);
	let config: ResolvedConfig;

	return {
		name: "fast-vite:subresource-integrity",
		apply: "build",
		enforce: "post",
		configResolved(resolvedConfig): void {
			config = resolvedConfig;
			assertPostBuildPluginOrder(resolvedConfig);
		},
		generateBundle: {
			order: "post",
			handler(_outputOptions, bundle): void {
				const integrities: Record<string, string> = {};
				for (const output of Object.values(bundle).sort((left, right) => compareStrings(left.fileName, right.fileName))) {
					if (!matchesFilter(output.fileName, output.type, filter)) continue;
					const content = output.type === "chunk" ? output.code : output.source;
					integrities[output.fileName] = generateIntegrity(content, algorithms);
				}

				const missing = new Set<string>();
				for (const output of Object.values(bundle)) {
					if (output.type !== "asset" || !/\.html?$/i.test(output.fileName)) continue;
					const source = typeof output.source === "string" ? output.source : Buffer.from(output.source).toString("utf8");
					const result = injectIntegrity(source, {
						htmlFileName: output.fileName,
						base: config.base,
						integrities,
						crossorigin: options.crossorigin,
						overwrite: options.overwrite,
					});
					output.source = result.html;
					for (const resource of result.missing) missing.add(`${output.fileName}: ${resource}`);
				}

				if (options.strict && missing.size > 0) {
					this.error(
						`[fast-vite:subresource-integrity] The following local HTML resources are missing from the build outputs:\n${[...missing]
							.sort(compareStrings)
							.map((item) => `- ${item}`)
							.join("\n")}`
					);
				}

				if (manifestFileName) {
					if (Object.hasOwn(bundle, manifestFileName)) {
						this.error(`[fast-vite:subresource-integrity] Integrity manifest conflicts with an existing output: ${manifestFileName}`);
					}
					this.emitFile({ type: "asset", fileName: manifestFileName, source: `${JSON.stringify(integrities, null, 2)}\n` });
				}
			},
		},
	};
}

function normalizeAlgorithms(configured: unknown): SubresourceIntegrityAlgorithm[] {
	const configuredAlgorithms = typeof configured === "string" ? [configured] : configured;
	if (
		!Array.isArray(configuredAlgorithms) ||
		configuredAlgorithms.length === 0 ||
		configuredAlgorithms.some(
			(algorithm) => typeof algorithm !== "string" || !SUPPORTED_ALGORITHMS.has(algorithm as SubresourceIntegrityAlgorithm)
		)
	) {
		throw new Error("[fast-vite:subresource-integrity] algorithms must be non-empty and contain only sha256, sha384, or sha512.");
	}
	return [...new Set(configuredAlgorithms)] as SubresourceIntegrityAlgorithm[];
}

function matchesFilter(fileName: string, type: "asset" | "chunk", filter: SubresourceIntegrityFilter): boolean {
	if (typeof filter === "function") return filter(fileName, type);
	filter.lastIndex = 0;
	return filter.test(fileName);
}

function eligibleResourceUrl(tag: string): string | undefined {
	const tagName = /^<\s*(link|script)\b/i.exec(tag)?.[1]?.toLowerCase();
	if (tagName === "script") return readAttribute(tag, "src");
	if (tagName !== "link") return undefined;

	const rel = readAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
	if (rel.includes("stylesheet") || rel.includes("modulepreload")) return readAttribute(tag, "href");
	if (rel.includes("preload")) {
		const as = readAttribute(tag, "as")?.toLowerCase();
		if (as === "script" || as === "style") return readAttribute(tag, "href");
	}
	return undefined;
}

function resolveHtmlResource(resourceUrl: string, htmlFileName: string, base: string): string | undefined {
	const withoutSuffix = resourceUrl.split(/[?#]/, 1)[0] ?? "";
	if (!withoutSuffix || withoutSuffix.startsWith("#") || /^(?:blob|data):/i.test(withoutSuffix)) return undefined;

	let resourcePath = withoutSuffix;
	const absoluteBase = parseHttpUrl(base);
	const absoluteResource = parseHttpUrl(resourcePath.startsWith("//") && absoluteBase ? `${absoluteBase.protocol}${resourcePath}` : resourcePath);
	if (absoluteResource) {
		if (absoluteBase?.origin !== absoluteResource.origin) return undefined;
		resourcePath = absoluteResource.pathname;
	} else if (/^[a-z][\w+.-]*:/i.test(resourcePath) || resourcePath.startsWith("//")) {
		return undefined;
	}

	let candidate: string;
	if (resourcePath.startsWith("/")) {
		const configuredBasePath = absoluteBase?.pathname ?? (base.startsWith("/") ? base : "/");
		const basePath = configuredBasePath.endsWith("/") ? configuredBasePath : `${configuredBasePath}/`;
		if (!resourcePath.startsWith(basePath)) return undefined;
		candidate = resourcePath.slice(basePath.length);
	} else {
		candidate = path.posix.join(path.posix.dirname(htmlFileName), resourcePath);
	}

	try {
		candidate = decodeURIComponent(candidate);
	} catch {
		return undefined;
	}
	const normalized = path.posix.normalize(candidate).replace(/^\.\//, "");
	return normalized.startsWith("../") ? undefined : normalized;
}

function transformHtmlTags(html: string, transform: (tag: string) => string): string {
	let output = "";
	let cursor = 0;
	let index = 0;
	while (index < html.length) {
		if (html.startsWith("<!--", index)) {
			const commentEnd = html.indexOf("-->", index + 4);
			index = commentEnd < 0 ? html.length : commentEnd + 3;
			continue;
		}
		if (html[index] !== "<" || !/^<(?:link|script)\b/i.test(html.slice(index))) {
			index += 1;
			continue;
		}

		let quote: "'" | '"' | undefined;
		let end = index + 1;
		for (; end < html.length; end += 1) {
			const character = html[end];
			if (quote) {
				if (character === quote) quote = undefined;
				continue;
			}
			if (character === '"' || character === "'") quote = character;
			else if (character === ">") break;
		}
		if (end >= html.length) break;
		output += html.slice(cursor, index) + transform(html.slice(index, end + 1));
		cursor = end + 1;
		index = cursor;
	}
	return output + html.slice(cursor);
}

function readAttribute(tag: string, name: string): string | undefined {
	const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
	return match?.[1] ?? match?.[2] ?? match?.[3];
}

function hasAttribute(tag: string, name: string): boolean {
	return new RegExp(`\\s${name}(?:\\s|=|/?>)`, "i").test(tag);
}

function setAttribute(tag: string, name: string, value: string): string {
	const attributePattern = new RegExp(`\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, "i");
	const attribute = ` ${name}="${value}"`;
	return attributePattern.test(tag) ? tag.replace(attributePattern, attribute) : tag.replace(/\s*\/?>$/, (ending) => `${attribute}${ending}`);
}

function resolveManifestFileName(manifest: boolean | string | undefined): string | undefined {
	if (!manifest) return undefined;
	const fileName = manifest === true ? "integrity-manifest.json" : normalizePath(manifest);
	if (!isSafeOutputFileName(fileName)) {
		throw new Error(`[fast-vite:subresource-integrity] manifest must be a safe relative path within outDir: ${fileName}`);
	}
	return fileName;
}

function parseHttpUrl(value: string): URL | undefined {
	if (!/^https?:\/\//i.test(value)) return undefined;
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
