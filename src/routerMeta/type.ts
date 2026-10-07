/** 传递给页面过滤、命名和键生成器的上下文 */
export interface RouterMetaContext {
	/** 文件绝对路径 */
	absolutePath: string;
	/** 相对于项目根目录的路径，始终使用 `/`。 */
	relativePath: string;
	/** 从 `defineOptions` 中提取到的名称；未声明时为 `undefined`。 */
	extractedName?: string;
	/** 根据文件名生成的 PascalCase 名称 */
	defaultName: string;
}

/** `routerMeta` 的配置 */
export interface RouterMetaPluginOptions {
	/** 页面目录，相对于 Vite `root`。 @defaultValue `"src/views"` */
	dir?: string;
	/** 输出 JSON 文件，相对于 Vite `root`。 @defaultValue `"src/router/routes.generated.json"` */
	output?: string;
	/** 是否递归扫描子目录 @defaultValue `true` */
	deep?: boolean;
	/** 页面文件扩展名，可带或不带点号。 @defaultValue `["vue", "tsx", "jsx"]` */
	extensions?: readonly string[];
	/** 返回 `false` 可排除指定页面。 */
	include?: (context: RouterMetaContext) => boolean;
	/** 自定义页面名称，默认优先使用 `defineOptions({ name })`。 */
	name?: (context: RouterMetaContext) => string;
	/** 自定义 JSON 对象中的路径键。 */
	key?: (context: RouterMetaContext) => string;
	/** JSON 缩进空格数。 @defaultValue `2` */
	indent?: number;
	/** 开发模式文件变化的防抖时间，单位毫秒。 @defaultValue `80` */
	debounce?: number;
}

/** 页面路径到稳定组件名称的映射。 */
export type RouterMetaMap = Record<string, string>;
