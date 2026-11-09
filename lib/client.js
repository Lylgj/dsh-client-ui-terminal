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

		/** better-sidebar 对外暴露的服务名。 */
		const BETTER_SIDEBAR_SERVICE = "betterSidebar";
		/** 本插件在 better-sidebar 里注册的页签类型 id（也是 SidebarTab.type）。 */
		const TAB_TYPE = "dsh-terminal";

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
		/** localStorage 键：布局模式（仅独立浮层面板使用）。 */
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
		/** localStorage 键：每个工作区选中的 shell（JSON：会话键 -> shell id）。 */
		const KEY_SHELLS = "dsh.terminal.shells";

		/**
		 * 复制/粘贴开关的默认值。
		 *
		 * `ctrlC` 只在「有选中内容」时复制，没有选中时仍然是 ^C（SIGINT），
		 * 所以默认打开不会让人失去中断命令的能力；`rightPaste` 是终端界惯例；
		 * `selectCopy` 默认关闭，因为「看到什么就复制什么」很容易污染剪贴板。
		 */
		const CLIPBOARD_DEFAULTS = { ctrlC: true, rightPaste: true, selectCopy: false, toastPos: "bottom" };

		/** 复制/粘贴提示气泡的位置档位。 */
		const TOAST_POSITIONS = [
			{ key: "bottom", label: "底部居中", title: "提示显示在终端面板底部中央" },
			{ key: "bottomLeft", label: "底部靠左", title: "提示显示在终端面板左下角（不挡输入行右侧）" },
			{ key: "top", label: "顶部居中", title: "提示显示在工具条下方居中" },
			{ key: "cursor", label: "跟随鼠标", title: "提示出现在鼠标位置上方，不占用终端画面" },
			{ key: "off", label: "关闭提示", title: "复制/粘贴后不弹任何提示" }
		];

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
.dsh-term-panel[data-theme="light"],.dsh-term-tab[data-theme="light"],.dsh-term-embed[data-theme="light"]{color-scheme:light;
  --t-bg:#ffffff;--t-fg:#1f2328;--t-muted:#6e7781;--t-head-bg:#f6f8fa;
  --t-border-soft:rgba(0,0,0,.10);
  --t-btn-bg:#ffffff;--t-btn-fg:#24292f;--t-btn-border:rgba(0,0,0,.15);--t-btn-hover-bg:#eaeef2;--t-btn-hover-fg:#000000;
  --t-dot:#d0d7de;--t-dot-on:#1a7f37;--t-dot-on-glow:0 0 6px rgba(26,127,55,.5);--t-dot-err:#cf222e;
  --t-tab-bg:#ffffff;--t-tab-hover-bg:#f3f4f6;--t-tab-fg:#1f2328;--t-tab-border:rgba(0,0,0,.16);
  --t-tab-shadow:0 6px 18px rgba(0,0,0,.18);--t-shadow:-12px 0 32px rgba(0,0,0,.18);
  --t-err-fg:#cf222e;--t-err-bg:rgba(255,255,255,.94);
  --t-count-bg:rgba(0,0,0,.08);--t-count-fg:#24292f;--t-grip-hover:rgba(9,105,218,.25)}
.dsh-term-panel[data-theme="dark"],.dsh-term-tab[data-theme="dark"],.dsh-term-embed[data-theme="dark"]{color-scheme:dark;
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
/* 嵌在 better-sidebar 页签里的形态：撑满页签，不要 fixed / 浮层阴影。 */
.dsh-term-embed{display:flex;flex-direction:column;position:relative;width:100%;height:100%;min-width:0;min-height:0;
  overflow:hidden;background:var(--t-bg);color:var(--t-fg)}
.dsh-term-head{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 10px;flex:0 0 auto;flex-wrap:wrap;
  border-bottom:1px solid var(--t-border-soft);background:var(--t-head-bg);
  font:600 12px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--t-fg)}
/* 页签形态的两行工具条：第一行状态+目录，第二行动作按钮，窄侧栏里不会挤成一团。 */
.dsh-term-head-compact{flex-wrap:nowrap;flex-direction:column;align-items:stretch;gap:5px}
.dsh-term-head-row{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-term-head-compact .dsh-term-cwd{flex:1 1 auto;max-width:none}
.dsh-term-head-actions{flex-wrap:wrap}
.dsh-term-head-actions .dsh-term-shell{flex:1 1 150px;max-width:none;min-width:130px}
.dsh-term-dot{width:7px;height:7px;border-radius:50%;background:var(--t-dot);flex:0 0 auto}
.dsh-term-dot[data-state="on"]{background:var(--t-dot-on);box-shadow:var(--t-dot-on-glow)}
.dsh-term-dot[data-state="err"]{background:var(--t-dot-err)}
.dsh-term-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-term-status{flex:0 0 auto;font:500 11px/1.4 ui-sans-serif,system-ui,sans-serif;color:var(--t-muted)}
.dsh-term-status[data-state="on"]{color:#1a7f37}
.dsh-term-status[data-state="err"]{color:var(--t-err-fg)}
.dsh-term-shell{flex:0 0 auto;max-width:170px;border:1px solid var(--t-btn-border);background:var(--t-btn-bg);
  color:var(--t-btn-fg);border-radius:5px;padding:1px 4px;font:500 11px/1.5 ui-sans-serif,system-ui,sans-serif;cursor:pointer}
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
.dsh-term-toast{position:absolute;z-index:2;padding:4px 12px;border-radius:999px;pointer-events:none;white-space:nowrap;
  background:var(--t-count-bg);color:var(--t-count-fg);box-shadow:0 4px 14px rgba(0,0,0,.20);
  font:500 11px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.dsh-term-toast[data-pos="bottom"]{left:50%;bottom:12px;transform:translateX(-50%)}
.dsh-term-toast[data-pos="bottomLeft"]{left:10px;bottom:12px}
.dsh-term-toast[data-pos="top"]{left:50%;top:8px;transform:translateX(-50%)}
/* 跟随鼠标：脱离面板流，按视口坐标定位在指针右上方，不遮挡刚选中的内容 */
.dsh-term-toast[data-pos="cursor"]{position:fixed;transform:translate(14px,-140%)}
.dsh-term-seg{flex:0 0 auto;padding:1px 8px;border-radius:999px;cursor:pointer;
  border:1px solid var(--t-btn-border);background:var(--t-btn-bg);color:var(--t-btn-fg);
  font:500 11px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.dsh-term-seg:hover{background:var(--t-btn-hover-bg);color:var(--t-btn-hover-fg)}
.dsh-term-seg[data-active="1"]{background:var(--t-btn-hover-bg);color:var(--t-btn-hover-fg);border-color:var(--t-btn-hover-bg);font-weight:600}
`;

		/**
		 * 注入面板所需的全局样式（只注入一次）。
		 * @returns 无返回值。
		 */
		function ensureStyle() {
			if (typeof document === "undefined") return;
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
		async function fetchInfo(key) {
			try {
				const res = await fetch(INFO_PATH + (key && key !== DEFAULT_KEY ? "?cwd=" + encodeURIComponent(key) : ""), { headers: { accept: "application/json" } });
				if (!res.ok) return null;
				return await res.json();
			} catch {
				return null;
			}
		}

		/**
		 * 终端后端（dsh 宿主 HTTP 服务）的 origin。
		 *
		 * 浏览器直开时页面就是宿主 origin，直接用 location 拼 WebSocket 没问题；
		 * 但桌面端页面跑在 Electron 自定义 scheme 下（origin 是 `dsh-app://app`），
		 * location.host 并不指向宿主，直接拼出来的 `ws://app/...` 必然连不上。
		 * 宿主通过 preload 在页面上暴露 `__DSH_TRANSPORT__.streamBaseUrl`（DSH 自带的
		 * 客户端也用它拼 WebSocket），这里优先用它，拿不到再退回 location。
		 * @returns 后端 origin 的 URL 对象。
		 */
		function transportBase() {
			const transport = globalThis.__DSH_TRANSPORT__;
			const stream = transport !== undefined && transport !== null ? transport.streamBaseUrl : undefined;
			if (typeof stream === "string" && stream !== "") {
				try {
					const url = new URL(stream);
					if (url.protocol === "http:" || url.protocol === "https:") return url;
				} catch {
					/* 非法值：继续走 location 兜底。 */
				}
			}
			const loc = globalThis.location;
			if (loc !== undefined && loc !== null && typeof loc.protocol === "string") {
				try {
					return new URL(`${loc.protocol}//${loc.host}`);
				} catch {
					/* 测试桩可能没有完整 location。 */
				}
			}
			return new URL("http://127.0.0.1");
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
				if (TOAST_POSITIONS.some((p) => p.key === parsed?.toastPos)) out.toastPos = parsed.toastPos;
			} catch {
				/* 隐私模式或脏数据：用默认值。 */
			}
			return out;
		}

		/**
		 * 保存复制/粘贴设置（含提示位置）。
		 * @param next - 完整设置对象。
		 * @returns 无返回值。
		 */
		function saveClipboard(next) {
			try {
				globalThis.localStorage?.setItem(KEY_CLIPBOARD, JSON.stringify(next));
			} catch {
				/* 隐私模式：仅本次会话有效。 */
			}
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

		/**
		 * 在下一帧执行回调（无 requestAnimationFrame 的环境同步执行）。
		 * @param fn - 待执行回调。
		 * @returns 无返回值。
		 */
		function raf(fn) {
			if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(fn);
			else fn();
		}

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
		 * 运行时未提供 useSessions 时的兜底 hook（保持 hook 调用位置稳定）。
		 * @returns 恒为 undefined。
		 */
		function fallbackUseSessions() {
			return undefined;
		}

		//#endregion

		//#region 共享设置（独立浮层面板与 better-sidebar 页签共用同一份）
		/** 当前设置：明暗主题 + 复制/粘贴开关。 */
		let settings;
		try {
			settings = { theme: readTheme(), clipboard: readClipboard() };
		} catch {
			settings = { theme: THEME_LIGHT_NAME, clipboard: { ...CLIPBOARD_DEFAULTS } };
		}
		/** 设置变化的订阅者。 */
		const settingsListeners = new Set();

		/**
		 * 读取当前设置。
		 * @returns 设置对象。
		 */
		function getSettings() {
			return settings;
		}

		/**
		 * 订阅设置变化。
		 * @param fn - 变化回调。
		 * @returns 取消订阅函数。
		 */
		function subscribeSettings(fn) {
			settingsListeners.add(fn);
			return () => {
				settingsListeners.delete(fn);
			};
		}

		/**
		 * 更新并持久化设置，通知所有订阅者（两个 UI 的终端都会跟着换主题/开关）。
		 * @param patch - 局部更新。
		 * @returns 更新后的完整设置。
		 */
		function updateSettings(patch) {
			const prev = settings;
			const next = { ...prev, ...patch };
			if (patch.theme !== undefined) {
				try {
					globalThis.localStorage?.setItem(KEY_THEME, next.theme);
				} catch {
					/* 隐私模式：仅本次会话有效。 */
				}
			}
			if (patch.clipboard !== undefined) saveClipboard(next.clipboard);
			settings = next;
			for (const fn of [...settingsListeners]) {
				try {
					fn(next, prev);
				} catch (error) {
					console.error("[dsh-terminal] 设置订阅者异常：", error);
				}
			}
			return next;
		}

		/** 在浅色/暗色之间切换（并持久化、同步所有终端）。 */
		function toggleTheme() {
			updateSettings({ theme: settings.theme === THEME_DARK_NAME ? THEME_LIGHT_NAME : THEME_DARK_NAME });
		}

		/**
		 * 修改复制/粘贴开关。
		 * @param patch - 要修改的字段。
		 * @returns 无返回值。
		 */
		function patchClipboard(patch) {
			updateSettings({ clipboard: { ...settings.clipboard, ...patch } });
		}

		/** 每个工作区（会话键）选中的 shell id；空串/缺项表示用宿主默认 shell。 */
		const shellChoices = (() => {
			try {
				const raw = globalThis.localStorage?.getItem(KEY_SHELLS);
				const parsed = raw === null || raw === undefined || raw === "" ? null : JSON.parse(raw);
				return parsed !== null && typeof parsed === "object" ? parsed : {};
			} catch {
				return {};
			}
		})();

		/**
		 * 读取某工作区选中的 shell id。
		 * @param key - 会话键。
		 * @returns shell id；未选择时为空串。
		 */
		function getShellChoice(key) {
			const id = shellChoices[key];
			return typeof id === "string" && id !== "bash" ? id : "";
		}

		/**
		 * 记住某工作区选中的 shell id（空串表示恢复宿主默认）。
		 * @param key - 会话键。
		 * @param id - shell id。
		 * @returns 无返回值。
		 */
		function setShellChoice(key, id) {
			if (typeof id === "string" && id !== "") shellChoices[key] = id;
			else delete shellChoices[key];
			try {
				globalThis.localStorage?.setItem(KEY_SHELLS, JSON.stringify(shellChoices));
			} catch {
				/* 隐私模式：仅本次会话有效。 */
			}
		}
		//#endregion

		//#region 终端核心（与 UI 解耦，浮层与页签共用）
		/**
		 * 建一个终端核心：按工作区目录维护常驻 PTY 连接 + xterm 实例。
		 *
		 * 刻意放在模块级（而不是组件内）：浮层面板与 better-sidebar 页签是两个
		 * 组件，但同一工作区必须共享同一个 shell。组件只负责把宿主 div 挂到自己
		 * 的容器里再摘下来，终端本体与 WebSocket 不随组件挂载/卸载而重建。
		 * @returns 终端核心 API。
		 */
		function createTerminalCore() {
			/** 会话表：工作区目录 -> {host, term, fit, ws, ...}。 */
			const sessions = new Map();
			/** 状态变化订阅者（头部状态点/错误提示需要重渲染）。 */
			const listeners = new Set();
			/** 递增版本号，订阅者据此知道该重渲染了。 */
			let revision = 0;

			/**
			 * 通知所有订阅者会话状态有变化。
			 * @returns 无返回值。
			 */
			function changed() {
				revision++;
				for (const fn of [...listeners]) {
					try {
						fn(revision);
					} catch (error) {
						console.error("[dsh-terminal] 会话订阅者异常：", error);
					}
				}
			}

			/**
			 * 订阅会话状态变化。
			 * @param fn - 变化回调。
			 * @returns 取消订阅函数。
			 */
			function subscribe(fn) {
				listeners.add(fn);
				return () => {
					listeners.delete(fn);
				};
			}

			/**
			 * 确保某个工作区拥有终端会话记录（不启动 PTY，纯粹建记录）。
			 * @param key - 会话键。
			 * @returns 会话记录。
			 */
			function ensure(key) {
				const exist = sessions.get(key);
				if (exist !== undefined) return exist;
				const host = document.createElement("div");
				host.className = "dsh-term-host";
				host.style.width = "100%";
				host.style.height = "100%";
				host.style.display = "none";
				const s = {
					key,
					host,
					container: null,
					term: null,
					fit: null,
					webgl: null,
					ws: null,
					observer: null,
					status: "wait",
					error: "",
					retry: null,
					disposed: false,
					booting: false,
					booted: false,
					/** 「选中即复制」的防抖定时器。 */
					selectTimer: null,
					/** 右键粘贴的宿主监听器（回收时移除）。 */
					onContextMenu: null,
					/** 提示气泡回调（当前挂载的 UI 注入；未挂载时为 null）。 */
					notify: null
				};
				sessions.set(key, s);
				return s;
			}

			/**
			 * 取会话记录。
			 * @param key - 会话键。
			 * @returns 会话记录或 null。
			 */
			function session(key) {
				return sessions.get(key) ?? null;
			}

			/**
			 * 当前常驻会话键列表。
			 * @returns 键列表。
			 */
			function keys() {
				return [...sessions.keys()];
			}

			/**
			 * 常驻会话数量。
			 * @returns 数量。
			 */
			function size() {
				return sessions.size;
			}

			/**
			 * 对指定会话做一次 fit（容器不可见时跳过，避免 PTY 被缩成 0 列）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function refit(key) {
				const s = sessions.get(key);
				if (s === undefined || s === null) return;
				if (s.fit === null || s.host === null) return;
				if (s.host.clientWidth === 0 || s.host.clientHeight === 0) return;
				try {
					s.fit.fit();
				} catch {
					/* 尺寸竞争时忽略。 */
				}
			}

			/**
			 * 聚焦指定会话的终端。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function focus(key) {
				const s = sessions.get(key);
				if (s === undefined || s === null) return;
				try {
					s.term?.focus?.();
				} catch {
					/* 终端已销毁。 */
				}
			}

			/**
			 * 清屏（仅当前会话，保留滚动缓冲之外的内容）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function clear(key) {
				const s = sessions.get(key);
				if (s === undefined || s === null) return;
				try {
					s.term?.clear?.();
				} catch {
					/* 终端已销毁。 */
				}
			}

			/**
			 * 重建到后端的 WebSocket（复用同一个 xterm 与 PTY 后端）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function reconnect(key) {
				const s = sessions.get(key);
				if (s === undefined || s === null) return;
				connect(s);
			}

			/**
			 * 把会话的宿主 div 挂进某个容器并启动（幂等）。
			 * @param key - 会话键。
			 * @param container - DOM 容器。
			 * @returns 会话记录。
			 */
			function attach(key, container) {
				const s = ensure(key);
				if (container !== null && container !== undefined && s.container !== container) {
					if (s.host.parentElement !== container) container.appendChild(s.host);
					s.container = container;
				}
				s.host.style.display = "block";
				if (!s.booted && !s.booting) {
					s.booting = true;
					void boot(s);
				}
				raf(() => refit(key));
				return s;
			}

			/**
			 * 显示指定会话（切换工作区时用）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function show(key) {
				const s = sessions.get(key);
				if (s === undefined || s === null) return;
				s.host.style.display = "block";
				raf(() => refit(key));
			}

			/**
			 * 隐藏指定会话（保留 PTY 与滚动缓冲，切回来继续）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function hide(key) {
				const s = sessions.get(key);
				if (s === undefined || s === null) return;
				s.host.style.display = "none";
			}

			/**
			 * 把会话的宿主 div 从容器里摘下来（不销毁终端）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function detach(key) {
				const s = sessions.get(key);
				if (s === undefined || s === null) return;
				try {
					s.host.remove?.();
				} catch {
					/* 已经不在 DOM 里。 */
				}
				s.container = null;
				s.notify = null;
			}

			/**
			 * 把主题同步到所有常驻终端。
			 * @param palette - xterm 调色板。
			 * @returns 无返回值。
			 */
			function applyTheme(palette) {
				for (const s of sessions.values()) {
					const term = s.term;
					if (term === null || term === undefined) continue;
					try {
						term.options.theme = palette;
					} catch {
						/* 终端已销毁。 */
					}
				}
			}

			/**
			 * 为某个会话建立（或重建）到后端的 WebSocket，并按需自动重连。
			 * @param s - 会话记录。
			 * @param attempt - 第几个候选后端（0=独立进程，1=同源路由）。
			 * @returns 无返回值。
			 */
			function connect(s, attempt = 0) {
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
				changed();

				// 后端 origin：浏览器直开时是 location；桌面端（dsh-app:// 页面）是
				// __DSH_TRANSPORT__.streamBaseUrl 指向的宿主 HTTP 服务。
				const base = transportBase();
				const proto = base.protocol === "https:" ? "wss:" : "ws:";
				const qs = new URLSearchParams({ cols: String(term.cols || 80), rows: String(term.rows || 24) });
				// 把本会话所属工作区交给宿主，PTY 就在该目录下启动。
				if (s.key !== DEFAULT_KEY) qs.set("cwd", s.key);
				// 该工作区选中的 shell（cmd / powershell / WSL / SSH …）；空表示宿主默认。
				const chosenShell = getShellChoice(s.key);
				if (chosenShell !== "") qs.set("shell", chosenShell);

				// 候选后端：先独立终端进程（延迟不受 dsh 主进程影响），再同源路由兜底。
				let helperPort = HELPER_DEFAULT_PORT;
				try {
					const override = Number(globalThis.localStorage?.getItem(HELPER_PORT_KEY));
					if (Number.isFinite(override) && override > 0) helperPort = override;
				} catch {
					/* 隐私模式等拿不到 localStorage，用默认端口。 */
				}
				const targets = [
					{ kind: "helper", url: `${proto}//${base.hostname}:${helperPort}/ws?${qs.toString()}` },
					{ kind: "inline", url: `${proto}//${base.host}${WS_PATH}?${qs.toString()}` }
				];
				const target = targets[Math.min(attempt, targets.length - 1)];

				let ws;
				try {
					ws = new WebSocket(target.url);
				} catch (err) {
					s.status = "err";
					s.error = String(err?.message ?? err);
					changed();
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
					if (s.disposed) return;
					opened = true;
					s.backend = target.kind;
					s.status = "on";
					s.error = "";
					changed();
					refit(s.key);
					if (term.cols > 0) ws.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
					if (target.kind === "helper") {
						console.info(
							`[dsh-terminal] 已连接独立终端进程 ${base.hostname}:${helperPort}（按键回显不受 dsh 主进程负载影响）`
						);
					} else {
						console.info("[dsh-terminal] 独立终端进程不可达，已回退到同源路由。");
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
					if (s.disposed) return;
					// 还没握手就断开：说明该后端不可达（独立进程没起、或端口未转发），
					// 立刻换下一个候选后端；全都试过才进入 3 秒重连。
					if (!opened && attempt + 1 < targets.length) {
						s.status = "wait";
						changed();
						connect(s, attempt + 1);
						return;
					}
					s.status = "err";
					s.error = opened ? "连接已断开，3 秒后自动重连…" : "无法连接终端后端，3 秒后重试…";
					changed();
					if (s.retry !== null) clearTimeout(s.retry);
					s.retry = setTimeout(() => {
						s.retry = null;
						if (!s.disposed) connect(s, 0);
					}, 3000);
				};

				ws.onerror = () => {
					/* 具体原因由 onclose 统一处理。 */
				};
			}

			/**
			 * 启动一个会话：加载 xterm 资源、建终端、挂剪贴板与尺寸监听、连后端。
			 * @param s - 会话记录。
			 * @returns 无返回值。
			 */
			async function boot(s) {
				try {
					await loadAssets();
				} catch (err) {
					if (s.disposed) return;
					s.status = "err";
					s.error = `终端资源加载失败：${String(err?.message ?? err)}\n请确认已刷新页面以加载最新插件。`;
					changed();
					return;
				}
				if (s.disposed) return;

				const term = new globalThis.Terminal({
					cursorBlink: true,
					fontSize: 13,
					fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
					lineHeight: 1.2,
					scrollback: 10000,
					allowProposedApi: true,
					theme: themeOf(getSettings().theme)
				});
				const fit = new globalThis.FitAddon.FitAddon();
				term.loadAddon(fit);
				term.open(s.host);
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
					if (getSettings().clipboard.ctrlC !== true) return true;
					const key = typeof ev.key === "string" ? ev.key.toLowerCase() : "";
					if (key !== "c") return true;
					if ((ev.ctrlKey !== true && ev.metaKey !== true) || ev.altKey === true || ev.shiftKey === true) return true;
					const selected = selectionOf(term);
					if (selected === "") return true;
					const at = ev.clientX !== undefined && ev.clientX !== 0 ? { x: ev.clientX, y: ev.clientY } : null;
					void copyText(selected).then((ok) => {
						s.notify?.(ok ? `已复制 ${selected.length} 个字符` : "复制失败：浏览器拒绝了剪贴板写入", at);
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
					if (getSettings().clipboard.selectCopy !== true) return;
					if (s.selectTimer !== null) clearTimeout(s.selectTimer);
					s.selectTimer = setTimeout(() => {
						s.selectTimer = null;
						const selected = selectionOf(term);
						if (selected === "") return;
						void copyText(selected).then((ok) => {
							if (ok) s.notify?.(`已复制 ${selected.length} 个字符`);
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
					if (getSettings().clipboard.rightPaste !== true) return;
					ev.preventDefault?.();
					const at = { x: ev.clientX ?? 0, y: ev.clientY ?? 0 };
					void readClipboardText().then((text) => {
						if (text === null) {
							s.notify?.("此环境不允许读取剪贴板，请用 Ctrl+V 粘贴", at);
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
						s.notify?.(`已粘贴 ${text.length} 个字符`, at);
					});
				};
				// 用捕获阶段挂载：即使 xterm 内部对右键做了 stopPropagation，也保证能拦到。
				s.host.addEventListener?.("contextmenu", onContextMenu, true);
				s.onContextMenu = onContextMenu;

				if (typeof ResizeObserver !== "undefined") {
					s.observer = new ResizeObserver(() => refit(s.key));
					s.observer.observe(s.host);
				}

				term.write(`\r\n\x1b[2m[已为工作区 ${labelOf(s.key)} 启动常驻终端；切走后它继续运行]\x1b[0m\r\n`);
				s.booted = true;
				refit(s.key);
				connect(s);
				changed();
			}

			/**
			 * 销毁一个会话（关 WS → 后端会回收 PTY；再销毁 xterm 与 DOM）。
			 * @param key - 会话键。
			 * @returns 无返回值。
			 */
			function dispose(key) {
				const s = sessions.get(key);
				if (s === undefined) return;
				s.disposed = true;
				if (s.retry !== null) clearTimeout(s.retry);
				if (s.selectTimer !== null) clearTimeout(s.selectTimer);
				if (s.onContextMenu !== null) {
					try {
						s.host?.removeEventListener?.("contextmenu", s.onContextMenu, true);
					} catch {
						/* 已不在。 */
					}
				}
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
				try {
					s.host?.remove?.();
				} catch {
					/* 忽略。 */
				}
				sessions.delete(key);
				changed();
			}

			/**
			 * 销毁全部会话（插件卸载时调用）。
			 * @returns 无返回值。
			 */
			function disposeAll() {
				for (const key of [...sessions.keys()]) dispose(key);
			}

			return {
				attach,
				applyTheme,
				clear,
				detach,
				dispose,
				disposeAll,
				focus,
				hide,
				keys,
				reconnect,
				refit,
				session,
				show,
				size,
				subscribe
			};
		}

		/** 全局唯一的终端核心：浮层面板与 better-sidebar 页签共享。 */
		const core = createTerminalCore();
		//#endregion

		//#region 接入方式（独立浮层 / better-sidebar 页签）
		/**
		 * 当前 UI 的挂载方式：
		 * - "overlay"：独立浮层面板（没装 better-sidebar 时的默认形态）；
		 * - "tab"：作为 better-sidebar 的侧栏页签（只注册页签，不再挂浮层）。
		 * 两个 UI 组件都订阅它，保证同一时刻只有一种形态在画面上。
		 */
		const integration = {
			mode: "overlay",
			listeners: new Set(),
			/**
			 * 切换挂载方式并通知订阅者。
			 * @param next - 新的方式。
			 * @returns 无返回值。
			 */
			set(next) {
				if (this.mode === next) return;
				this.mode = next;
				for (const fn of [...this.listeners]) {
					try {
						fn(next);
					} catch (error) {
						console.error("[dsh-terminal] 接入方式订阅者异常：", error);
					}
				}
			},
			/**
			 * 订阅挂载方式变化。
			 * @param fn - 变化回调。
			 * @returns 取消订阅函数。
			 */
			subscribe(fn) {
				this.listeners.add(fn);
				return () => {
					this.listeners.delete(fn);
				};
			}
		};

		/**
		 * 订阅共享设置（主题/剪贴板）。
		 * @returns 当前设置对象。
		 */
		function useSettings() {
			const [value, setValue] = react.useState(getSettings);
			react.useEffect(() => subscribeSettings((next) => setValue(next)), []);
			return value;
		}

		/**
		 * 订阅挂载方式。
		 * @returns 当前方式（"overlay" 或 "tab"）。
		 */
		function useIntegrationMode() {
			const [mode, setMode] = react.useState(integration.mode);
			react.useEffect(() => integration.subscribe(setMode), []);
			return mode;
		}

		/**
		 * 订阅终端核心的状态变化，让工具条能跟上连接状态/错误/数量。
		 * @returns 递增的版本号（仅用于触发重渲染）。
		 */
		function useCoreVersion() {
			const [version, setVersion] = react.useState(0);
			react.useEffect(() => core.subscribe(setVersion), []);
			return version;
		}

		/**
		 * 复制/粘贴提示气泡：显示、自动消失，并记住最近一次指针位置。
		 * @returns 气泡内容、位置、触发函数与指针跟踪函数。
		 */
		function useFlash() {
			const [toast, setToast] = react.useState("");
			const [toastAt, setToastAt] = react.useState(null);
			const timerRef = react.useRef(null);
			/** 最近一次指针位置（视口坐标），供键盘触发复制/粘贴的「跟随鼠标」档使用。 */
			const pointerRef = react.useRef(null);

			const flash = react.useCallback((message, at) => {
				if (getSettings().clipboard.toastPos === "off") return;
				setToastAt(at ?? pointerRef.current ?? null);
				setToast(message);
				if (timerRef.current !== null) clearTimeout(timerRef.current);
				timerRef.current = setTimeout(() => {
					setToast("");
					setToastAt(null);
				}, TOAST_MS);
			}, []);

			const trackPointer = react.useCallback((ev) => {
				pointerRef.current = { x: ev.clientX, y: ev.clientY };
			}, []);

			react.useEffect(
				() => () => {
					if (timerRef.current !== null) clearTimeout(timerRef.current);
				},
				[]
			);

			return { toast, toastAt, flash, trackPointer };
		}

		/**
		 * 状态点：连接中 / 已连接 / 出错。
		 * @param status - 会话状态。
		 * @returns React 元素。
		 */
		function renderDot(status) {
			return h("span", {
				className: "dsh-term-dot",
				"data-state": status === "on" ? "on" : status === "err" ? "err" : "wait"
			});
		}

		/**
		 * 终端工具条（浮层面板与页签共用的头部）。
		 * @param options - 展示项与按钮回调。
		 * @returns React 元素。
		 */
		function infoOptions(options, shells) { return options.detectedShell && !shells.some((sh) => sh.id === options.detectedShell.id) ? [h("option", { value: options.detectedShell.id }, options.detectedShell.label)] : []; }
		function useMenuDismiss(open, setOpen) {
			react.useEffect(() => {
				if (!open) return;
				const outside = (event) => {
					if (event.target?.closest?.('[data-dsh-terminal-menu], button[title="复制/粘贴设置"]')) return;
					setOpen(false);
				};
				const escape = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener?.("pointerdown", outside, true);
				document.addEventListener?.("keydown", escape, true);
				return () => {
					document.removeEventListener?.("pointerdown", outside, true);
					document.removeEventListener?.("keydown", escape, true);
				};
			}, [open, setOpen]);
		}

		function SessionMenu(props) {
			const ref = react.useRef(null);
			react.useEffect(() => {
				const outside = (event) => {
					const node = ref.current;
					if (node?.open && !node.contains(event.target)) node.open = false;
				};
				const escape = (event) => {
					if (event.key === "Escape" && ref.current?.open) ref.current.open = false;
				};
				document.addEventListener("pointerdown", outside, true);
				document.addEventListener("keydown", escape, true);
				return () => {
					document.removeEventListener("pointerdown", outside, true);
					document.removeEventListener("keydown", escape, true);
				};
			}, []);
			return h("details", { ref, className: "dsh-term-sessions", style: { position: "relative" } }, ...props.children);
		}

		function renderToolbar(options) {
			const shells = Array.isArray(options.shells) ? options.shells : [];
			const shellId = typeof options.shellId === "string" ? options.shellId : "";
			const compact = options.compact === true;
			const button = (label, title, onClick, extra) =>
				h("button", { className: "dsh-term-btn", onClick, title, ...(extra ?? {}) }, label);
			const themeButton = button(
				options.theme === THEME_DARK_NAME ? "暗色" : "浅色",
				options.theme === THEME_DARK_NAME ? "当前为暗色。点击切换为浅色" : "当前为浅色。点击切换为暗色",
				options.onTheme
			);
			const menuButton = button("复制", "复制/粘贴设置", options.onMenu, {
				"data-active": options.menuOpen ? "1" : "0"
			});
			const clearButton = button("清屏", "清屏（仅当前工作区）", options.onClear);
			const reconnectButton = button("重连", "重新连接当前工作区的 PTY", options.onReconnect);
			// 第一项是「默认 shell」（空 id）：按工作目录自动选 bash（Windows 用 Git Bash，
			// WSL 目录用该发行版 bash，remote-ssh 工作区 ssh 到远端 bash）。
			const shellSelect =
				shells.length === 0
					? null
					: h(
							"select",
							{
								className: "dsh-term-shell",
								title: "选择本工作区终端使用的 shell（默认 shell / Windows:cmd / Windows:PowerShell / WSL / SSH）",
								value: shellId,
								onChange: (ev) => {
									if (typeof options.onShell === "function") options.onShell(ev.target.value);
								}
							},
							...(infoOptions(options, shells)),
							...shells.map((sh) => h("option", { key: sh.id, value: sh.id }, sh.label ?? sh.id))
						);
			const statusNode = h(
				"span",
				{ className: "dsh-term-status", "data-state": options.status, title: options.statusTitle ?? "" },
				options.status === "on" ? "已连接" : options.status === "err" ? "连接失败" : "连接中…"
			);
			const cwdNode = h("span", { className: "dsh-term-cwd", title: options.shownCwd }, options.shownCwd);
			const countNode = h(SessionMenu, null,
				h("summary", { className: "dsh-term-count", title: "查看和关闭后台终端（包含当前终端）", style: { cursor: "pointer", whiteSpace: "nowrap" } }, `后台终端：${options.count}`),
				h("div", { style: { position: "absolute", right: 0, top: "100%", zIndex: 50, background: "var(--t-bg, white)", border: "1px solid #888", padding: "8px", width: "300px", maxHeight: "240px", overflow: "auto" } },
					h("div", null, "包含当前终端；关闭会结束其中运行的命令。"),
					...core.keys().map((key) => h("div", { key, style: { display: "flex", gap: "8px", marginTop: "6px" } },
						h("span", { title: labelOf(key), style: { flex: 1, overflowWrap: "anywhere" } }, labelOf(key) + (labelOf(key) === options.shownCwd ? "（当前）" : "")),
						h("button", { type: "button", onClick: () => core.dispose(key) }, "关闭"))),
					h("button", { type: "button", style: { marginTop: "8px" }, onClick: () => {
						for (const key of core.keys()) if (labelOf(key) !== options.shownCwd) core.dispose(key);
					} }, "关闭其他终端")
				));

			// 页签形态：两行。第一行=状态点 + 连接状态 + 工作目录，第二行=shell 选择 +
			// 操作按钮。页签标题由侧栏自己显示，这里不再重复标题、也不用固定的「收起」。
			if (compact === true) {
				return h(
					"div",
					{ className: "dsh-term-head dsh-term-head-compact" },
					h("div", { className: "dsh-term-head-row" }, renderDot(options.status), statusNode, cwdNode, countNode),
					h(
						"div",
						{ className: "dsh-term-head-row dsh-term-head-actions" },
						shellSelect,
						themeButton,
						menuButton,
						clearButton,
						reconnectButton
					)
				);
			}

			const kids = [
				renderDot(options.status),
				statusNode,
				h("span", { className: "dsh-term-title" }, "终端"),
				cwdNode,
				countNode
			];
			if (shellSelect !== null) kids.push(shellSelect);
			kids.push(
				h(
					"button",
					{
						className: "dsh-term-btn",
						onClick: options.onLayout,
						title:
							options.mode === MODE_DOCK
								? "当前为并排：DSH 让出右侧空间。点击改为浮层覆盖"
								: "当前为浮层：终端盖在 DSH 上。点击改为并排（DSH 让出空间）"
					},
					options.mode === MODE_DOCK ? "并排" : "浮层"
				),
				themeButton,
				menuButton,
				clearButton,
				reconnectButton,
				h("button", { className: "dsh-term-btn", onClick: options.onCollapse, title: "收起终端（Ctrl+`）" }, "收起")
			);
			return h("div", { className: "dsh-term-head" }, ...kids);
		}

		/**
		 * 复制/粘贴设置菜单。
		 * @param options - 当前开关与回调。
		 * @returns React 元素。
		 */
		function renderMenu(options) {
			return h(
				"div",
				{ className: "dsh-term-menu", "data-dsh-terminal-menu": "1" },
				h("span", { className: "dsh-term-menu-label" }, "复制/粘贴"),
				...CLIPBOARD_OPTIONS.map((opt) =>
					h(
						"label",
						{ className: "dsh-term-opt", key: opt.key, title: opt.title },
						h("input", {
							type: "checkbox",
							checked: options.clipboard[opt.key] === true,
							onChange: () => options.onToggle(opt.key)
						}),
						opt.label
					)
				),
				h(
					"span",
					{ className: "dsh-term-menu-hint" },
					"三个开关互相独立、可同时打开；Ctrl+C 只在有选中内容时复制，读取剪贴板需 localhost 或 HTTPS"
				),
				h("span", { className: "dsh-term-menu-label" }, "提示位置"),
				...TOAST_POSITIONS.map((pos) =>
					h(
						"button",
						{
							key: pos.key,
							className: "dsh-term-seg",
							"data-active": options.clipboard.toastPos === pos.key ? "1" : "0",
							title: pos.title,
							onClick: () => options.onToastPos(pos.key)
						},
						pos.label
					)
				)
			);
		}

		/**
		 * 终端主体：宿主容器 + 提示气泡 + 错误条。
		 * @param options - 容器 ref、开关、气泡与错误。
		 * @returns React 元素。
		 */
		function renderBody(options) {
			const clipboard = options.clipboard;
			return h(
				"div",
				{ className: "dsh-term-body" },
				// 每个工作区一个宿主 div，由核心在 attach 时追加进来；
				// 这里用独立容器，避免与 React 的子节点管理相互干扰。
				h("div", { className: "dsh-term-hosts", ref: options.containerRef }),
				options.toast !== ""
					? h(
							"div",
							{
								className: "dsh-term-toast",
								"data-dsh-terminal-toast": "1",
								"data-pos": clipboard.toastPos,
								style:
									clipboard.toastPos === "cursor" && options.toastAt !== null
										? {
												left: `${Math.max(8, Math.min(options.toastAt.x, (globalThis.innerWidth ?? 1024) - 200))}px`,
												top: `${options.toastAt.y}px`
											}
										: undefined
							},
							options.toast
						)
					: null,
				options.error !== "" ? h("div", { className: "dsh-term-err" }, options.error) : null
			);
		}
		//#endregion

		//#region 独立浮层面板（现有形态）
		/**
		 * 右侧常驻终端面板：**每个工作区各保留一个常驻 shell**。
		 *
		 * 组件注册在 root 作用域的 `shell.overlay` 列表槽里，因此对每个会话
		 * （包括新建会话页）都存在，且切换会话不会卸载。内部按工作区目录维护
		 * 多份终端：切换工作区只是切换显示哪一份，其它工作区的 shell 保持运行、
		 * 滚动缓冲保持完整（终端核心在模块级，见 createTerminalCore）。
		 * @param props - 槽注入属性，含全局 useSessions。
		 * @returns 面板、悬浮开合按钮或 null（已接入 better-sidebar 时）。
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
			/** 复制/粘贴设置菜单是否展开。 */
			const [menuOpen, setMenuOpen] = react.useState(false);
			useMenuDismiss(menuOpen, setMenuOpen);
			const [info, setInfo] = react.useState(null);

			const settings = useSettings();
			const integrationMode = useIntegrationMode();
			const { toast, toastAt, flash, trackPointer } = useFlash();
			// 订阅核心状态：连接状态/错误/常驻数量变化时重渲染工具条。
			useCoreVersion();

			/** 各工作区终端宿主的父容器（React 管理，尺寸稳定）。 */
			const hostsRef = react.useRef(null);
			const activeKeyRef = react.useRef(activeKey);
			const aliveRef = react.useRef(false);
			const visibleRef = react.useRef(open);

			// 挂载：注入样式、拉取宿主信息。
			react.useEffect(() => {
				aliveRef.current = true;
				ensureStyle();
				(async () => {
					const meta = await fetchInfo(activeKey);
					if (!aliveRef.current) return;
					setInfo(meta);
				})();
				return () => {
					aliveRef.current = false;
				};
			}, []);

			// 工作区变化：确保该工作区有常驻终端并切到它，其它工作区继续运行。
			// 已接入 better-sidebar 页签时不再操作浮层容器（终端由页签组件接管）。
			react.useEffect(() => {
				activeKeyRef.current = activeKey;
				if (integrationMode === "tab") return;
				const container = hostsRef.current;
				if (container === null) return;
				const s = core.attach(activeKey, container);
				if (s !== null) s.notify = flash;
				core.show(activeKey);
				for (const key of core.keys()) {
					if (key !== activeKey) core.hide(key);
				}
				raf(() => {
					core.refit(activeKey);
					if (visibleRef.current) core.focus(activeKey);
				});
			}, [activeKey, integrationMode, flash]);

			// 展开/收起：隐藏不销毁，故 shell 与滚动缓冲都保留。
			react.useEffect(() => {
				visibleRef.current = open;
				try {
					globalThis.localStorage?.setItem(KEY_OPEN, open ? "1" : "0");
				} catch {
					/* 隐私模式。 */
				}
				if (!open) return;
				raf(() => {
					core.refit(activeKeyRef.current);
					core.focus(activeKeyRef.current);
				});
			}, [open]);

			// 面板宽度变化：重算行列数。
			react.useEffect(() => {
				core.refit(activeKeyRef.current);
			}, [width]);

			// 并排模式：把 DSH 的 AppFrame 整体收窄，让它的三栏自己重排，终端占住让出来的这一条。
			// AppFrame 用 ResizeObserver 观测自身宽度来解算列宽，所以改 margin 就会触发正确重排
			// （侧栏不妥协、正文保底、必要时自动关掉右侧详情栏），不会像浮层那样盖住内容。
			react.useEffect(() => {
				const overlay = document.querySelector("[data-shell-overlay]");
				const frame = overlay != null ? overlay.parentElement : null;
				if (frame === null) return;
				// 折叠时不占位；浮层模式不占位；页签模式由侧栏管理布局。
				const docked = open === true && mode === MODE_DOCK && canPortal() && integration.mode !== "tab";
				frame.style.marginRight = docked ? `${width}px` : "";
				return () => {
					frame.style.marginRight = "";
				};
			}, [open, width, mode]);

			// 记住布局模式。
			react.useEffect(() => {
				try {
					globalThis.localStorage?.setItem(KEY_MODE, mode);
				} catch {
					/* 隐私模式。 */
				}
			}, [mode]);

			// 全局按键处理：仅接管 Ctrl+`（含 Cmd+`）。
			// 嵌入 better-sidebar 后由侧栏自己的快捷键负责开合，不再全局劫持反引号。
			react.useEffect(() => {
				if (integrationMode === "tab") return;
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
			}, [integrationMode]);

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
						core.refit(activeKeyRef.current);
					};
					/** 结束拖动并持久化宽度。 */
					const up = () => {
						globalThis.removeEventListener("pointermove", move);
						globalThis.removeEventListener("pointerup", up);
						const el = document.querySelector(".dsh-term-panel");
						const finalWidth = el !== null ? Math.round(el.getBoundingClientRect().width) : startW;
						try {
							globalThis.localStorage?.setItem(KEY_WIDTH, String(finalWidth));
						} catch {
							/* 隐私模式。 */
						}
					};
					globalThis.addEventListener("pointermove", move);
					globalThis.addEventListener("pointerup", up);
				},
				[width]
			);

			// 暴露一个调试/测试入口，便于在控制台直接开合与查看各工作区终端。
			react.useEffect(() => {
				globalThis.__DSH_TERMINAL__ = {
					open: () => setOpen(true),
					close: () => setOpen(false),
					toggle: () => setOpen((v) => !v),
					reconnect: () => core.reconnect(activeKeyRef.current),
					clear: () => core.clear(activeKeyRef.current),
					sessions: () => core.keys().map(labelOf),
					state: () => core.session(activeKeyRef.current)?.status ?? "wait",
					mode: () => mode,
					theme: () => getSettings().theme,
					toggleTheme: () => toggleTheme(),
					toggleLayout: () => setMode((m) => (m === MODE_DOCK ? MODE_OVERLAY : MODE_DOCK)),
					frameMargin: () => {
						const o = document.querySelector("[data-shell-overlay]");
						return o != null && o.parentElement !== null ? o.parentElement.style.marginRight : "";
					}
				};
			});

			// 已作为 better-sidebar 页签挂载：浮层完全让位，避免出现两个终端。
			if (integrationMode === "tab") return null;

			const act = core.session(activeKey);
			const state = act !== null ? act.status : "wait";
			const error = act !== null ? act.error : "";
			const shownCwd = typeof wsCwd === "string" && wsCwd !== "" ? wsCwd : (typeof info?.cwd === "string" ? info.cwd : labelOf(activeKey));
			const count = core.size();
			const clipboard = settings.clipboard;

			/** 面板主体（始终挂载，折叠时用 display:none 隐藏以保留所有 shell）。 */
			const panel = h(
				"div",
				{
					className: "dsh-term-panel",
					"data-dsh-terminal-panel": "1",
					"data-mode": mode,
					"data-theme": settings.theme,
					style: { width: `${width}px`, display: open ? "flex" : "none" },
					// 记下指针位置，供提示气泡的「跟随鼠标」档与键盘触发的复制使用。
					onPointerMove: trackPointer
				},
				h("div", { className: "dsh-term-grip", onPointerDown: onGripDown, title: "拖动调整宽度" }),
				renderToolbar({
					compact: false,
					status: state,
					statusTitle: error,
					shownCwd,
					count,
					shells: info !== null && Array.isArray(info.shells) ? info.shells : [],
					shellId: getShellChoice(activeKey) || info?.detectedShell?.id || "",
					detectedShell: info?.detectedShell,
					onShell: (id) => {
						setShellChoice(activeKey, id);
						core.reconnect(activeKey);
					},
					menuOpen,
					mode,
					theme: settings.theme,
					onTheme: toggleTheme,
					onMenu: () => setMenuOpen((v) => !v),
					onClear: () => core.clear(activeKey),
					onReconnect: () => core.reconnect(activeKey),
					onLayout: () => setMode((m) => (m === MODE_DOCK ? MODE_OVERLAY : MODE_DOCK)),
					onCollapse: () => setOpen(false)
				}),
				menuOpen
					? renderMenu({
							clipboard,
							onToggle: (key) => patchClipboard({ [key]: clipboard[key] !== true }),
							onToastPos: (pos) => patchClipboard({ toastPos: pos })
						})
					: null,
				renderBody({ containerRef: hostsRef, clipboard, toast, toastAt, error })
			);

			/** 折叠时的悬浮开合按钮。 */
			const tab =
				open === true
					? null
					: h(
							"button",
							{
								className: "dsh-term-tab",
								"data-theme": settings.theme,
								onClick: () => setOpen(true),
								title: "打开终端（Ctrl+`）"
							},
							renderDot(state),
							"终端"
						);

			const tree = h(react.Fragment, null, panel, tab);
			// 挂到 body：脱离 AppFrame 的 overflow:hidden，position:fixed 才能锚定视口右缘。
			return canPortal() ? reactDom.createPortal(tree, document.body) : tree;
		}
		//#endregion

		//#region better-sidebar 页签形态
		/**
		 * 由页签的 scope/tab 推出终端会话键。
		 * @param scope - better-sidebar 的会话范围。
		 * @param tab - 页签实例（可能带 meta.cwd）。
		 * @returns 会话键。
		 */
		function keyForScope(scope, tab) {
			const scopeCwd = typeof scope?.cwd === "string" && scope.cwd !== "" ? scope.cwd : undefined;
			const metaCwd = typeof tab?.meta?.cwd === "string" && tab.meta.cwd !== "" ? tab.meta.cwd : undefined;
			return keyOf(scopeCwd ?? metaCwd);
		}

		/**
		 * 作为 better-sidebar 侧栏页签渲染的终端。
		 *
		 * 只保留终端本体与紧凑工具条：位置、宽度、开合都交给侧栏本身，
		 * 不再用 fixed 浮层/portal/宽度拖拽（这些是独立安装时的形态）。
		 * @param props - better-sidebar 的 TabComponentProps（ctx/store/scope/tab/visible）。
		 * @returns 终端页签或 null。
		 */
		function TerminalTab(props) {
			const activeKey = keyForScope(props?.scope ?? null, props?.tab ?? null);
			const settings = useSettings();
			const { toast, toastAt, flash, trackPointer } = useFlash();
			// 订阅核心状态：连接状态/错误/常驻数量变化时重渲染工具条。
			useCoreVersion();
			const [menuOpen, setMenuOpen] = react.useState(false);
			useMenuDismiss(menuOpen, setMenuOpen);
			/** 宿主能力（可用 shell 列表等）；页签里用于渲染 shell 下拉。 */
			const [info, setInfo] = react.useState(null);
			const containerRef = react.useRef(null);
			const visible = props?.visible !== false;

			// 拉取宿主信息：/info 里的 shells 是宿主探测到的可用 shell 目录。
			react.useEffect(() => {
				let alive = true;
				(async () => {
					const meta = await fetchInfo(activeKey);
					if (alive) setInfo(meta);
				})();
				return () => {
					alive = false;
				};
			}, [activeKey]);

			// 挂进页签容器；原生关闭钩子负责结束 PTY，临时卸载只摘下 DOM。
			if (props?.scope?.sessionId) nativeSessionKeys.set(props.scope.sessionId, activeKey);
			react.useEffect(() => {
				const container = containerRef.current;
				if (container === null) return;
				const s = core.attach(activeKey, container);
				if (s !== null) s.notify = flash;
				raf(() => core.refit(activeKey));
				return () => {
					if (s !== null) s.notify = null;
					core.detach(activeKey);
				};
			}, [activeKey, flash]);

			// 页签重新可见时重算行列数并聚焦。
			react.useEffect(() => {
				if (!visible) return;
				raf(() => {
					core.refit(activeKey);
					core.focus(activeKey);
				});
			}, [visible, activeKey]);

			const act = core.session(activeKey);
			const state = act !== null ? act.status : "wait";
			const error = act !== null ? act.error : "";
			const shownCwd = labelOf(activeKey);
			const count = core.size();
			const clipboard = settings.clipboard;

			return h(
				"div",
				{
					className: "dsh-term-embed",
					"data-dsh-terminal-embed": "1",
					"data-theme": settings.theme,
					onPointerMove: trackPointer
				},
				renderToolbar({
					compact: true,
					status: state,
					statusTitle: error,
					shownCwd,
					count,
					shells: info !== null && Array.isArray(info.shells) ? info.shells : [],
					shellId: getShellChoice(activeKey) || info?.detectedShell?.id || "",
					detectedShell: info?.detectedShell,
					onShell: (id) => {
						setShellChoice(activeKey, id);
						core.reconnect(activeKey);
					},
					menuOpen,
					mode: MODE_DOCK,
					theme: settings.theme,
					onTheme: toggleTheme,
					onMenu: () => setMenuOpen((v) => !v),
					onClear: () => core.clear(activeKey),
					onReconnect: () => core.reconnect(activeKey),
					onLayout: () => {},
					onCollapse: () => {}
				}),
				menuOpen
					? renderMenu({
							clipboard,
							onToggle: (key) => patchClipboard({ [key]: clipboard[key] !== true }),
							onToastPos: (pos) => patchClipboard({ toastPos: pos })
						})
					: null,
				renderBody({ containerRef, clipboard, toast, toastAt, error })
			);
		}
		//#endregion

		//#region 插件入口
		/** 需要的客户端服务：槽注册表（页签模式下 better-sidebar 缺失也能正常加载）。 */
		const inject = ["slots"];

		/**
		 * 注册为 better-sidebar 的侧栏页签。
		 *
		 * 只走公开的 `ctx.betterSidebar.registerTab(descriptor)` 扩展点，
		 * 不修改 better-sidebar 本体；页签关闭时回收对应工作区的 PTY。
		 * @param ctx - 客户端上下文（可能是 better-sidebar 注入后的子上下文）。
		 * @param api - better-sidebar 服务。
		 * @returns 无返回值。
		 */
		const nativeSessionKeys = new Map();

		function applySidebarTab(ctx, api) {
			// 原生右侧栏的 × 不经过 better-sidebar 的 descriptor.onClose。
			if (typeof ctx.inject === "function") {
				ctx.inject(["sidebarRight"], (injected) => {
					const right = injected.get("sidebarRight");
					if (typeof right?.registerCloseHandler !== "function") return;
					injected.effect(() => right.registerCloseHandler(TAB_TYPE, (sessionId) => {
						const key = nativeSessionKeys.get(sessionId);
						if (key !== undefined) core.dispose(key);
						nativeSessionKeys.delete(sessionId);
					}));
				});
			}
			let disposeRegistration = null;
			try {
				disposeRegistration = api.registerTab({
					id: TAB_TYPE,
					title: "终端",
					description: "常驻 PTY 终端：PTY 跑在独立进程里，模型流式输出时按键回显不受宿主事件循环影响",
					icon: (size) => {
						const s = typeof size === "number" ? size : 16;
						return h(
							"svg",
							{
								width: s,
								height: s,
								viewBox: "0 0 16 16",
								fill: "none",
								stroke: "currentColor",
								"stroke-width": 1.4,
								"stroke-linecap": "round",
								"stroke-linejoin": "round"
							},
							h("path", { d: "M2.5 3.8 6.8 8l-4.3 4.2" }),
							h("path", { d: "M8.6 12.2h4.9" })
						);
					},
					order: 45,
					// 同一会话只保留一个终端页签（重复打开时聚焦已有页签）。
					single: true,
					component: (tabProps) => h(TerminalTab, tabProps),
					onClose: (tab, scope) => {
						// 页签被关闭 → 结束该工作区的常驻 shell（后端随之回收 PTY）。
						core.dispose(keyForScope(scope, tab));
					}
				});
				integration.set("tab");
			} catch (error) {
				console.error("[dsh-terminal] 注册 better-sidebar 页签失败，回退到浮层面板：", error);
				mountOverlay(ctx);
				return;
			}
			if (typeof ctx.effect === "function" && typeof disposeRegistration === "function") {
				ctx.effect(() => () => {
					try {
						disposeRegistration();
					} catch (error) {
						console.error("[dsh-terminal] 注销 better-sidebar 页签失败：", error);
					}
					integration.set("overlay");
				});
			}
		}

		/**
		 * 挂载原来的独立浮层面板（root 作用域的 `shell.overlay` 列表槽）。
		 *
		 * 用 `slots.inject()` 而不是直接 register，是因为目标槽的声明可能由
		 * ui-layout 稍后激活或被替换；inject 会在槽存在时再执行注册，并在槽
		 * 重新声明后自动重放。
		 * @param ctx - 客户端根上下文。
		 * @returns 无返回值。
		 */
		function mountOverlay(ctx) {
			if (ctx.slots === undefined || ctx.slots === null || typeof ctx.slots.inject !== "function") {
				console.error("[dsh-terminal] 当前客户端没有 slots 服务，无法挂载独立终端面板。");
				return;
			}
			ctx.slots.inject("shell.overlay", function* () {
				try {
					yield ctx.slots.register({ name: "shell.overlay", id: "terminal", order: 100 }, TerminalPanel);
				} catch (error) {
					console.error("[dsh-terminal] 注册 shell.overlay 槽失败：", error);
				}
			});
		}

		/**
		 * 客户端插件主体：
		 * - 装了 dsh-better-sidebar → 注册成它的侧栏页签（不挂浮层）；
		 * - 没装 → 保持原来的独立浮层面板，行为完全不变。
		 *
		 * 不把 `betterSidebar` 写死进 exports.inject：否则没装 better-sidebar 的
		 * 环境会一直等这个服务、连浮层面板都加载不出来。这里用 ctx.get 探测，
		 * 并用 ctx.inject 兜住「better-sidebar 稍后才激活」的顺序问题。
		 * @param ctx - 客户端根上下文。
		 * @returns 无返回值。
		 */
		function apply(ctx) {
			try {
				ensureStyle();
			} catch (error) {
				console.error("[dsh-terminal] 注入样式失败：", error);
			}

			// 主题切换同步到所有常驻终端；插件卸载时回收全部 PTY 会话。
			subscribeSettings((next) => core.applyTheme(themeOf(next.theme)));
			if (typeof ctx.effect === "function") {
				ctx.effect(() => () => core.disposeAll());
			}

			const existing = typeof ctx.get === "function" ? ctx.get(BETTER_SIDEBAR_SERVICE) : undefined;
			if (existing !== undefined && existing !== null && typeof existing.registerTab === "function") {
				applySidebarTab(ctx, existing);
				return;
			}

			mountOverlay(ctx);

			// better-sidebar 晚于本插件激活时：再切到页签形态，浮层自动隐藏。
			if (typeof ctx.inject === "function") {
				ctx.inject([BETTER_SIDEBAR_SERVICE], (injected) => {
					const api =
						(typeof injected.get === "function" ? injected.get(BETTER_SIDEBAR_SERVICE) : undefined) ??
						injected[BETTER_SIDEBAR_SERVICE];
					if (api === undefined || api === null || typeof api.registerTab !== "function") return;
					applySidebarTab(injected, api);
				});
			}
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
