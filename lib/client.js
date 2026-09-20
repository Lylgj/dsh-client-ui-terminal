window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-terminal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;

		// react-dom 用于把面板挂到 body：并排模式下必须脱离 AppFrame 的 overflow:hidden。
		let reactDom = null;
		try {
			reactDom = require("react-dom");
		} catch {
			reactDom = null;
		}

		//#region 常量
		/** 宿主半边提供的同源路由。 */
		const ASSET_BASE = "/dsh-terminal/assets";
		const WS_PATH = "/dsh-terminal/ws";
		const INFO_PATH = "/dsh-terminal/info";

		/**
		 * 独立终端进程的默认端口（与 lib/helper.js、lib/index.js 保持一致）。
		 *
		 * 终端优先直连这个进程：它的事件循环只服务 PTY，不像 dsh 主进程那样会被
		 * 逐 token 流式解析、会话投影、zstd 压缩落盘与 GC 占满（实测主进程在重载下
		 * 最坏 20 秒无响应、按键最坏 5 秒无回显）。可用 localStorage 覆盖，方便
		 * 浏览器通过端口转发访问时指向别的端口。
		 */
		const HELPER_DEFAULT_PORT = 3110;
		const HELPER_PORT_KEY = "dsh-terminal-port";

		/**
		 * 把多次写入合并到同一个宏任务里一次完成，避免逐帧重排。
		 *
		 * 刻意不用 requestAnimationFrame：标签页切到后台后 rAF 会被暂停，
		 * 隐藏中的终端就会停止刷新滚动缓冲；MessageChannel 不受后台节流影响。
		 */
		const coalesce = (() => {
			let sink = null;
			let scheduled = false;
			const drain = () => {
				scheduled = false;
				const fn = sink;
				sink = null;
				if (fn !== null) fn();
			};
			let post = () => setTimeout(drain, 8);
			if (typeof globalThis.MessageChannel === "function") {
				const channel = new globalThis.MessageChannel();
				channel.port1.onmessage = drain;
				post = () => channel.port2.postMessage(null);
			}
			return (fn) => {
				sink = fn;
				if (scheduled) return;
				scheduled = true;
				post();
			};
		})();

		/** localStorage 键：面板宽度与展开状态。 */
		const KEY_WIDTH = "dsh.terminal.width";
		const KEY_OPEN = "dsh.terminal.open";
		/** localStorage 键：布局模式。 */
		const KEY_MODE = "dsh.terminal.mode";

		/** 并排：DSH 框架让出右侧空间，互不遮挡。 */
		const MODE_DOCK = "dock";
		/** 浮层：终端盖在 DSH 之上。 */
		const MODE_OVERLAY = "overlay";

		/** localStorage 键：明暗主题。 */
		const KEY_THEME = "dsh.terminal.theme";
		/** 浅色主题名。 */
		const THEME_LIGHT_NAME = "light";
		/** 暗色主题名。 */
		const THEME_DARK_NAME = "dark";

		/** localStorage 键：复制/粘贴行为开关（JSON；缺项按默认值补齐）。 */
		const KEY_CLIPBOARD = "dsh.terminal.clipboard";

		/**
		 * 复制/粘贴开关的默认值。
		 *
		 * `ctrlC` 只在「有选中内容」时复制，没有选中时仍然是 ^C（SIGINT），
		 * 所以默认打开不会让人失去中断命令的能力；`rightPaste` 是终端界惯例；
		 * `selectCopy` 默认关闭，因为「看到什么就复制什么」很容易污染剪贴板。
		 */
		const CLIPBOARD_DEFAULTS = { ctrlC: true, rightPaste: true, selectCopy: false };

		/** 三个开关的文案。三者互相独立，可以任意组合。 */
		const CLIPBOARD_OPTIONS = [
			{
				key: "ctrlC",
				label: "Ctrl+C 复制",
				title: "有选中内容时 Ctrl+C（macOS 上 Cmd+C）复制选中文本；没有选中时仍然发送 ^C 中断命令"
			},
			{
				key: "rightPaste",
				label: "右键粘贴",
				title: "在终端里点右键直接粘贴剪贴板内容（读取剪贴板需要 localhost 或 HTTPS）"
			},
			{
				key: "selectCopy",
				label: "选中即复制",
				title: "鼠标松开、选择停稳后自动复制选中文本"
			}
		];

		/** 「选中即复制」的防抖间隔：拖动过程中选中会连续变化，等停稳再复制一次。 */
		const SELECT_COPY_DEBOUNCE_MS = 150;

		/** 提示气泡的显示时长。 */
		const TOAST_MS = 1200;

		const MIN_WIDTH = 280;
		const MAX_WIDTH = 1100;
		const DEFAULT_WIDTH = 460;

		/** xterm 浅色主题（白底深字）。 */
		/** xterm 浅色主题（白底深字）。 */
		const THEME_LIGHT = {
			background: "#ffffff",
			foreground: "#1f2328",
			cursor: "#1f2328",
			cursorAccent: "#ffffff",
			selectionBackground: "#b6d7ff",
			black: "#24292f",
			red: "#cf222e",
			green: "#116329",
			yellow: "#953800",
			blue: "#0969da",
			magenta: "#8250df",
			cyan: "#1b7c83",
			white: "#6e7781",
			brightBlack: "#57606a",
			brightRed: "#a40e26",
			brightGreen: "#1a7f37",
			brightYellow: "#9a6700",
			brightBlue: "#218bff",
			brightMagenta: "#a475f9",
			brightCyan: "#3192aa",
			brightWhite: "#8c959f"
		};

		/** xterm 暗色主题（Catppuccin Mocha 系）。 */
		const THEME_DARK = {
			background: "#1b1b25",
			foreground: "#cdd6f4",
			cursor: "#f5e0dc",
			cursorAccent: "#1b1b25",
			selectionBackground: "#585b70",
			black: "#45475a",
			red: "#f38ba8",
			green: "#a6e3a1",
			yellow: "#f9e2af",
			blue: "#89b4fa",
			magenta: "#f5c2e7",
			cyan: "#94e2d5",
			white: "#bac2de",
			brightBlack: "#585b70",
			brightRed: "#f38ba8",
			brightGreen: "#a6e3a1",
			brightYellow: "#f9e2af",
			brightBlue: "#89b4fa",
			brightMagenta: "#f5c2e7",
			brightCyan: "#94e2d5",
			brightWhite: "#a6adc8"
		};

		/**
		 * 主题名对应的 xterm 调色板。
		 * @param name - 主题名。
		 * @returns 调色板对象。
		 */
		function themeOf(name) {
			return name === THEME_DARK_NAME ? THEME_DARK : THEME_LIGHT;
		}

		/** 面板自身样式（一次注入）。 */
		const STYLE_ID = "dsh-terminal-style";
		const CSS = `
/* 主题变量：面板与悬浮按钮是兄弟节点，各自带 data-theme，所以两套变量写在二者共用的选择器上。 */
.dsh-term-panel[data-theme="light"],.dsh-term-tab[data-theme="light"]{color-scheme:light;
  --t-bg:#ffffff;--t-fg:#1f2328;--t-muted:#6e7781;--t-head-bg:#f6f8fa;
  --t-border-soft:rgba(0,0,0,.10);
  --t-btn-bg:#ffffff;--t-btn-fg:#24292f;--t-btn-border:rgba(0,0,0,.15);--t-btn-hover-bg:#eaeef2;--t-btn-hover-fg:#000000;
  --t-dot:#d0d7de;--t-dot-on:#1a7f37;--t-dot-on-glow:0 0 6px rgba(26,127,55,.5);--t-dot-err:#cf222e;
  --t-tab-bg:#ffffff;--t-tab-hover-bg:#f3f4f6;--t-tab-fg:#1f2328;--t-tab-border:rgba(0,0,0,.16);
  --t-tab-shadow:0 6px 18px rgba(0,0,0,.18);--t-shadow:-12px 0 32px rgba(0,0,0,.18);
  --t-err-fg:#cf222e;--t-err-bg:rgba(255,255,255,.94);
  --t-count-bg:rgba(0,0,0,.08);--t-count-fg:#24292f;--t-grip-hover:rgba(9,105,218,.25)}
.dsh-term-panel[data-theme="dark"],.dsh-term-tab[data-theme="dark"]{color-scheme:dark;
  --t-bg:#1b1b25;--t-fg:#cdd6f4;--t-muted:#7f849c;--t-head-bg:rgba(255,255,255,.03);
  --t-border-soft:rgba(255,255,255,.10);
  --t-btn-bg:transparent;--t-btn-fg:#bac2de;--t-btn-border:rgba(255,255,255,.18);--t-btn-hover-bg:rgba(255,255,255,.10);--t-btn-hover-fg:#ffffff;
  --t-dot:#6c7086;--t-dot-on:#a6e3a1;--t-dot-on-glow:0 0 6px #a6e3a1;--t-dot-err:#f38ba8;
  --t-tab-bg:#26263a;--t-tab-hover-bg:#31314a;--t-tab-fg:#cdd6f4;--t-tab-border:rgba(255,255,255,.18);
  --t-tab-shadow:0 6px 18px rgba(0,0,0,.42);--t-shadow:-12px 0 32px rgba(0,0,0,.42);
  --t-err-fg:#f38ba8;--t-err-bg:rgba(17,17,27,.86);
  --t-count-bg:rgba(255,255,255,.12);--t-count-fg:#cdd6f4;--t-grip-hover:rgba(137,180,250,.30)}
.dsh-term-panel{position:fixed;top:0;right:0;bottom:0;display:flex;flex-direction:column;
  pointer-events:auto;z-index:40;min-width:0;background:var(--t-bg);color:var(--t-fg)}
.dsh-term-panel[data-mode="overlay"]{box-shadow:var(--t-shadow)}
.dsh-term-head{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 10px;flex:0 0 auto;flex-wrap:wrap;
  border-bottom:1px solid var(--t-border-soft);background:var(--t-head-bg);
  font:600 12px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--t-fg)}
.dsh-term-dot{width:7px;height:7px;border-radius:50%;background:var(--t-dot);flex:0 0 auto}
.dsh-term-dot[data-state="on"]{background:var(--t-dot-on);box-shadow:var(--t-dot-on-glow)}
.dsh-term-dot[data-state="err"]{background:var(--t-dot-err)}
.dsh-term-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-term-cwd{flex:0 1 auto;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:400 11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:var(--t-muted)}
.dsh-term-btn{flex:0 0 auto;border:1px solid var(--t-btn-border);background:var(--t-btn-bg);color:var(--t-btn-fg);
  border-radius:5px;padding:2px 7px;font:500 11px/1.5 ui-sans-serif,system-ui,sans-serif;cursor:pointer}
.dsh-term-btn:hover{background:var(--t-btn-hover-bg);color:var(--t-btn-hover-fg)}
.dsh-term-body{position:relative;flex:1 1 auto;min-height:0;padding:6px 4px 6px 8px;overflow:hidden;background:var(--t-bg)}
.dsh-term-hosts{position:relative;width:100%;height:100%}
.dsh-term-body .xterm{height:100%}
.dsh-term-body .xterm-viewport{background:var(--t-bg) !important}
.dsh-term-grip{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;
  pointer-events:auto;background:transparent}
.dsh-term-grip:hover{background:var(--t-grip-hover)}
.dsh-term-tab{position:fixed;right:0;bottom:0;pointer-events:auto;z-index:40;
  display:flex;align-items:center;gap:6px;margin:0 10px 10px 0;padding:6px 11px;border-radius:8px;
  border:1px solid var(--t-tab-border);background:var(--t-tab-bg);color:var(--t-tab-fg);cursor:pointer;
  box-shadow:var(--t-tab-shadow);font:600 12px/1.2 ui-sans-serif,system-ui,sans-serif}
.dsh-term-tab:hover{background:var(--t-tab-hover-bg)}
.dsh-term-err{position:absolute;left:0;right:0;bottom:0;padding:8px 10px;color:var(--t-err-fg);background:var(--t-err-bg);font:400 12px/1.6 ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap}
.dsh-term-count{padding:0 6px;border-radius:8px;background:var(--t-count-bg);color:var(--t-count-fg);font:600 10px/16px ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-term-btn[data-active="1"]{background:var(--t-btn-hover-bg);color:var(--t-btn-hover-fg);border-color:var(--t-btn-hover-bg)}
.dsh-term-menu{display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex:0 0 auto;padding:6px 10px;
  border-bottom:1px solid var(--t-border-soft);background:var(--t-head-bg);
  font:500 11px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--t-fg)}
.dsh-term-menu-label{color:var(--t-muted)}
.dsh-term-opt{display:inline-flex;align-items:center;gap:5px;cursor:pointer;user-select:none}
.dsh-term-opt input{margin:0;cursor:pointer;accent-color:#0969da}
.dsh-term-menu-hint{flex:1 1 100%;color:var(--t-muted);font-weight:400}
.dsh-term-toast{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:2;
  padding:4px 12px;border-radius:999px;pointer-events:none;white-space:nowrap;
  background:var(--t-count-bg);color:var(--t-count-fg);box-shadow:0 4px 14px rgba(0,0,0,.20);
  font:500 11px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
`;

		/**
		 * 注入面板所需的全局样式（只注入一次）。
		 * @returns 无返回值。
		 */
		function ensureStyle() {
			const exist = document.getElementById(STYLE_ID);
			if (exist !== null) {
				// 插件热更新后同步新样式，避免页面不刷新时仍用旧规则。
				if (exist.textContent !== CSS) exist.textContent = CSS;
				return;
			}
			const el = document.createElement("style");
			el.id = STYLE_ID;
			el.textContent = CSS;
			document.head.appendChild(el);
		}

		/** 资源加载状态缓存，避免重复注入 script/link。 */
		let assetsPromise = null;

		/**
		 * 加载 xterm.js / addon-fit.js / xterm.css（同源，从宿主路由取）。
		 * 依次串行加载，保证 addon 能看到 window.Terminal。
		 * @returns 就绪后 resolve 的 Promise。
		 */
		function loadAssets() {
			if (assetsPromise !== null) return assetsPromise;
			/**
			 * 注入一个 script 标签并等待加载完成。
			 * @param src - 脚本地址。
			 * @returns 加载完成或失败后 resolve 的 Promise。
			 */
			const script = (src) =>
				new Promise((resolve) => {
					const s = document.createElement("script");
					s.src = src;
					s.async = false;
					s.onload = () => resolve(true);
					s.onerror = () => resolve(false);
					document.head.appendChild(s);
				});
			assetsPromise = (async () => {
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = `${ASSET_BASE}/xterm.css`;
				document.head.appendChild(link);
				if (!(await script(`${ASSET_BASE}/xterm.js`))) throw new Error("xterm.js 加载失败");
				if (!(await script(`${ASSET_BASE}/addon-fit.js`))) throw new Error("addon-fit.js 加载失败");
				// WebGL 渲染器是可选增强：加载失败就退回 xterm 默认的 DOM 渲染器，
				// 不能因为它把整个终端面板拖挂。
				await script(`${ASSET_BASE}/addon-webgl.js`);
				return true;
			})();
			return assetsPromise;
		}

		/**
		 * 读取宿主探测信息（默认 shell 与工作目录），失败时静默降级。
		 * @returns 信息对象或 null。
		 */
		async function fetchInfo() {
			try {
				const res = await fetch(INFO_PATH, { headers: { accept: "application/json" } });
				if (!res.ok) return null;
				return await res.json();
			} catch {
				return null;
			}
		}

		/**
		 * 从 localStorage 读取面板宽度。
		 * @returns 夹取到合法区间的宽度像素值。
		 */
		function readWidth() {
			const raw = Number(globalThis.localStorage?.getItem(KEY_WIDTH));
			if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WIDTH;
			return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
		}

		/**
		 * 从 localStorage 读取展开状态，默认展开。
		 * @returns 是否展开。
		 */
		function readOpen() {
			return globalThis.localStorage?.getItem(KEY_OPEN) !== "0";
		}

		/**
		 * 从 localStorage 读取布局模式，默认并排。
		 * @returns 布局模式。
		 */
		function readMode() {
			return globalThis.localStorage?.getItem(KEY_MODE) === MODE_OVERLAY ? MODE_OVERLAY : MODE_DOCK;
		}

		/**
		 * 从 localStorage 读取明暗主题，默认浅色。
		 * @returns 主题名。
		 */
		function readTheme() {
			return globalThis.localStorage?.getItem(KEY_THEME) === THEME_DARK_NAME ? THEME_DARK_NAME : THEME_LIGHT_NAME;
		}

		/**
		 * 从 localStorage 读取复制/粘贴开关。
		 * @returns 三个开关的当前值（缺项或脏数据用默认值补齐）。
		 */
		function readClipboard() {
			const out = { ...CLIPBOARD_DEFAULTS };
			try {
				const raw = globalThis.localStorage?.getItem(KEY_CLIPBOARD);
				if (raw === null || raw === undefined || raw === "") return out;
				const parsed = JSON.parse(raw);
				for (const opt of CLIPBOARD_OPTIONS) {
					if (typeof parsed?.[opt.key] === "boolean") out[opt.key] = parsed[opt.key];
				}
			} catch {
				/* 隐私模式或脏数据：用默认值。 */
			}
			return out;
		}

		/**
		 * 写文本进剪贴板：优先异步剪贴板 API，失败退回 execCommand 老路。
		 *
		 * 页面若通过非 localhost 的明文 HTTP 打开，`navigator.clipboard` 不存在
		 * （非安全上下文），此时 execCommand('copy') 仍然可用，所以两条路都要留。
		 * @param text - 待复制文本。
		 * @returns 是否复制成功。
		 */
		async function copyText(text) {
			if (typeof text !== "string" || text === "") return false;
			try {
				if (typeof globalThis.navigator?.clipboard?.writeText === "function") {
					await globalThis.navigator.clipboard.writeText(text);
					return true;
				}
			} catch {
				/* 权限被拒或非安全上下文 → 走兜底。 */
			}
			try {
				const area = document.createElement("textarea");
				area.value = text;
				area.setAttribute("readonly", "");
				area.style.position = "fixed";
				area.style.left = "-9999px";
				area.style.top = "0";
				document.body.appendChild(area);
				area.select?.();
				const ok = document.execCommand?.("copy") === true;
				area.remove?.();
				return ok;
			} catch {
				return false;
			}
		}

		/**
		 * 读取剪贴板文本。
		 *
		 * 浏览器只在安全上下文（localhost / HTTPS）且获得授权后才允许读剪贴板；
		 * 拿不到时返回 null，由调用方提示改用 Ctrl+V（xterm 自身支持粘贴事件）。
		 * @returns 剪贴板文本；不可读时为 null。
		 */
		async function readClipboardText() {
			try {
				if (typeof globalThis.navigator?.clipboard?.readText === "function") {
					return await globalThis.navigator.clipboard.readText();
				}
			} catch {
				/* 权限被拒。 */
			}
			return null;
		}

		/**
		 * 安全地取终端当前选中的文本。
		 * @param term - xterm 实例。
		 * @returns 选中文本；终端已销毁或 API 不可用时为空串。
		 */
		function selectionOf(term) {
			try {
				if (typeof term?.getSelection !== "function") return "";
				return term.getSelection() ?? "";
			} catch {
				return "";
			}
		}

		/**
		 * 是否具备把面板挂到 body 的能力（并排模式必须脱离框架的 overflow:hidden）。
		 * @returns 可用时为 true。
		 */
		function canPortal() {
			return reactDom !== null && typeof reactDom.createPortal === "function" && document.body != null;
		}

		//#endregion

		//#region 终端面板组件
		/** 无工作区信息时使用的会话键。 */
		const DEFAULT_KEY = "\u0000default";

		/**
		 * 由工作区路径得到常驻终端的会话键。
		 * @param cwd - 当前会话所属工作区目录。
		 * @returns 会话键；无 cwd 时返回默认键。
		 */
		function keyOf(cwd) {
			return typeof cwd === "string" && cwd !== "" ? cwd : DEFAULT_KEY;
		}

		/**
		 * 会话键对应的显示名。
		 * @param key - 会话键。
		 * @returns 可展示的工作区路径。
		 */
		function labelOf(key) {
			return key === DEFAULT_KEY ? "(默认目录)" : key;
		}

		/**
		 * 在下一帧执行回调（无 requestAnimationFrame 的环境同步执行）。
		 * @param fn - 待执行回调。
		 * @returns 无返回值。
		 */
		function raf(fn) {
			if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(fn);
			else fn();
		}

		/**
		 * 运行时未提供 useSessions 时的兜底 hook（保持 hook 调用位置稳定）。
		 * @returns 恒为 undefined。
		 */
		function fallbackUseSessions() {
			return undefined;
		}

		/**
		 * 右侧常驻终端面板：**每个工作区各保留一个常驻 shell**。
		 *
		 * 组件注册在 root 作用域的 `shell.overlay` 列表槽里，因此对每个会话
		 * （包括新建会话页）都存在，且切换会话不会卸载。内部按工作区目录维护
		 * 多份 {宿主 div, xterm, PTY}：切换工作区只是切换显示哪一份，
		 * 其它工作区的 shell 保持运行、滚动缓冲保持完整。
		 * @param props - 槽注入属性，含全局 useSessions。
		 * @returns 面板或悬浮开合按钮的 React 元素。
		 */
		function TerminalPanel(props) {
			const useSessions = props?.useSessions ?? fallbackUseSessions;
			// 当前会话所属工作区目录：会话摘要里的 cwd 即 header.cwd 直通。
			const wsCwd = useSessions((s) => {
				if (s === undefined || s === null) return undefined;
				const id = s.current;
				if (id === undefined || id === null) return undefined;
				const summary = s.byId === undefined ? undefined : s.byId[id];
				return summary === undefined ? undefined : summary.cwd;
			});
			const activeKey = keyOf(wsCwd);

			const [open, setOpen] = react.useState(readOpen);
			const [width, setWidth] = react.useState(readWidth);
			const [mode, setMode] = react.useState(readMode);
			const [theme, setTheme] = react.useState(readTheme);
			const [info, setInfo] = react.useState(null);
			/** 复制/粘贴开关（三个独立开关，可任意组合）。 */
			const [clipboard, setClipboard] = react.useState(readClipboard);
			/** 复制/粘贴设置菜单是否展开。 */
			const [menuOpen, setMenuOpen] = react.useState(false);
			/** 一次性提示（已复制 / 已粘贴 / 剪贴板不可用的原因）。 */
			const [toast, setToast] = react.useState("");
			/** 仅用于把会话内部状态变化同步到头部（会话数据存在 ref 里）。 */
			const [, forceRender] = react.useState(0);

			/** 各工作区终端宿主的父容器（React 管理，尺寸稳定）。 */
			const hostsRef = react.useRef(null);
			/** 会话表：工作区目录 -> {host, term, fit, ws, ...}。 */
			const sessionsRef = react.useRef(null);
			if (sessionsRef.current === null) sessionsRef.current = new Map();
			const activeKeyRef = react.useRef(activeKey);
			const aliveRef = react.useRef(false);
			const visibleRef = react.useRef(open);
			/** 建新终端时读取的最新主题（避免把 theme 加进 ensureSession 的依赖）。 */
			const themeRef = react.useRef(theme);
			/** 终端回调里读最新开关（同样避免把 clipboard 加进 ensureSession 的依赖）。 */
			const clipboardRef = react.useRef(clipboard);
			/** 终端回调里弹提示：终端事件在 React 之外触发，用 ref 桥到 setState。 */
			const toastRef = react.useRef(() => {});
			/** 提示气泡的定时器。 */
			const toastTimerRef = react.useRef(null);

			/**
			 * 触发一次重渲染，把会话状态同步到头部。
			 * @returns 无返回值。
			 */
			const bump = react.useCallback(() => forceRender((n) => n + 1), []);

			/**
			 * 弹一次短提示（复制/粘贴反馈）。
			 * @param message - 提示文本。
			 * @returns 无返回值。
			 */
			const flash = react.useCallback((message) => {
				setToast(message);
				if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
				toastTimerRef.current = setTimeout(() => setToast(""), TOAST_MS);
			}, []);

			/**
			 * 翻转一个复制/粘贴开关并持久化。
			 * @param key - 开关名（CLIPBOARD_OPTIONS 里的 key）。
			 * @returns 无返回值。
			 */
			const toggleClipboard = react.useCallback((key) => {
				setClipboard((current) => {
					const next = { ...current, [key]: current[key] !== true };
					try {
						globalThis.localStorage?.setItem(KEY_CLIPBOARD, JSON.stringify(next));
					} catch {
						/* 隐私模式：仅本次会话有效。 */
					}
					return next;
				});
			}, []);

			/**
			 * 取当前活动会话。
			 * @returns 会话记录，未创建时为 null。
			 */
			const activeSession = () => sessionsRef.current.get(activeKeyRef.current) ?? null;

			/**
			 * 对指定工作区的终端做一次 fit。
			 *
			 * 不可见（尺寸为 0）时直接跳过：这样隐藏中的终端会保留它最后一次的
			 * 行列数，后端 PTY 不会被动缩成 0 列。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			const refitKey = react.useCallback((key) => {
				const s = sessionsRef.current?.get(key);
				if (s === undefined || s === null || s.fit === null || s.host === null) return;
				if (s.host.clientWidth === 0 || s.host.clientHeight === 0) return;
				try {
					s.fit.fit();
				} catch {
					/* 尺寸竞争时忽略。 */
				}
			}, []);

			/**
			 * 对当前活动工作区的终端做一次 fit。
			 * @returns 无返回值。
			 */
			const refit = react.useCallback(() => refitKey(activeKeyRef.current), [refitKey]);

			/**
			 * 为某个会话建立（或重建）到宿主的 WebSocket，并按需自动重连。
			 * @param s - 会话记录。
			 * @returns 无返回值。
			 */
			const connectSession = (s, attempt = 0) => {
				const term = s.term;
				if (term === null) return;

				// 重建前先静默关掉旧连接，避免触发它的自动重连。
				const prev = s.ws;
				if (prev !== null) {
					try {
						prev.onclose = null;
						prev.close();
					} catch {
						/* 已经断开。 */
					}
					s.ws = null;
				}
				if (s.retry !== null) {
					clearTimeout(s.retry);
					s.retry = null;
				}

				s.status = "wait";
				s.error = "";
				bump();

				const proto = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
				const qs = new URLSearchParams({ cols: String(term.cols || 80), rows: String(term.rows || 24) });
				// 把本会话所属工作区交给宿主，PTY 就在该目录下启动。
				if (s.key !== DEFAULT_KEY) qs.set("cwd", s.key);

				// 候选后端：先独立终端进程（延迟不受 dsh 主进程影响），再同源路由兜底。
				let helperPort = HELPER_DEFAULT_PORT;
				try {
					const override = Number(globalThis.localStorage?.getItem(HELPER_PORT_KEY));
					if (Number.isFinite(override) && override > 0) helperPort = override;
				} catch {
					/* 隐私模式等拿不到 localStorage，用默认端口。 */
				}
				const targets = [
					{ kind: "helper", url: `${proto}//${globalThis.location.hostname}:${helperPort}/ws?${qs.toString()}` },
					{ kind: "inline", url: `${proto}//${globalThis.location.host}${WS_PATH}?${qs.toString()}` },
				];
				const target = targets[Math.min(attempt, targets.length - 1)];

				let ws;
				try {
					ws = new WebSocket(target.url);
				} catch (err) {
					s.status = "err";
					s.error = String(err?.message ?? err);
					bump();
					return;
				}
				s.ws = ws;
				/** 是否已成功握手：未握手就断开说明该后端不可达，直接换下一个。 */
				let opened = false;
				/** 本连接待写入 xterm 的 PTY 输出，按宏任务合批后一次写。 */
				const pending = [];
				const flushPending = () => {
					if (pending.length === 0) return;
					term.write(pending.join(""));
					pending.length = 0;
				};

				ws.onopen = () => {
					if (!aliveRef.current || s.disposed) return;
					opened = true;
					s.backend = target.kind;
					s.status = "on";
					s.error = "";
					bump();
					refitKey(s.key);
					if (term.cols > 0) ws.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
					if (target.kind === "helper") {
						console.info(
							`[dsh-terminal] 已连接独立终端进程 ${globalThis.location.hostname}:${helperPort}（按键回显不受 dsh 主进程负载影响）`,
						);
					} else {
						console.info("[dsh-terminal] 独立终端进程不可达，已回退到同源路由。");
					}
					if (s.key === activeKeyRef.current && visibleRef.current) {
						try {
							term.focus();
						} catch {
							/* 忽略。 */
						}
					}
				};

				ws.onmessage = (ev) => {
					if (s.disposed) return;
					// 隐藏中的终端同样在收数据，因此其滚动缓冲始终是最新的；
					// 合批到同一个宏任务再写入，避免逐帧重排。
					pending.push(typeof ev.data === "string" ? ev.data : "");
					coalesce(flushPending);
				};

				ws.onclose = () => {
					if (!aliveRef.current || s.disposed) return;
					// 还没握手就断开：说明该后端不可达（独立进程没起、或端口未转发），
					// 立刻换下一个候选后端；全都试过才进入 3 秒重连。
					if (!opened && attempt + 1 < targets.length) {
						s.status = "wait";
						bump();
						connectSession(s, attempt + 1);
						return;
					}
					s.status = "err";
					s.error = opened ? "连接已断开，3 秒后自动重连…" : "无法连接终端后端，3 秒后重试…";
					bump();
					if (s.retry !== null) clearTimeout(s.retry);
					s.retry = setTimeout(() => {
						s.retry = null;
						if (aliveRef.current && !s.disposed) connectSession(s, 0);
					}, 3000);
				};

				ws.onerror = () => {
					/* 具体原因由 onclose 统一处理。 */
				};
			};

			/**
			 * 确保某个工作区拥有常驻终端（幂等）。
			 * @param key - 会话键（工作区目录或默认键）。
			 * @returns 会话记录；父容器尚未挂载时为 null。
			 */
			const ensureSession = react.useCallback(
				(key) => {
					const map = sessionsRef.current;
					const existing = map.get(key);
					if (existing !== undefined) return existing;
					const parent = hostsRef.current;
					if (parent === null) return null;

					const host = document.createElement("div");
					host.className = "dsh-term-host";
					host.style.width = "100%";
					host.style.height = "100%";
					host.style.display = "none";
					parent.appendChild(host);

					const s = {
						key,
						host,
						term: null,
						fit: null,
						ws: null,
						observer: null,
						status: "wait",
						error: "",
						retry: null,
						disposed: false,
						/** 「选中即复制」的防抖定时器。 */
						selectTimer: null,
						/** 右键粘贴的宿主监听器（回收时移除）。 */
						onContextMenu: null
					};
					map.set(key, s);
					bump();

					(async () => {
						try {
							await loadAssets();
						} catch (err) {
							if (s.disposed) return;
							s.status = "err";
							s.error = `终端资源加载失败：${String(err?.message ?? err)}\n请确认已刷新页面以加载最新插件。`;
							bump();
							return;
						}
						if (s.disposed || !aliveRef.current) return;

						const term = new globalThis.Terminal({
							cursorBlink: true,
							fontSize: 13,
							fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
							lineHeight: 1.2,
							scrollback: 10000,
							allowProposedApi: true,
							theme: themeOf(themeRef.current)
						});
						const fit = new globalThis.FitAddon.FitAddon();
						term.loadAddon(fit);
						term.open(host);
						s.term = term;
						s.fit = fit;

						/**
						 * WebGL 渲染器：把终端绘制从主线程 DOM 操作搬到 GPU。
						 *
						 * 这很关键 —— 聊天区流式输出时每个 token 都要重渲染，DOM 渲染器
						 * 会和它抢同一个主线程；WebGL 之后终端绘制几乎不占主线程。
						 * 上下文丢失（GPU 驱动重置、标签页回收）时卸载它，自动退回 DOM。
						 */
						try {
							if (typeof globalThis.WebglAddon?.WebglAddon === "function") {
								const webgl = new globalThis.WebglAddon.WebglAddon();
								webgl.onContextLoss(() => {
									try {
										webgl.dispose();
									} catch {
										/* 已经卸载。 */
									}
								});
								term.loadAddon(webgl);
								s.webgl = webgl;
							}
						} catch {
							/* 设备/浏览器不支持 WebGL：保持默认 DOM 渲染器即可。 */
						}

						term.onData((d) => {
							const ws = s.ws;
							if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d }));
						});
						term.onResize(({ cols, rows }) => {
							const ws = s.ws;
							if (ws !== null && ws.readyState === WebSocket.OPEN) {
								ws.send(JSON.stringify({ t: "r", c: cols, r: rows }));
							}
						});
						term.onTitleChange(() => {
							/* 预留：可用于把标题显示到面板头部。 */
						});

						/**
						 * Ctrl+C 复制（可选）。
						 *
						 * 只有「有选中内容」时才把按键拦下来复制，否则原样交回 xterm 发送
						 * ^C —— 所以即使默认打开，也不会失去中断命令的能力。同时接受
						 * Cmd+C（macOS 习惯）；带 Shift/Alt 的组合一律放行。
						 */
						term.attachCustomKeyEventHandler?.((ev) => {
							if (ev?.type !== "keydown") return true;
							if (clipboardRef.current.ctrlC !== true) return true;
							const key = typeof ev.key === "string" ? ev.key.toLowerCase() : "";
							if (key !== "c") return true;
							if ((ev.ctrlKey !== true && ev.metaKey !== true) || ev.altKey === true || ev.shiftKey === true) return true;
							const selected = selectionOf(term);
							if (selected === "") return true;
							void copyText(selected).then((ok) => {
								toastRef.current(ok ? `已复制 ${selected.length} 个字符` : "复制失败：浏览器拒绝了剪贴板写入");
							});
							return false;
						});

						/**
						 * 选中即复制（可选）。
						 *
						 * 拖动过程中选中内容会连续变化，所以做 150ms 防抖：停稳后才复制一次，
						 * 避免把半截内容反复写进剪贴板。
						 */
						term.onSelectionChange?.(() => {
							if (clipboardRef.current.selectCopy !== true) return;
							if (s.selectTimer !== null) clearTimeout(s.selectTimer);
							s.selectTimer = setTimeout(() => {
								s.selectTimer = null;
								const selected = selectionOf(term);
								if (selected === "") return;
								void copyText(selected).then((ok) => {
									if (ok) toastRef.current(`已复制 ${selected.length} 个字符`);
								});
							}, SELECT_COPY_DEBOUNCE_MS);
						});

						/**
						 * 右键粘贴（可选）。
						 *
						 * 拦截浏览器右键菜单；拿到文本后交给 `term.paste()` 而不是直接发原始
						 * 数据，这样括号粘贴模式与换行处理跟正常粘贴完全一致（多行内容不会被
						 * 应用当成多条命令立刻执行）。
						 */
						const onContextMenu = (ev) => {
							if (clipboardRef.current.rightPaste !== true) return;
							ev.preventDefault?.();
							void readClipboardText().then((text) => {
								if (text === null) {
									toastRef.current("此环境不允许读取剪贴板，请用 Ctrl+V 粘贴");
									return;
								}
								if (text === "") return;
								try {
									if (typeof term.paste === "function") term.paste(text);
									else {
										const ws = s.ws;
										if (ws !== null && ws.readyState === WebSocket.OPEN) {
											ws.send(JSON.stringify({ t: "i", d: text }));
										}
									}
								} catch {
									/* 终端已销毁时忽略。 */
								}
								toastRef.current(`已粘贴 ${text.length} 个字符`);
							});
						};
						// 用捕获阶段挂载：即使 xterm 内部对右键做了 stopPropagation，也保证能拦到。
						host.addEventListener?.("contextmenu", onContextMenu, true);
						s.onContextMenu = onContextMenu;

						if (typeof ResizeObserver !== "undefined") {
							s.observer = new ResizeObserver(() => refitKey(key));
							s.observer.observe(host);
						}

						term.write(`\r\n\x1b[2m[已为工作区 ${labelOf(key)} 启动常驻终端；切走后它继续运行]\x1b[0m\r\n`);
						if (s.key === activeKeyRef.current) refitKey(key);
						connectSession(s);
						bump();
					})();

					return s;
				},
				[bump, refitKey]
			);

			/**
			 * 切换显示到指定工作区的终端（其它工作区保持存活）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			const activate = react.useCallback(
				(key) => {
					const map = sessionsRef.current;
					for (const [k, s] of map) {
						if (s.host !== null) s.host.style.display = k === key ? "block" : "none";
					}
					// 等布局生效后再算行列数。
					raf(() => {
						refitKey(key);
						const s = map.get(key);
						if (s !== undefined && visibleRef.current) {
							try {
								s.term?.focus?.();
							} catch {
								/* 忽略。 */
							}
						}
					});
				},
				[refitKey]
			);

			/**
			 * 回收全部工作区终端（仅组件卸载时调用）。
			 * @returns 无返回值。
			 */
			const disposeAll = () => {
				for (const s of sessionsRef.current.values()) {
					s.disposed = true;
					if (s.retry !== null) clearTimeout(s.retry);
					if (s.selectTimer !== null) clearTimeout(s.selectTimer);
					if (s.onContextMenu !== null) s.host?.removeEventListener?.("contextmenu", s.onContextMenu, true);
					s.observer?.disconnect?.();
					if (s.ws !== null) {
						try {
							s.ws.onclose = null;
							s.ws.close();
						} catch {
							/* 忽略。 */
						}
					}
					try {
						s.term?.dispose?.();
					} catch {
						/* 忽略。 */
					}
					s.host?.remove?.();
				}
				sessionsRef.current.clear();
			};

			// 挂载：注入样式、拉取宿主信息；卸载时回收所有工作区终端。
			react.useEffect(() => {
				aliveRef.current = true;
				ensureStyle();
				(async () => {
					const meta = await fetchInfo();
					if (!aliveRef.current) return;
					setInfo(meta);
				})();
				return () => {
					aliveRef.current = false;
					disposeAll();
				};
			}, []);

			// 工作区变化：确保该工作区有常驻终端并切到它，其它工作区继续运行。
			react.useEffect(() => {
				activeKeyRef.current = activeKey;
				ensureSession(activeKey);
				activate(activeKey);
			}, [activeKey, ensureSession, activate]);

			// 展开/收起：隐藏不销毁，故 shell 与滚动缓冲都保留。
			react.useEffect(() => {
				visibleRef.current = open;
				globalThis.localStorage?.setItem(KEY_OPEN, open ? "1" : "0");
				if (!open) return;
				raf(() => {
					refit();
					const s = sessionsRef.current.get(activeKeyRef.current);
					try {
						s?.term?.focus?.();
					} catch {
						/* 忽略。 */
					}
				});
			}, [open, refit]);

			// 面板宽度变化：重算行列数。
			react.useEffect(() => {
				refit();
			}, [width, refit]);

			// 并排模式：把 DSH 的 AppFrame 整体收窄，让它的三栏自己重排，终端占住让出来的这一条。
			// AppFrame 用 ResizeObserver 观测自身宽度来解算列宽，所以改 margin 就会触发正确重排
			// （侧栏不妥协、正文保底、必要时自动关掉右侧详情栏），不会像浮层那样盖住内容。
			react.useEffect(() => {
				const overlay = document.querySelector("[data-shell-overlay]");
				const frame = overlay != null ? overlay.parentElement : null;
				if (frame === null) return;
				// 折叠时不占位；浮层模式不占位。
				const docked = open === true && mode === MODE_DOCK && canPortal();
				frame.style.marginRight = docked ? `${width}px` : "";
				return () => {
					frame.style.marginRight = "";
				};
			}, [open, width, mode]);

			// 记住布局模式。
			react.useEffect(() => {
				globalThis.localStorage?.setItem(KEY_MODE, mode);
			}, [mode]);

			// 明暗主题：同步到所有常驻终端（xterm 支持运行时换主题）与面板外壳，并记住选择。
			react.useEffect(() => {
				themeRef.current = theme;
				globalThis.localStorage?.setItem(KEY_THEME, theme);
				const palette = themeOf(theme);
				for (const sess of sessionsRef.current.values()) {
					const term = sess.term;
					if (term === null || term === undefined) continue;
					try {
						term.options.theme = palette;
					} catch {
						/* 终端已销毁时忽略。 */
					}
				}
			}, [theme]);

			// 复制/粘贴开关：终端回调通过 ref 读最新值，提示回调桥到 setState。
			react.useEffect(() => {
				clipboardRef.current = clipboard;
				toastRef.current = flash;
			}, [clipboard, flash]);

			// 卸载时清掉提示气泡的定时器。
			react.useEffect(
				() => () => {
					if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
				},
				[]
			);

			/**
			 * 全局按键处理：仅接管 Ctrl+`（含 Cmd+`）。
			 * @param ev - 键盘事件。
			 * @returns 无返回值。
			 */
			react.useEffect(() => {
				const onKey = (ev) => {
					const key = ev.key;
					const isTick = key === "`" || key === "~" || ev.code === "Backquote";
					if (isTick && (ev.ctrlKey || ev.metaKey) && !ev.altKey) {
						ev.preventDefault();
						ev.stopPropagation();
						setOpen((v) => !v);
					}
				};
				globalThis.addEventListener("keydown", onKey, true);
				return () => globalThis.removeEventListener("keydown", onKey, true);
			}, []);

			/**
			 * 拖拽左侧把手调整面板宽度。
			 * @param ev - pointerdown 事件。
			 * @returns 无返回值。
			 */
			const onGripDown = react.useCallback(
				(ev) => {
					ev.preventDefault();
					const startX = ev.clientX;
					const startW = width;
					/**
					 * 拖动中的宽度更新。
					 * @param e - pointermove 事件。
					 * @returns 无返回值。
					 */
					const move = (e) => {
						const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (startX - e.clientX)));
						setWidth(next);
						refit();
					};
					/** 结束拖动并持久化宽度。 */
					const up = () => {
						globalThis.removeEventListener("pointermove", move);
						globalThis.removeEventListener("pointerup", up);
						globalThis.localStorage?.setItem(KEY_WIDTH, String(readWidthWithFallback()));
					};
					/**
					 * 读取当前宽度用于持久化。
					 * @returns 最近一次设定的宽度。
					 */
					const readWidthWithFallback = () => {
						const el = document.querySelector(".dsh-term-panel");
						return el !== null ? Math.round(el.getBoundingClientRect().width) : startW;
					};
					globalThis.addEventListener("pointermove", move);
					globalThis.addEventListener("pointerup", up);
				},
				[width, refit]
			);

			// 暴露一个调试/测试入口，便于在控制台直接开合与查看各工作区终端。
			react.useEffect(() => {
				globalThis.__DSH_TERMINAL__ = {
					open: () => setOpen(true),
					close: () => setOpen(false),
					toggle: () => setOpen((v) => !v),
					reconnect: () => {
						const s = activeSession();
						if (s !== null) connectSession(s);
					},
					clear: () => activeSession()?.term?.clear?.(),
					sessions: () => [...sessionsRef.current.keys()].map(labelOf),
					state: () => activeSession()?.status ?? "wait",
					mode: () => mode,
					theme: () => theme,
					toggleTheme: () => setTheme((t) => (t === THEME_DARK_NAME ? THEME_LIGHT_NAME : THEME_DARK_NAME)),
					toggleLayout: () => setMode((m) => (m === MODE_DOCK ? MODE_OVERLAY : MODE_DOCK)),
					frameMargin: () => {
						const o = document.querySelector("[data-shell-overlay]");
						return o != null && o.parentElement !== null ? o.parentElement.style.marginRight : "";
					}
				};
			});

			const act = sessionsRef.current.get(activeKey) ?? null;
			const state = act !== null ? act.status : "wait";
			const error = act !== null ? act.error : "";
			const shownCwd = typeof wsCwd === "string" && wsCwd !== "" ? wsCwd : (typeof info?.cwd === "string" ? info.cwd : labelOf(activeKey));
			const count = sessionsRef.current.size;

			/** 面板主体（始终挂载，折叠时用 display:none 隐藏以保留所有 shell）。 */
			const panel = h(
				"div",
				{
					className: "dsh-term-panel",
					"data-dsh-terminal-panel": "1",
					"data-mode": mode,
					"data-theme": theme,
					style: { width: `${width}px`, display: open ? "flex" : "none" }
				},
				h("div", { className: "dsh-term-grip", onPointerDown: onGripDown, title: "拖动调整宽度" }),
				h(
					"div",
					{ className: "dsh-term-head" },
					h("span", { className: "dsh-term-dot", "data-state": state === "on" ? "on" : state === "err" ? "err" : "wait" }),
					h("span", { className: "dsh-term-title" }, "终端"),
					h("span", { className: "dsh-term-cwd", title: shownCwd }, shownCwd),
					count > 1 ? h("span", { className: "dsh-term-count", title: "已常驻的终端数" }, `${count}`) : null,
					h(
						"button",
						{
							className: "dsh-term-btn",
							onClick: () => {
								setMode((m) => (m === MODE_DOCK ? MODE_OVERLAY : MODE_DOCK));
							},
							title:
								mode === MODE_DOCK
									? "当前为并排：DSH 让出右侧空间。点击改为浮层覆盖"
									: "当前为浮层：终端盖在 DSH 上。点击改为并排（DSH 让出空间）"
						},
						mode === MODE_DOCK ? "并排" : "浮层"
					),
					h(
						"button",
						{
							className: "dsh-term-btn",
							onClick: () => {
								setTheme((t) => (t === THEME_DARK_NAME ? THEME_LIGHT_NAME : THEME_DARK_NAME));
							},
							title:
								theme === THEME_DARK_NAME
									? "当前为暗色。点击切换为浅色"
									: "当前为浅色。点击切换为暗色"
						},
						theme === THEME_DARK_NAME ? "暗色" : "浅色"
					),
					h(
						"button",
						{
							className: "dsh-term-btn",
							"data-active": menuOpen ? "1" : "0",
							onClick: () => setMenuOpen((v) => !v),
							title: `复制/粘贴设置（当前：${CLIPBOARD_OPTIONS.filter((o) => clipboard[o.key] === true)
								.map((o) => o.label)
								.join("、") || "全部关闭"}）`
						},
						"复制"
					),
					h(
						"button",
						{
							className: "dsh-term-btn",
							onClick: () => {
								activeSession()?.term?.clear?.();
							},
							title: "清屏（仅当前工作区）"
						},
						"清屏"
					),
					h(
						"button",
						{
							className: "dsh-term-btn",
							onClick: () => {
								const s = activeSession();
								if (s !== null) connectSession(s);
							},
							title: "重新连接当前工作区的 PTY"
						},
						"重连"
					),
					h(
						"button",
						{
							className: "dsh-term-btn",
							onClick: () => setOpen(false),
							title: "收起终端（Ctrl+`）"
						},
						"收起"
					)
				),
				menuOpen
					? h(
							"div",
							{ className: "dsh-term-menu", "data-dsh-terminal-menu": "1" },
							h("span", { className: "dsh-term-menu-label" }, "复制/粘贴"),
							...CLIPBOARD_OPTIONS.map((opt) =>
								h(
									"label",
									{ className: "dsh-term-opt", key: opt.key, title: opt.title },
									h("input", {
										type: "checkbox",
										checked: clipboard[opt.key] === true,
										onChange: () => toggleClipboard(opt.key)
									}),
									opt.label
								)
							),
							h(
								"span",
								{ className: "dsh-term-menu-hint" },
								"三个开关互相独立、可同时打开；Ctrl+C 只在有选中内容时复制，读取剪贴板需 localhost 或 HTTPS"
							)
						)
					: null,
				h(
					"div",
					{ className: "dsh-term-body" },
					// 每个工作区一个宿主 div，由 ensureSession 追加进来；
					// 这里用独立容器，避免与 React 的子节点管理相互干扰。
					h("div", { className: "dsh-term-hosts", ref: hostsRef }),
					toast !== "" ? h("div", { className: "dsh-term-toast", "data-dsh-terminal-toast": "1" }, toast) : null,
					error !== "" ? h("div", { className: "dsh-term-err" }, error) : null
				)
			);

			/** 折叠时的悬浮开合按钮。 */
			const tab =
				open === true
					? null
					: h(
							"button",
							{
								className: "dsh-term-tab",
								"data-theme": theme,
								onClick: () => setOpen(true),
								title: "打开终端（Ctrl+`）"
							},
							h("span", { className: "dsh-term-dot", "data-state": state === "on" ? "on" : state === "err" ? "err" : "wait" }),
							"终端"
						);

			const tree = h(react.Fragment, null, panel, tab);
			// 挂到 body：脱离 AppFrame 的 overflow:hidden，position:fixed 才能锚定视口右缘。
			return canPortal() ? reactDom.createPortal(tree, document.body) : tree;
		}
		//#endregion

		//#region 插件入口
		/** 需要的客户端服务：槽注册表。 */
		const inject = ["slots"];

		/**
		 * 客户端插件主体：把终端面板挂到 root 作用域的 `shell.overlay` 列表槽。
		 *
		 * 用 `slots.inject()` 而不是直接 register，是因为目标槽的声明可能由
		 * ui-layout 稍后激活或被替换；inject 会在槽存在时再执行注册，并在槽
		 * 重新声明后自动重放。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", function* () {
				try {
					yield ctx.slots.register(
						{
							name: "shell.overlay",
							id: "terminal",
							order: 100
						},
						TerminalPanel
					);
				} catch (error) {
					console.error("[dsh-terminal] 注册 shell.overlay 槽失败：", error);
				}
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
