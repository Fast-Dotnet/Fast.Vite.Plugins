import type { ConfigEnv, HtmlTagDescriptor, Plugin } from "vite";
import type { Awaitable } from "../shared/plugin";

/** 可安全转换为 HTML 文本的模板值。 */
export type HtmlTemplateValue = boolean | number | string;
/** HTML 占位符名称与替换值的只读映射。 */
export type HtmlTemplateData = Readonly<Record<string, HtmlTemplateValue>>;

/** 传递给动态模板数据和标签提供者的上下文 */
export interface HtmlTemplateContext extends ConfigEnv {
	/** 当前 HTML 入口路径 */
	path: string;
}

/** `htmlTemplate` 的配置 */
export interface HtmlTemplatePluginOptions {
	/** 静态模板数据，或根据当前命令、模式和 HTML 路径动态返回的数据。 */
	data: HtmlTemplateData | ((context: HtmlTemplateContext) => Awaitable<HtmlTemplateData>);
	/** 附加的 Vite HTML 标签描述符；函数允许异步返回。 */
	tags?: readonly HtmlTagDescriptor[] | ((context: HtmlTemplateContext) => Awaitable<readonly HtmlTagDescriptor[]>);
	/** 是否对替换值进行 HTML 转义。仅可信内容才应关闭。 @defaultValue `true` */
	escape?: boolean;
	/** 是否在仍有 `{{ NAME }}` 占位符时中止转换。 @defaultValue `false` */
	strict?: boolean;
}

/**
 * 替换 HTML 中的 `{{ KEY }}` 占位符。
 *
 * 未出现在 `data` 中的占位符保留原样；默认转义 HTML 特殊字符，避免配置值被解释为标记。
 *
 * @param html - Vite 当前处理的 HTML 源码。
 * @param data - 占位符名称与文本值的映射。
 * @param escape - 是否转义 HTML 特殊字符。
 * @returns 完成已知占位符替换后的 HTML。
 */
function replaceHtmlPlaceholders(html: string, data: HtmlTemplateData, escape = true): string {
	return html.replace(/\{\{\s*([_a-z][$\w.-]*)\s*\}\}/gi, (placeholder, key: string) => {
		if (!Object.hasOwn(data, key)) return placeholder;
		const value = String(data[key]);
		return escape ? escapeHtml(value) : value;
	});
}

/**
 * 注入 HTML 模板数据与 Vite `HtmlTagDescriptor` 标签。
 *
 * @param options - 模板数据、附加标签、转义与严格模式配置。
 * @returns 可直接加入 Vite `plugins` 的 HTML 模板插件。
 * @throws 选项或模板数据无效，以及 strict 模式仍有占位符时抛出异常。
 */
export function htmlTemplate(options: HtmlTemplatePluginOptions): Plugin {
	const configuredData: unknown = options.data;
	if (typeof configuredData !== "function" && (typeof configuredData !== "object" || configuredData === null || Array.isArray(configuredData))) {
		throw new Error("[fast-vite:html-template] data must be an object or a function.");
	}
	let env: ConfigEnv;

	return {
		name: "fast-vite:html-template",
		config(_config, configEnv): void {
			env = configEnv;
		},
		async transformIndexHtml(html, transformContext): Promise<{ html: string; tags: HtmlTagDescriptor[] }> {
			const context: HtmlTemplateContext = { ...env, path: transformContext.path };
			const data = typeof options.data === "function" ? await options.data(context) : options.data;
			const transformedHtml = replaceHtmlPlaceholders(html, data, options.escape ?? true);
			if (options.strict && /\{\{\s*[_a-z][$\w.-]*\s*\}\}/i.test(transformedHtml)) {
				throw new Error("[fast-vite:html-template] HTML contains unresolved placeholders.");
			}
			const tags = options.tags ? (typeof options.tags === "function" ? await options.tags(context) : options.tags) : [];
			return { html: transformedHtml, tags: [...tags] };
		},
	};
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = { "&": "&amp;", '"': "&quot;", "'": "&#39;", "<": "&lt;", ">": "&gt;" };
		return entities[character] ?? character;
	});
}
