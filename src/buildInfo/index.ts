import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConfigEnv, Plugin, ResolvedConfig } from "vite";
import type { BuildInfoContext, BuildInfoPluginOptions, BuildInformation } from "./type";

export type { BuildInfoContext, BuildInformation, BuildInfoPluginOptions } from "./type";

const RESOLVED_PREFIX = "\0fast-vite-plugins:";

/**
 * 解析一份构建信息对象，不修改项目的 `package.json` 或 `public` 目录。
 *
 * @param root - Vite 项目根目录的绝对路径。
 * @param options - 构建信息来源与输出配置。
 * @param env - 当前 Vite 命令和模式。
 * @returns 可直接序列化为 JSON 的构建信息。
 * @throws 无法得到有效版本号，或 package.json 不是合法 JSON 时抛出异常。
 */
async function resolveBuildInformation(root: string, options: BuildInfoPluginOptions, env: ConfigEnv): Promise<BuildInformation> {
	const version = options.version ?? (await readPackageVersion(path.resolve(root, options.packageJson ?? "package.json")));
	if (!version) throw new Error("[fast-vite:build-info] Unable to read the project version. Configure version or a valid packageJson.");

	const context: BuildInfoContext = { ...env, root };
	const customData = typeof options.data === "function" ? await options.data(context) : (options.data ?? {});
	const commit = options.commit ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? process.env.CI_COMMIT_SHA;
	return {
		...customData,
		version,
		builtAt: (options.now?.() ?? new Date()).toISOString(),
		mode: env.mode,
		...(commit ? { commit } : {}),
	};
}

/**
 * 在构建产物中生成版本信息 JSON，同时提供开发地址和虚拟模块。
 * 插件只读取版本清单，不会在构建过程中改写 package.json。
 *
 * @param options - 版本来源、输出文件、开发端点和虚拟模块配置。
 * @returns 可直接加入 Vite `plugins` 的构建信息插件。
 * @throws 产物文件名或虚拟模块 ID 无效时抛出异常。
 */
export function buildInfo(options: BuildInfoPluginOptions = {}): Plugin {
	const fileName = normalizeOutputFile(options.fileName ?? "build-info.json");
	const virtualModuleId = options.virtualModuleId ?? "virtual:fast-vite/build-info";
	if (virtualModuleId && !virtualModuleId.startsWith("virtual:")) {
		throw new Error("[fast-vite:build-info] virtualModuleId must start with virtual: or be set to false.");
	}
	let resolvedVirtualId: string | undefined;
	if (virtualModuleId !== false) resolvedVirtualId = `${RESOLVED_PREFIX}${virtualModuleId}`;
	let config: ResolvedConfig;
	let env: ConfigEnv;
	let information: Promise<BuildInformation>;

	const getInformation = async (): Promise<BuildInformation> => information;
	const serialize = async (): Promise<string> => `${JSON.stringify(await getInformation(), null, 2)}\n`;

	return {
		name: "fast-vite:build-info",
		config(_config, configEnv): void {
			env = configEnv;
		},
		async configResolved(resolvedConfig): Promise<void> {
			config = resolvedConfig;
			information = resolveBuildInformation(config.root, options, env);
			await information;
		},
		resolveId(id): string | undefined {
			return virtualModuleId && id === virtualModuleId ? resolvedVirtualId : undefined;
		},
		async load(id): Promise<string | undefined> {
			if (!resolvedVirtualId || id !== resolvedVirtualId) return undefined;
			const info = await getInformation();
			return `export const version = ${JSON.stringify(info.version)};\nexport default ${JSON.stringify(info)};\n`;
		},
		async generateBundle(): Promise<void> {
			this.emitFile({ type: "asset", fileName, source: await serialize() });
		},
		configureServer(server): void {
			if (options.dev === false) return;
			const basePath = new URL(config.base, "http://vite.local").pathname;
			const endpoint = path.posix.join("/", basePath, fileName);
			server.middlewares.use((request, response, next): void => {
				const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
				if (pathname !== endpoint) {
					next();
					return;
				}
				serialize()
					.then((body) => {
						response.statusCode = 200;
						response.setHeader("Content-Type", "application/json; charset=utf-8");
						response.setHeader("Cache-Control", "no-store");
						response.end(body);
					})
					.catch((error: unknown) => next(error));
			});
		},
	};
}

function normalizeOutputFile(fileName: string): string {
	const normalized = fileName.replaceAll("\\", "/");
	if (
		!normalized ||
		normalized === "." ||
		normalized.endsWith("/") ||
		normalized.startsWith("/") ||
		/^[a-z]:\//i.test(normalized) ||
		normalized.split("/").includes("..")
	) {
		throw new Error(`[fast-vite:build-info] fileName must be a relative path within the build directory: ${fileName}`);
	}
	return normalized;
}

async function readPackageVersion(packageFile: string): Promise<string> {
	try {
		const parsed = JSON.parse(await readFile(packageFile, "utf8")) as { version?: unknown };
		return typeof parsed.version === "string" ? parsed.version : "";
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
		throw error;
	}
}
