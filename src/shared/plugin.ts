import type { ViteDevServer } from "vite";

/** 同步值或异步结果 */
export type Awaitable<T> = Promise<T> | T;
/** JSON 支持的原始值。 */
export type JsonPrimitive = boolean | null | number | string;
/** 可递归序列化为 JSON 的值。 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** 可调度并取消尚未开始执行任务的防抖函数。 */
export interface DebouncedTask {
	/** 重新安排任务；连续调用只保留最后一次等待。 */
	(): void;
	/** 取消仍在等待的计时器；已经开始的异步任务不会被中断。 */
	cancel(): void;
}

/**
 * 简单防抖器，用于合并编辑器一次保存触发的多次文件系统事件。
 *
 * @param task - 延迟后执行的同步或异步任务。
 * @param delay - 防抖等待时间，单位毫秒。
 * @param onError - 同步任务抛错或异步任务拒绝时的统一错误处理器。
 * @returns 可重复调度并取消等待任务的函数。
 */
export function createDebouncedTask(task: () => Awaitable<void>, delay: number, onError: (error: unknown) => void): DebouncedTask {
	let timer: NodeJS.Timeout | undefined;
	let running: Promise<void> | undefined;
	let queued = false;
	let disposed = false;

	const execute = (): void => {
		if (disposed) return;
		if (running) {
			queued = true;
			return;
		}

		// 先进入 Promise 链，同步抛错与异步拒绝都交给同一错误处理器。
		running = Promise.resolve()
			.then(task)
			.catch(onError)
			.finally(() => {
				running = undefined;
				if (queued && !disposed) {
					queued = false;
					scheduleTask();
				}
			});
	};

	function scheduleTask(): void {
		if (disposed) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout((): void => {
			timer = undefined;
			execute();
		}, delay);
	}

	const schedule = scheduleTask as DebouncedTask;

	schedule.cancel = (): void => {
		disposed = true;
		if (timer) clearTimeout(timer);
		timer = undefined;
		queued = false;
	};

	return schedule;
}

/** 在普通 HTTP 与 middleware mode 下都注册一次性的开发服务器清理逻辑。 */
export function onServerClose(server: Pick<ViteDevServer, "httpServer" | "watcher">, cleanup: () => void): void {
	let disposed = false;
	const close = (): void => {
		if (disposed) return;
		disposed = true;
		server.httpServer?.off("close", close);
		server.watcher.off("close", close);
		cleanup();
	};
	server.httpServer?.once("close", close);
	server.watcher.once("close", close);
}
