/** 浏览器 Subresource Integrity 支持的哈希算法。 */
export type SubresourceIntegrityAlgorithm = "sha256" | "sha384" | "sha512";

/** 选择需要生成完整性摘要的构建产物。 */
export type SubresourceIntegrityFilter = RegExp | ((fileName: string, type: "asset" | "chunk") => boolean);

/** HTML 标签使用的 CORS 凭据模式 */
export type IntegrityCrossorigin = "anonymous" | "use-credentials" | false;

/** `subresourceIntegrity` 的配置 */
export interface SubresourceIntegrityPluginOptions {
	/**
	 * 一个或多个摘要算法；多个结果会按声明顺序写入同一个 `integrity` 属性。
	 *
	 * @defaultValue `"sha384"`
	 */
	algorithms?: SubresourceIntegrityAlgorithm | readonly SubresourceIntegrityAlgorithm[];
	/**
	 * 要计算摘要的资源。默认只包含 JavaScript 与 CSS，不包含 source map 和预压缩副本。
	 */
	filter?: SubresourceIntegrityFilter;
	/**
	 * 注入本地资源标签的 `crossorigin` 属性；`false` 表示不自动注入。
	 *
	 * @defaultValue `"anonymous"`
	 */
	crossorigin?: IntegrityCrossorigin;
	/**
	 * 是否覆盖本地标签已有的 `integrity` 与 `crossorigin` 属性。
	 *
	 * @defaultValue `true`
	 */
	overwrite?: boolean;
	/**
	 * 是否输出文件名到完整性摘要的 JSON 映射。`true` 使用
	 * `integrity-manifest.json`，字符串指定 `outDir` 内相对路径。
	 *
	 * @defaultValue `false`
	 */
	manifest?: boolean | string;
	/**
	 * 本地脚本、样式或 modulepreload 标签无法对应到构建产物时是否让构建失败。
	 * publicDir 资源不在 bundle 中，使用它们时应保持关闭或自行纳入构建图。
	 *
	 * @defaultValue `false`
	 */
	strict?: boolean;
}

/** 内部 HTML 完整性注入参数 */
export interface IntegrityInjectionOptions {
	/** 当前 HTML 在 `outDir` 内的相对文件名 @defaultValue `"index.html"` */
	htmlFileName?: string;
	/** Vite 已解析的 `base`，支持根路径、相对路径和完整 URL。 @defaultValue `"/"` */
	base?: string;
	/** 文件名到完整 `algorithm-base64` 摘要的映射。 */
	integrities: Readonly<Record<string, string>>;
	/** 自动注入的 `crossorigin`。 @defaultValue `"anonymous"` */
	crossorigin?: IntegrityCrossorigin;
	/** 是否更新已有属性。 @defaultValue `true` */
	overwrite?: boolean;
}

/** HTML 完整性注入的确定性结果 */
export interface IntegrityInjectionResult {
	/** 转换后的 HTML。 */
	html: string;
	/** 成功注入或更新的构建产物文件名，已去重并稳定排序。 */
	injected: readonly string[];
	/** 无法对应构建产物的本地脚本、样式或 modulepreload URL。 */
	missing: readonly string[];
}
