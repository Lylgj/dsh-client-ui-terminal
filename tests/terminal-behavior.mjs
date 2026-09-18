/**
 * 用最小 React 运行时驱动真实的 client.js 组件，验证“每个工作区一个常驻终端”的行为。
 * 覆盖：会话建立、WS URL 带 cwd、切换工作区不关旧 WS、切回不重建、隐藏终端仍在收数据。
 */
import { readFileSync } from "node:fs";

// 直接测本仓库的 lib/client.js（本文件位于 <repo>/tests/ 下）
const P = new URL("../lib/client.js", import.meta.url);
/** 测试夹具：工作区目录，可用 DSH_TERM_WS_A / _B / _C 覆盖。 */
const WS_A = process.env.DSH_TERM_WS_A ?? "/tmp/dsh-term-ws-a";
const WS_B = process.env.DSH_TERM_WS_B ?? "/tmp/dsh-term-ws-b";
const WS_C = process.env.DSH_TERM_WS_C ?? "/tmp/dsh-term-ws-c";
const code = readFileSync(P, "utf8");

//#region 最小 DOM
/** 记录所有被创建的元素，便于断言宿主 div 的显示状态。 */
const allEls = [];
class El {
	constructor(tag) {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.style = {};
		this.className = "";
		this.textContent = "";
		this.id = "";
		this.parent = null;
		allEls.push(this);
	}
	appendChild(c) {
		c.parent = this;
		this.children.push(c);
		if (this.tagName === "HEAD" && c.tagName === "SCRIPT") queueMicrotask(() => c.onload?.());
		return c;
	}
	get clientWidth() {
		return this.style.display === "none" ? 0 : 800;
	}
	get clientHeight() {
		return this.style.display === "none" ? 0 : 400;
	}
	remove() {
		if (this.parent !== null) this.parent.children = this.parent.children.filter((x) => x !== this);
	}
	get parentElement() {
		return this.parent;
	}
	getAttribute(k) {
		return this[k] ?? null;
	}
}
const head = new El("head");
/** AppFrame 骨架：overlay 层是 frame 的子节点，插件靠它反查 frame 并让 frame 让位。 */
const frameEl = new El("div");
const overlayEl = new El("div");
overlayEl.setAttribute?.("data-shell-overlay", "true");
frameEl.appendChild(overlayEl);
const bodyEl = new El("body");
/** 记录 createPortal 调用，验证面板确实挂到了 body。 */
const portals = [];
const reactDomStub = {
	createPortal: (children, container) => {
		portals.push({ children, container });
		return children;
	}
};
globalThis.document = {
	head,
	body: bodyEl,
	createElement: (t) => new El(t),
	getElementById: () => null,
	querySelector: (sel) => (sel === "[data-shell-overlay]" ? overlayEl : null)
};
//#endregion

//#region 浏览器环境桩
globalThis.location = {
	protocol: "http:",
	host: process.env.DSH_TERM_HOST ?? "127.0.0.1:3080",
	hostname: (process.env.DSH_TERM_HOST ?? "127.0.0.1:3080").split(":")[0],
};
globalThis.localStorage = { store: new Map(), getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }, setItem(k, v) { this.store.set(k, String(v)); } };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ shell: "/bin/bash", cwd: WS_A, busy: false }), text: async () => "{}" });

/** 所有已创建的 PTY WebSocket。 */
const sockets = [];
globalThis.WebSocket = class {
	static OPEN = 1;
	/**
	 * 设成某个子串后，URL 命中它的连接会被"拒绝"（不握手直接关闭），
	 * 用来模拟独立终端进程不可达、验证前端回退到同源路由。
	 */
	static refuseSubstring = null;
	constructor(url) {
		this.url = url;
		this.readyState = 0;
		this.sent = [];
		this.closed = false;
		sockets.push(this);
		if (globalThis.WebSocket.refuseSubstring !== null && url.includes(globalThis.WebSocket.refuseSubstring)) {
			queueMicrotask(() => {
				this.closed = true;
				this.readyState = 3;
				this.onclose?.();
			});
			return;
		}
		queueMicrotask(() => {
			if (this.closed) return;
			this.readyState = 1;
			this.onopen?.();
		});
	}
	send(d) { this.sent.push(d); }
	close() { this.closed = true; this.readyState = 3; }
};

