/**
 * 用最小桩验证两件事：
 * 1) 单独安装（没装 dsh-better-sidebar）时，仍然注册原来的浮层面板；
 * 2) 装了 dsh-better-sidebar 时，通过公开的 `ctx.betterSidebar.registerTab()`
 *    注册成侧栏页签，且**不再**注册浮层面板（避免出现两个终端）。
 *
 * 不渲染组件的完整 DOM 树：这个用例只关心「注册了哪个入口、页签描述符对不对」，
 * 组件本身由 tests/terminal-behavior.mjs 用最小 React 运行时覆盖。
 */
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

//#region 最小浏览器环境
/** 记录所有被创建的元素（只为让 ensureStyle 的 DOM 操作不崩）。 */
class El {
	constructor(tag) {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.style = {};
		this.className = "";
		this.textContent = "";
		this.id = "";
	}
	appendChild(child) {
		this.children.push(child);
		return child;
	}
	remove() {}
}
const head = new El("head");
const body = new El("body");
globalThis.document = {
	head,
	body,
	createElement: (tag) => new El(tag),
	getElementById: () => null,
	querySelector: () => null
};
globalThis.location = { protocol: "http:", host: "127.0.0.1:3080", hostname: "127.0.0.1" };
globalThis.localStorage = {
	store: new Map(),
	getItem(key) {
		return this.store.has(key) ? this.store.get(key) : null;
	},
	setItem(key, value) {
		this.store.set(key, String(value));
	}
};
//#endregion

//#region 加载插件
const react = {
	Fragment: Symbol("Fragment"),
	createElement: (type, props, ...kids) => ({ type, props: props ?? {}, kids })
};
const reactDomStub = { createPortal: (children) => children };
let loaded = null;
globalThis.window = globalThis;
globalThis.__ModuleLoader__ = { load: (m) => { loaded = m; } };
const requireStub = (name) => {
	if (name === "react") return react;
	if (name === "react-dom") return reactDomStub;
	throw new Error(`unexpected require(${name})`);
};
new Function("window", "require", code)(globalThis, requireStub);
const mod = loaded.factory(requireStub);
//#endregion

let pass = 0;
let fail = 0;
/**
 * 断言。
 * @param name - 用例名。
 * @param cond - 条件。
 * @param extra - 失败时的附加信息。
 * @returns 无返回值。
 */
function check(name, cond, extra = "") {
	if (cond) {
		pass++;
		console.log(`  ✅ ${name}`);
	} else {
		fail++;
		console.log(`  ❌ ${name}  ${extra}`);
	}
}

//#region 场景 1：没装 better-sidebar → 保持独立浮层面板
console.log("场景 1：单独安装（没有 betterSidebar 服务）");
/** 浮层槽注册到的组件。 */
let overlayComponent = null;
/** better-sidebar 的 registerTab 调用记录（场景 1 应为空）。 */
const tabCalls = [];
/** ctx.inject 记录（用于模拟 better-sidebar 晚到）。 */
let lateInject = null;
const ctx1 = {
	slots: {
		inject: (name, gen) => {
			gen()?.next?.();
			return () => {};
		},
		register: (descriptor, component) => {
			if (descriptor.name === "shell.overlay") overlayComponent = component;
			return () => {};
		}
	},
	/**
	 * 模拟 Cordis 的 ctx.effect：立即执行并返回清理函数。
	 * @param fn - 副作用函数。
	 * @returns 清理函数。
	 */
	effect: (fn) => {
		const dispose = fn();
		return typeof dispose === "function" ? dispose : () => {};
	},
	/**
	 * 没有 better-sidebar 服务。
	 * @returns 恒为 undefined。
	 */
	get: () => undefined,
	/**
	 * 记录晚到注入的回调。
	 * @param names - 服务名列表。
	 * @param callback - 注入回调。
	 * @returns 无返回值。
	 */
	inject: (names, callback) => {
		lateInject = callback;
	}
};
mod.apply(ctx1);
check("注册了 shell.overlay 浮层面板", overlayComponent !== null);
check("没有调用 better-sidebar 的 registerTab", tabCalls.length === 0);
check("inject 里带了 betterSidebar（便于晚到兜底）", typeof lateInject === "function");

//#region 场景 2：better-sidebar 晚于插件激活
console.log("\n场景 2：better-sidebar 晚到 → 切换成侧栏页签");
/** 模拟的 better-sidebar 服务。 */
const fakeSidebar = {
	/**
	 * 记录页签描述符。
	 * @param descriptor - 页签描述符。
	 * @returns 注销函数。
	 */
	registerTab: (descriptor) => {
		tabCalls.push(descriptor);
		return () => {};
	}
};
const injectedCtx = {
	/**
	 * 取 better-sidebar 服务。
	 * @param name - 服务名。
	 * @returns 服务对象。
	 */
	get: (name) => (name === "betterSidebar" ? fakeSidebar : undefined),
	/**
	 * 模拟 Cordis 的 ctx.effect。
	 * @param fn - 副作用函数。
	 * @returns 清理函数。
	 */
	effect: (fn) => {
		const dispose = fn();
		return typeof dispose === "function" ? dispose : () => {};
	}
};
lateInject(injectedCtx);
check("晚到后调用了 registerTab", tabCalls.length === 1, `实际 ${tabCalls.length}`);
check("页签描述符 id 正确", tabCalls[0]?.id === "dsh-terminal", tabCalls[0]?.id);
check("页签描述符区分了旧浮层（不再重复注册）", overlayComponent !== null && tabCalls.length === 1);
//#endregion

