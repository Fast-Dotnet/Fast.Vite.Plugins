/** SVG 根元素支持的静态属性值。 */
export type SvgAttributeValue = boolean | number | string;

/** 解析后的 SVG 根元素属性与内部标记 */
export interface ParsedSvg {
	/** 标准化后的 `<svg>` 根元素属性。 */
	attributes: Record<string, SvgAttributeValue>;
	/** `<svg>` 根元素内部的原始标记 */
	content: string;
}

/** 传递给 SVG 过滤器和命名器的文件上下文 */
export interface SvgIconNameContext {
	/** SVG 文件绝对路径 */
	absolutePath: string;
	/** 相对于 SVG 根目录的路径，始终使用 `/`。 */
	relativePath: string;
	/** 插件计算出的默认组件名 */
	defaultName: string;
}

/** 扫描并解析后用于生成 Vue 图标组件的完整信息。 */
export interface ScannedSvgIcon extends SvgIconNameContext {
	/** 最终导出的组件名称 */
	name: string;
	/** SVG 根元素属性。 */
	attributes: Record<string, SvgAttributeValue>;
	/** SVG 根元素内部内容。 */
	content: string;
}

/** `svgIcons` 的配置 */
export interface SvgIconsPluginOptions {
	/** SVG 源目录，相对于 Vite `root`。 @defaultValue `"src/assets/icons"` */
	dir?: string;
	/** 图标根索引文件；每个图标生成到索引目录下的 `<SVG 相对路径>/index.tsx`。 @defaultValue `"src/icons/index.ts"` */
	output?: string;
	/** 是否递归扫描子目录 @defaultValue `true` */
	deep?: boolean;
	/** 默认组件名前缀。 @defaultValue `""` */
	componentPrefix?: string;
	/** 默认组件名后缀。 @defaultValue `""` */
	componentSuffix?: string;
	/** 返回 `false` 时排除当前 SVG。 */
	include?: (context: SvgIconNameContext) => boolean;
	/** 自定义组件名称；返回值必须是合法且唯一的 JavaScript 标识符。 */
	name?: (context: SvgIconNameContext) => string;
	/** 写入所有图标的默认根属性；源 SVG 中的同名属性优先。 */
	defaultAttributes?: Readonly<Record<string, SvgAttributeValue>>;
	/** 是否移除源文件的 `width` / `height`，便于通过 CSS 控制尺寸。 @defaultValue `false` */
	removeDimensions?: boolean;
	/** 开发模式文件变化的防抖时间，单位毫秒。 @defaultValue `80` */
	debounce?: number;
}
