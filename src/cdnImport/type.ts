import type { ConfigEnv, HtmlTagDescriptor } from "vite";
import type { Awaitable } from "../shared/plugin";

/** 注入到 Vite HTML 标签的属性字典。 */
export type CdnTagAttributes = NonNullable<HtmlTagDescriptor["attrs"]>;

/** 单个 npm 模块的 CDN 资源和浏览器全局变量映射。 */
export interface CdnModule {
	/** npm 包名，也是源码 import 使用的模块名。 */
	name: string;
	/** 浏览器全局变量，例如 `Vue`、`ReactDOM` 或 `dayjs`。 */
	global: string;
	/** 固定版本；省略时默认从项目 `node_modules` 中读取。 */
	version?: string;
	/** JavaScript 文件相对路径或完整 URL。 */
	js: string | readonly string[];
	/** CSS 文件相对路径或完整 URL。 */
	css?: string | readonly string[];
	/** 需要映射到同一全局变量的额外模块名。 */
	aliases?: readonly string[];
	/** 覆盖当前模块的 URL 模板。 */
	urlTemplate?: string;
	/** 注入到 script 标签的额外属性。 */
	scriptAttributes?: CdnTagAttributes;
	/** 注入到 link 标签的额外属性。 */
	styleAttributes?: CdnTagAttributes;
}

/** 动态 CDN 模块解析器可读取的 Vite 环境与路径信息。 */
export interface CdnModuleResolverContext extends ConfigEnv {
	/** Vite 项目根目录的绝对路径 */
	root: string;
	/** 当前生效的默认 URL 模板。 */
	urlTemplate: string;
}

/** 根据当前 Vite 命令和模式异步解析一个 CDN 模块。 */
export type CdnModuleResolver = (context: CdnModuleResolverContext) => Awaitable<CdnModule>;

/** 已补全版本和最终资源 URL 的 CDN 模块。 */
export interface ResolvedCdnModule extends CdnModule {
	/** 按配置顺序生成的 CSS 完整 URL。 */
	cssUrls: readonly string[];
	/** 按配置顺序生成的 JavaScript 完整 URL。 */
	jsUrls: readonly string[];
	/** 显式配置或从依赖清单读取的版本。 */
	version: string;
}

/** `cdnImport` 的配置 */
export interface CdnImportPluginOptions {
	/** CDN 模块或按 Vite mode 动态返回模块的函数。 */
	modules: CdnModule | CdnModuleResolver | readonly (CdnModule | CdnModuleResolver)[];
	/** CDN URL 模板，支持 `{name}`、`{version}`、`{path}`。 @defaultValue {@link cdnJsDelivrUrl} */
	urlTemplate?: string;
	/** 是否在开发服务器中也使用 CDN。 @defaultValue `false` */
	dev?: boolean;
	/** 是否自动从 `node_modules` 读取缺失的版本。 @defaultValue `true` */
	resolveVersion?: boolean;
	/** 是否在 SSR 转换中使用浏览器全局变量。通常不应启用。 @defaultValue `false` */
	ssr?: boolean;
	/** 默认 `crossorigin` 属性；设为 `false` 可不输出。 @defaultValue `"anonymous"` */
	crossorigin?: false | "anonymous" | "use-credentials";
	/** 默认标签注入位置。 @defaultValue `"head-prepend"` */
	injectTo?: HtmlTagDescriptor["injectTo"];
	/** 自定义 script 标签。 */
	generateScriptTag?: (module: ResolvedCdnModule, url: string) => Omit<HtmlTagDescriptor, "tag" | "children">;
	/** 自定义 link 标签。 */
	generateStyleTag?: (module: ResolvedCdnModule, url: string) => Omit<HtmlTagDescriptor, "tag" | "children">;
}