/** 所有已创建的 xterm 实例。 */
const terms = [];
globalThis.Terminal = class {
	constructor(opts) { this.cols = 80; this.rows = 24; this.written = []; this.disposed = false; this.options = opts ?? {}; terms.push(this); }
	loadAddon() {}
	open() {}
	onData(cb) { this.onDataCb = cb; }
	onResize(cb) { this.onResizeCb = cb; }
	onTitleChange() {}
	write(t) { this.written.push(t); }
	clear() {}
	focus() {}
	dispose() { this.disposed = true; }
};
globalThis.FitAddon = { FitAddon: class { fit() {} } };
//#endregion

//#region 最小 React（hook 顺序稳定，支持依赖比较与重新渲染）
const react = {
	Fragment: Symbol("Fragment"),
	/**
	 * 极简 createElement：插件在工厂执行时就捕获 `react.createElement`，
	 * 因此这里必须在加载插件之前就绪。
	 * @param type - 元素类型。
	 * @param p - 属性。
	 * @param kids - 子节点。
	 * @returns vnode。
	 */
	createElement: (type, p, ...kids) => {
		const pr = p ?? {};
		// 宿主标签直接产出真实 DOM 元素（ref.current 必须是 DOM 节点）
		if (typeof type === "string") {
			const el = new El(type);
			el.__props = pr;
			el.__kids = kids;
			if (pr.className !== undefined) el.className = pr.className;
			if (pr.id !== undefined) el.id = pr.id;
			if (pr.style !== undefined) Object.assign(el.style, pr.style);
			for (const k of Object.keys(pr)) if (k.startsWith("data-")) el[k] = pr[k];
			if (pr.ref !== null && pr.ref !== undefined && typeof pr.ref === "object") pr.ref.current = el;
			return el;
		}
		const el = { type, props: pr, kids };
		if (pr.ref !== null && pr.ref !== undefined && typeof pr.ref === "object") pr.ref.current = el;
		return el;
	}
};

/**
 * 为一个组件创建 hook 运行时。
 * @param Component - 组件函数。
 * @returns render 方法。
 */
function makeRuntime(Component) {
	const hooks = [];
	let cursor = 0;
	let props = {};
	let queued = false;

	/**
	 * 比较两次依赖是否相同。
	 * @param a - 旧依赖。
	 * @param b - 新依赖。
	 * @returns 是否相同。
	 */
	const sameDeps = (a, b) => {
		if (a === undefined || b === undefined) return false;
		if (a.length !== b.length) return false;
		return a.every((x, k) => Object.is(x, b[k]));
	};

	/**
	 * 安排一次重新渲染（异步，模拟 React 的批处理）。
	 * @returns 无返回值。
	 */
	const schedule = () => {
		if (queued) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			render();
		});
	};

	const api = {
		useState(init) {
			const i = cursor++;
			if (hooks[i] === undefined) hooks[i] = { v: typeof init === "function" ? init() : init };
			const h = hooks[i];
			return [h.v, (nv) => {
				const next = typeof nv === "function" ? nv(h.v) : nv;
				if (Object.is(next, h.v)) return;
				h.v = next;
				schedule();
			}];
		},
		useRef(init) {
			const i = cursor++;
			if (hooks[i] === undefined) hooks[i] = { current: init };
			return hooks[i];
		},
		useCallback(fn, deps) {
			const i = cursor++;
			const prev = hooks[i];
			if (prev !== undefined && sameDeps(prev.deps, deps)) return prev.fn;
			hooks[i] = { fn, deps };
			return fn;
		},
		useEffect(fn, deps) {
			const i = cursor++;
			const prev = hooks[i];
			if (prev !== undefined && deps !== undefined && sameDeps(prev.deps, deps)) return;
			pending.push({ i, fn, deps, cleanup: prev?.cleanup });
		}
	};
	let pending = [];

	/**
	 * 渲染一次并执行需要重跑的副作用。
	 * @param nextProps - 新的 props。
	 * @returns 组件返回的 vnode。
	 */
	function render(nextProps) {
		if (nextProps !== undefined) props = nextProps;
		cursor = 0;
		pending = [];
		const vnode = Component(props);
		for (const p of pending) {
			p.cleanup?.();
			const c = p.fn();
			hooks[p.i] = { deps: p.deps, cleanup: typeof c === "function" ? c : undefined };
		}
		return vnode;
	}
	return { render, api };
}
//#endregion