//#region 场景 3：启动时 better-sidebar 已存在 → 直接注册页签，不挂浮层
console.log("\n场景 3：启动时 betterSidebar 已存在 → 只注册页签");
/** 第二个模拟服务，验证重复 apply 场景。 */
const fakeSidebar2 = {
	/**
	 * 记录页签描述符。
	 * @param descriptor - 页签描述符。
	 * @returns 注销函数。
	 */
	registerTab: (descriptor) => {
		tabCalls.push(descriptor);
		return () => {};
	}
};
/** 场景 3 的浮层注册计数（应为 0）。 */
let overlayRegistrations = 0;
const ctx3 = {
	slots: {
		inject: () => {
			overlayRegistrations++;
			return () => {};
		},
		register: () => () => {}
	},
	/**
	 * 取 better-sidebar 服务。
	 * @param name - 服务名。
	 * @returns 服务对象。
	 */
	get: (name) => (name === "betterSidebar" ? fakeSidebar2 : undefined),
	/**
	 * 模拟 Cordis 的 ctx.effect。
	 * @param fn - 副作用函数。
	 * @returns 清理函数。
	 */
	effect: (fn) => {
		const dispose = fn();
		return typeof dispose === "function" ? dispose : () => {};
	}
};
mod.apply(ctx3);
check("启动了侧栏页签（registerTab 再调用一次）", tabCalls.length === 2, `实际 ${tabCalls.length}`);
check("没有注册浮层面板", overlayRegistrations === 0, `实际 ${overlayRegistrations}`);
//#endregion

//#region 场景 4：页签描述符的契约字段
console.log("\n场景 4：页签描述符字段");
const descriptor = tabCalls.at(-1);
check("id = dsh-terminal", descriptor?.id === "dsh-terminal");
check("title = 终端", descriptor?.title === "终端");
check("order = 45", descriptor?.order === 45, String(descriptor?.order));
check("single = true（同一会话重复打开聚焦已有页签）", descriptor?.single === true);
check("component 是函数", typeof descriptor?.component === "function");
check("onClose 是函数", typeof descriptor?.onClose === "function");
check("icon 是函数", typeof descriptor?.icon === "function");
const icon = typeof descriptor?.icon === "function" ? descriptor.icon(16) : null;
check("icon(16) 返回 svg", icon?.type === "svg", JSON.stringify(icon?.type));
check("description 提到独立进程", typeof descriptor?.description === "string" && descriptor.description.includes("独立进程"));
//#endregion

//#region 场景 5：关闭页签会回收对应工作区
console.log("\n场景 5：onClose 回收工作区会话");
let disposed = false;
try {
	// 直接调用 onClose：没有会话时也必须安全（幂等）。
	mod.apply({
		slots: {
			inject: (name, gen) => {
				gen()?.next?.();
				return () => {};
			},
			register: () => () => {}
		},
		get: () => undefined,
		inject: () => {},
		effect: (fn) => {
			const dispose = fn();
			return typeof dispose === "function" ? dispose : () => {};
		}
	});
	tabCalls.at(-1)?.onClose?.({}, { cwd: "/tmp/nowhere" });
	disposed = true;
} catch (error) {
	disposed = false;
	console.error(error);
}
check("onClose 对不存在的会话不抛错", disposed === true);
//#endregion

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
// 显式退出：client.js 里的消息合批通道（MessageChannel）在 Node 下会保持事件循环。
let nativeCloseCallback = null;
let nativeHookRegistered = false;
mod.apply({
	...ctx3,
	inject: (names, callback) => {
		if (!names.includes("sidebarRight")) return;
		callback({
			get: () => ({ registerCloseHandler: (kind, handler) => {
				nativeHookRegistered = kind === "dsh-terminal";
				nativeCloseCallback = handler;
				return () => {};
			} }),
			effect: (fn) => fn()
		});
	}
});
check("注册原生侧栏 × 关闭钩子", nativeHookRegistered);
nativeCloseCallback?.("unknown-session", { kind: "dsh-terminal" });
check("原生关闭未知会话安全", typeof nativeCloseCallback === "function");
// 执行页签组件本体，而非只检查 descriptor，防止渲染期 ReferenceError。
react.useState = (initial) => [typeof initial === "function" ? initial() : initial, () => {}];
react.useRef = (initial) => ({ current: initial });
react.useCallback = (fn) => fn;
react.useEffect = () => {};
let tabRendered = false;
try {
	const vnode = descriptor.component({ scope: { sessionId: "render-test", cwd: "D:\\test" }, tab: {}, visible: true });
	const tree = vnode.type(vnode.props);
	tabRendered = tree?.props?.["data-dsh-terminal-embed"] === "1";
} catch (error) {
	console.error(error);
}
check("页签组件实际渲染无 ReferenceError", tabRendered);
console.log(`\n最终结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
