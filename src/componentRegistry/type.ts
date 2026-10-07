/** 组件名称解析器能够使用的文件上下文 */
export interface ComponentNameContext {
	/** 组件绝对路径 */
	absolutePath: string;
	/** 相对于当前扫描目录的路径，始终使用 `/`。 */
	relativePath: string;
	/** 插件根据文件名计算出的默认 PascalCase 导出名称 */
	defaultName: string;
}

/** 扫描后用于生成组件入口与类型声明的组件信息。 */
export interface ScannedComponent extends ComponentNameContext {
	/** 最终使用的 JavaScript 导出标识符。 */
	name: string;
}

/** `componentRegistry` 的配置 */
export interface ComponentRegistryPluginOptions {
	/** 要扫描的组件目录，相对于 Vite `root`；可以配置多个。 @defaultValue `"src/components"` */
	dirs?: string | readonly string[];
	/** 生成的组件、实例类型与全局注册方法入口；设为 `false` 可关闭。 @defaultValue `"src/components/index.ts"` */
	output?: false | string;
	/** 生成的 Vue 全局组件类型声明；设为 `false` 可关闭。 @defaultValue `"types/components.d.ts"` */
	dts?: false | string;
	/** 是否递归扫描子目录 @defaultValue `true` */
	deep?: boolean;
	/** 支持的组件文件扩展名，可带或不带点号。 @defaultValue `["vue", "tsx", "jsx"]` */
	extensions?: readonly string[];
	/** 返回 `false` 可排除指定组件。 */
	include?: (context: ComponentNameContext) => boolean;
	/** 自定义导出标识符；返回值必须是合法的 JavaScript 标识符。 */
	name?: (context: ComponentNameContext) => string;
	/** 重名组件的处理方式 @defaultValue `"error"` */
	conflict?: "error" | "overwrite" | "warn";
	/** 开发模式文件变化的防抖时间，单位毫秒。 @defaultValue `80` */
	debounce?: number;
}