// 加载插件
let loaded = null;
globalThis.window = globalThis;
globalThis.__ModuleLoader__ = { load: (m) => { loaded = m; } };
new Function("window", "require", code)(globalThis, (s) => {
	if (s === "react") return react;
	if (s === "react-dom") return reactDomStub;
	throw new Error("unexpected " + s);
});
const mod = loaded.factory((s) => (s === "react" ? react : s === "react-dom" ? reactDomStub : null));

let Comp = null;
mod.apply({
	slots: {
		inject: (n, fn) => { fn()?.next?.(); return () => {}; },
		register: (o, C) => { Comp = C; return () => {}; }
	}
});

const rt = makeRuntime(Comp);
// 组件通过 react.useXxx 调用 hook：只装 hook，createElement 已在加载前就绪
Object.assign(react, { useState: rt.api.useState, useRef: rt.api.useRef, useCallback: rt.api.useCallback, useEffect: rt.api.useEffect });

const store = { current: "s1", byId: { s1: { cwd: WS_A }, s2: { cwd: WS_B }, s3: { cwd: WS_C } } };
const useSessions = (sel) => sel(store);
const props = { useSessions };

/** 渲染并让异步链（loadAssets -> Terminal -> WebSocket）跑完。 */
async function settle() {
	rt.render(props);
	for (let i = 0; i < 15; i++) await Promise.resolve();
}

/** 取某个工作区对应的宿主 div。 */
const hostOf = (cwd) => allEls.filter((e) => e.className === "dsh-term-host" && e.__cwd === cwd)[0];

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
	if (cond) { pass++; console.log(`  ✅ ${name}`); }
	else { fail++; console.log(`  ❌ ${name}  ${extra}`); }
};

console.log("场景 1：初始工作区 A");
await settle();
check("建立 1 个 xterm", terms.length === 1, `实际 ${terms.length}`);
check("建立 1 条 WS", sockets.length === 1, `实际 ${sockets.length}`);
check("WS 带 cwd=工作区 A", decodeURIComponent(sockets[0]?.url ?? "").includes("cwd=" + WS_A), sockets[0]?.url);
check("WS 带 cols/rows", /cols=80/.test(sockets[0]?.url ?? "") && /rows=24/.test(sockets[0]?.url ?? ""), sockets[0]?.url);

console.log("\n场景 2：切到工作区 B —— 旧终端必须继续存活");
store.current = "s2";
await settle();
check("新增 1 个 xterm（共 2）", terms.length === 2, `实际 ${terms.length}`);
check("新增 1 条 WS（共 2）", sockets.length === 2, `实际 ${sockets.length}`);
check("新 WS 带 cwd=工作区 B", decodeURIComponent(sockets[1]?.url ?? "").includes("cwd=" + WS_B), sockets[1]?.url);
check("旧 WS 未被关闭（常驻）", sockets[0]?.closed === false, `closed=${sockets[0]?.closed}`);
check("旧 xterm 未被销毁", terms[0]?.disposed === false);

console.log("\n场景 3：切回工作区 A —— 不得重建");
store.current = "s1";
await settle();
check("没有新增 xterm（仍 2 个）", terms.length === 2, `实际 ${terms.length}`);
check("没有新增 WS（仍 2 条）", sockets.length === 2, `实际 ${sockets.length}`);
check("两条 WS 都还活着", sockets.every((s) => !s.closed));

