/** 构建产物体积的计量方式 */
export type BundleSizeMode = "brotli" | "gzip" | "raw";

/** 构建产物的 Rolldown/Rollup 输出类型 */
export type BundleOutputType = "asset" | "chunk";

/**
 * 选择参与预算计算的构建产物。
 *
 * 正则表达式会在每次匹配前重置 `lastIndex`，因此可以安全使用 `g` 或 `y` 标志。
 */
export type BundleBudgetFilter = RegExp | ((fileName: string, type: BundleOutputType) => boolean);

/** 单条构建产物预算。 */
export interface BundleBudgetRule {
	/**
	 * 诊断信息中显示的稳定名称；显式名称必须非空且在当前配置中唯一。
	 *
	 * @defaultValue `budget-<index>`
	 */
	name?: string;
	/** 允许的最大字节数；必须是大于或等于 0 的有限整数。 */
	limit: number;
	/**
	 * 对每个匹配文件分别限制，或限制所有匹配文件的体积总和。
	 *
	 * @defaultValue `"file"`
	 */
	scope?: "file" | "total";
	/**
	 * 使用原始、gzip 或 Brotli 字节数进行比较。
	 *
	 * @defaultValue `"raw"`
	 */
	mode?: BundleSizeMode;
	/**
	 * 资源过滤器。默认包含除 source map、`.gz` 和 `.br` 之外的所有输出。
	 */
	filter?: BundleBudgetFilter;
	/**
	 * 没有任何文件匹配时是否视为配置错误，可防止文件改名后预算静默失效。
	 *
	 * @defaultValue `false`
	 */
	requireMatch?: boolean;
}

/** `bundleBudget` 的配置 */
export interface BundleBudgetPluginOptions {
	/** 至少一条预算规则；规则按声明顺序执行和报告。 */
	budgets: readonly BundleBudgetRule[];
	/**
	 * 超出预算时让构建失败，或只输出 Vite 警告。
	 *
	 * @defaultValue `"error"`
	 */
	onExceed?: "error" | "warn";
}

/** 插件内部用于预算测量的最小构建产物结构。 */
export interface MeasurableBundleOutput {
	/** `outDir` 内的相对文件名 */
	fileName: string;
	/** 产物类型 */
	type: BundleOutputType;
	/** 资产源码或代码内容。 */
	source: string | Uint8Array;
}

/** 单个匹配文件的计量结果 */
export interface BundleBudgetFileMeasurement {
	/** `outDir` 内的相对文件名 */
	fileName: string;
	/** 以当前规则计量方式计算的字节数。 */
	bytes: number;
	/** 产物类型 */
	type: BundleOutputType;
}

/** 单条预算的完整评估结果 */
export interface BundleBudgetEvaluation {
	/** 预算在诊断信息中的名称 */
	name: string;
	/** 预算上限字节数。 */
	limit: number;
	/** 当前计量方式 */
	mode: BundleSizeMode;
	/** 当前聚合范围 */
	scope: "file" | "total";
	/** 按文件名稳定排序的匹配结果 */
	files: readonly BundleBudgetFileMeasurement[];
	/** `scope: "total"` 时为总和，否则为最大单文件体积。 */
	actualBytes: number;
	/** 是否因为超限或 `requireMatch` 而失败。 */
	exceeded: boolean;
	/** `requireMatch: true` 且未匹配产物时为 `true`。 */
	missingMatch: boolean;
}