console.log("\n场景 4：隐藏中的终端仍在收数据（滚动缓冲不丢）");
const before = terms[0].written.length;
sockets[0].onmessage?.({ data: "hello-from-test" });
// 浏览器半边刻意把写入合批到同一个宏任务里（避免逐帧重排），所以这里要等一拍。
await new Promise((resolve) => setTimeout(resolve, 20));
check("旧终端收到并写入数据", terms[0].written.length > before && terms[0].written.at(-1) === "hello-from-test");

console.log("\n场景 5：收起/展开不销毁 shell");
globalThis.__DSH_TERMINAL__.close();
for (let i = 0; i < 15; i++) await Promise.resolve();
check("收起后仍无 WS 被关闭", sockets.every((s) => !s.closed));
check("收起后 xterm 未被销毁", terms.every((t) => !t.disposed));
globalThis.__DSH_TERMINAL__.open();
for (let i = 0; i < 15; i++) await Promise.resolve();
check("展开后依旧只有 2 条 WS（未重建）", sockets.length === 2, `实际 ${sockets.length}`);

console.log("\n场景 6：调试入口能列出各工作区终端");
const list = globalThis.__DSH_TERMINAL__.sessions();
check("列出两个工作区", list.length === 2 && list.includes(WS_A) && list.includes(WS_B), JSON.stringify(list));

console.log("\n场景 7：并排模式让 DSH 框架让位（不再遮挡）");
const T = globalThis.__DSH_TERMINAL__;
const panelEl = allEls.filter((e) => e.className === "dsh-term-panel").at(-1);
check("默认模式为并排 dock", T.mode() === "dock", T.mode());
check("面板经 portal 挂到 body", portals.length > 0 && portals.at(-1).container === bodyEl, `portals=${portals.length}`);
check("面板标注 data-mode=dock", panelEl?.["data-mode"] === "dock", String(panelEl?.["data-mode"]));
check("框架 marginRight = 面板宽度 460px", T.frameMargin() === "460px", JSON.stringify(T.frameMargin()));
check("框架仍是 overlay 的父节点", overlayEl.parentElement === frameEl);

console.log("\n场景 8：切到浮层模式，框架恢复全宽");
T.toggleLayout();
for (let i = 0; i < 15; i++) await Promise.resolve();
check("模式为 overlay", globalThis.__DSH_TERMINAL__.mode() === "overlay", globalThis.__DSH_TERMINAL__.mode());
check("框架 marginRight 已清空", T.frameMargin() === "", JSON.stringify(T.frameMargin()));
check("面板标注 data-mode=overlay", allEls.filter((e) => e.className === "dsh-term-panel").at(-1)?.["data-mode"] === "overlay");
check("切换布局未影响常驻终端", sockets.length === 2 && sockets.every((x) => !x.closed));

console.log("\n场景 9：切回并排；收起时不占位、展开后恢复");
T.toggleLayout();
for (let i = 0; i < 15; i++) await Promise.resolve();
check("回到 dock，让位恢复", globalThis.__DSH_TERMINAL__.mode() === "dock" && T.frameMargin() === "460px", JSON.stringify(T.frameMargin()));
T.close();
for (let i = 0; i < 15; i++) await Promise.resolve();
check("收起后不占位（margin 清空）", T.frameMargin() === "", JSON.stringify(T.frameMargin()));
T.open();
for (let i = 0; i < 15; i++) await Promise.resolve();
check("展开后重新让位", T.frameMargin() === "460px", JSON.stringify(T.frameMargin()));
check("全程没有关闭任何 WS", sockets.every((x) => !x.closed));

// === 场景 10：明暗主题切换 ===
console.log("\n场景 10：明暗主题切换");
const panelNow = () => allEls.filter((e) => e.className === "dsh-term-panel").at(-1);
const tabNow = () => allEls.filter((e) => e.className === "dsh-term-tab").at(-1);
const themeBtn = (label) => allEls.filter((e) => e.tagName === "BUTTON" && (e.__kids ?? []).includes(label)).at(-1);

check("默认调色板为浅色", terms[0]?.options?.theme?.background === "#ffffff", String(terms[0]?.options?.theme?.background));
check("面板 data-theme=light", panelNow()?.["data-theme"] === "light", String(panelNow()?.["data-theme"]));
check("头部有「浅色」按钮", themeBtn("浅色") !== undefined);

// 悬浮按钮只在收起时渲染，所以先收起
T.close();
await settle();
check("收起后悬浮按钮为浅色", tabNow()?.["data-theme"] === "light", String(tabNow()?.["data-theme"]));
T.open();
await settle();

// 真实点击头部按钮切到暗色
themeBtn("浅色").__props.onClick();
await settle();
check("切到暗色", globalThis.__DSH_TERMINAL__.theme() === "dark", globalThis.__DSH_TERMINAL__.theme());
check("两个常驻终端同时换成暗色调色板",
  terms.length === 2 && terms.every((t) => t.options.theme?.background === "#1b1b25"),
  terms.map((t) => t.options.theme?.background).join(","));
check("暗色前景为 #cdd6f4", terms[0]?.options?.theme?.foreground === "#cdd6f4", String(terms[0]?.options?.theme?.foreground));
check("面板 data-theme=dark", panelNow()?.["data-theme"] === "dark", String(panelNow()?.["data-theme"]));
check("按钮文案变为「暗色」", themeBtn("暗色") !== undefined);
check("主题写入 localStorage", globalThis.localStorage.getItem("dsh.terminal.theme") === "dark", String(globalThis.localStorage.getItem("dsh.terminal.theme")));
check("换主题没有重建终端", sockets.length === 2 && terms.length === 2 && sockets.every((x) => !x.closed), "sockets=" + sockets.length + " terms=" + terms.length);

T.close();
await settle();
check("收起后悬浮按钮变为暗色", tabNow()?.["data-theme"] === "dark", String(tabNow()?.["data-theme"]));
T.open();
await settle();

// 换主题后新开工作区：新终端应以当前主题创建（验证 themeRef）
store.current = "s3";
await settle();
check("新工作区新建了终端（共 3）", terms.length === 3, "实际 " + terms.length);
check("新终端按当前主题创建（暗色）", terms.at(-1)?.options?.theme?.background === "#1b1b25", String(terms.at(-1)?.options?.theme?.background));

// 点回去，三个终端一起变浅
themeBtn("暗色").__props.onClick();
await settle();
check("切回浅色", globalThis.__DSH_TERMINAL__.theme() === "light", globalThis.__DSH_TERMINAL__.theme());
check("三个终端全部回到浅色调色板",
  terms.length === 3 && terms.every((t) => t.options.theme?.background === "#ffffff"),
  terms.map((t) => t.options.theme?.background).join(","));
check("面板 data-theme=light（回到浅色）", panelNow()?.["data-theme"] === "light", String(panelNow()?.["data-theme"]));
check("主题切换全程没有关闭任何 WS", sockets.every((x) => !x.closed));

console.log("\n场景 11：终端后端选择（优先独立进程，不可达时回退同源）");
check("默认优先连独立终端进程 :3110", sockets[0]?.url.includes(":3110/ws"), String(sockets[0]?.url));
check("独立进程 URL 带 cols/rows/cwd", /cols=\d+/.test(sockets[0]?.url ?? "") && sockets[0].url.includes("cwd="), String(sockets[0]?.url));

globalThis.WebSocket.refuseSubstring = ":3110";
const socketsBefore = sockets.length;
store.current = "s4";
await settle();
const fallback = sockets.at(-1);
check("独立进程不可达时新增了一条连接", sockets.length > socketsBefore, `新增 ${sockets.length - socketsBefore}`);
check("回退到同源路由 /dsh-terminal/ws", fallback?.url.includes("/dsh-terminal/ws"), String(fallback?.url));
check("回退连接不指向 :3110", !fallback?.url.includes(":3110"), String(fallback?.url));
globalThis.WebSocket.refuseSubstring = null;

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
