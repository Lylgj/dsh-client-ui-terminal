//#region lib/index.js
/**
 * 终端面板插件 —— 宿主半边（node half）。
 *
 * 这个包是「双面包」(dual-face package)：宿主半边只负责把同源的终端后端挂到
 * DSH 的 webServer 上，浏览器半边通过 package.json 的 `dsh.client` 声明经
 * `exports["./client"]` 自动发现并投递到页面。
 *
 * 宿主半边提供三类路由（全部同源，无需额外进程或端口）：
 *   - GET /dsh-terminal/assets/<file>  xterm.js / addon-fit.js / xterm.css 静态资源
 *   - GET /dsh-terminal/info          能力与默认值（供前端探测是否可用）
 *   - WS  /dsh-terminal/ws            PTY WebSocket 桥（node-pty <-> ws）
 *
 * 之所以把后端放进宿主而不是另外起一个服务，是因为 webServer 的路由与升级
 * 通道天然同源、随 dsh web 一起启停、并且可以由 ctx.effect 精确回收。
 */
import { spawn } from "node-pty";
import { WebSocketServer } from "ws";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

/** 路由前缀，集中一处便于修改。 */
const PREFIX = "/dsh-terminal";
/**
 * 资源路由前缀。注意 webServer 的 prefix 语义是「无尾斜杠」：匹配时会自行补
 * 一个 "/" 再比较（`pathname.startsWith(prefix + "/")`），带上尾斜杠反而永远
 * 匹配不上，会被 SPA 回退吞掉。
 */
const ASSET_PREFIX = `${PREFIX}/assets`;
const WS_PATH = `${PREFIX}/ws`;
const INFO_PATH = `${PREFIX}/info`;

/** 需要的宿主服务：webServer 提供路由与升级注册。 */
const inject = ["webServer"];

/** 资源根目录（本包内的 assets/）。 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = join(HERE, "..", "assets");

/** 扩展名到 content-type 的映射。 */
const MIME = {
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".map": "application/json; charset=utf-8",
};

/** 同时只允许一个终端面板实例连接（避免误开多个 shell）。 */
/**
 * 当前存活的 PTY 会话集合。
 *
 * 每个工作区保留一个常驻 shell，因此这里可以同时存在多个会话；只有连接关闭、
 * 进程退出或插件卸载时才回收，切换工作区不会影响其它工作区的 shell。
 */
const sessions = new Set();
/** 同时存活的 PTY 上限，防止异常情况下无限堆积。 */
const MAX_SESSIONS = 12;

/**
 * 从环境变量解析默认工作目录：优先 DSH_TERMINAL_CWD，其次宿主进程 cwd
 * （dsh web 的 cwd 即用户启动它的目录，通常就是项目根）。
 * @returns 绝对路径形式的默认工作目录。
 */
function defaultCwd() {
	return process.env.DSH_TERMINAL_CWD ?? process.cwd();
}

/**
 * 解析前端请求的工作目录（通常是当前会话的工作区）：必须是真实存在的目录，
 * 否则回退到默认目录，避免工作区被删除/移动后 PTY 直接启动失败。
 * @param requested - 前端通过 ?cwd= 传入的路径，可能为空或非法。
 * @returns 可直接交给 pty.spawn 的目录路径。
 */
function resolveCwd(requested) {
	if (typeof requested !== "string" || requested === "") return defaultCwd();
	try {
		return statSync(requested).isDirectory() ? requested : defaultCwd();
	} catch {
		return defaultCwd();
	}
}

/**
 * 解析终端使用的 shell 可执行文件。
 * @returns shell 的绝对路径或命令名。
 */
function defaultShell() {
	return process.env.SHELL ?? "/bin/bash";
}

/**
 * 把静态资源读出来响应；路径做规范化以防目录穿越。
 * @param name - assets/ 下的相对文件名。
 * @param res - HTTP 响应对象。
 * @returns 无返回值；始终结束响应。
 */
async function serveAsset(name, res) {
	// 只接受单层文件名，拒绝任何分隔符或上跳，避免穿越 assets 目录。
	if (name.includes("/") || name.includes("\\") || name.includes("..")) {
		res.writeHead(404);
		res.end();
		return;
	}
	const full = normalize(join(ASSET_ROOT, name));
	if (!full.startsWith(ASSET_ROOT)) {
		res.writeHead(404);
		res.end();
		return;
	}
	const ext = name.slice(name.lastIndexOf("."));
	try {
		const body = await readFile(full);
		res.writeHead(200, {
			"content-type": MIME[ext] ?? "application/octet-stream",
			"cache-control": "no-cache",
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}

/**
 * 插件主体：注册静态资源路由、信息路由，以及 PTY 的 WebSocket 升级路由。
 * @param ctx - 宿主插件上下文（携带 webServer）。
 */
function apply(ctx) {
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "prefix",
				path: ASSET_PREFIX,
				handler: (req, res) => {
					const pathname = new URL(req.url ?? "/", "http://x").pathname;
					// 前缀之后的部分去掉前导斜杠，得到 assets/ 下的相对文件名。
					const rel = decodeURIComponent(pathname.slice(ASSET_PREFIX.length)).replace(/^\/+/, "");
					return serveAsset(rel, res);
				},
			}),
		"dsh-client-ui-terminal: assets",
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "exact",
				path: INFO_PATH,
				handler: (req, res) => {
					res.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-cache",
					});
					res.end(JSON.stringify({ shell: defaultShell(), cwd: defaultCwd(), busy: sessions.size > 0 }));
				},
			}),
		"dsh-client-ui-terminal: info",
	);

	/** 每条 WS 连接对应一个 PTY；连接关闭时一并回收。 */
	const wss = new WebSocketServer({ noServer: true });

	ctx.effect(
		() =>
			ctx.webServer.registerUpgrade({
				path: WS_PATH,
				handler: (req, socket, head) => {
					wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
				},
			}),
		"dsh-client-ui-terminal: pty websocket",
	);

	wss.on("connection", (ws, req) => {
		// 每个工作区一个常驻 PTY：这里刻意不顶掉既有连接，
		// 否则切换工作区会杀掉另一个工作区仍在运行的 shell。
		if (sessions.size >= MAX_SESSIONS) {
			ws.send(JSON.stringify({ t: "e", d: `终端数量已达上限（${MAX_SESSIONS}），请先关闭部分工作区的终端。` }));
			ws.close();
			return;
		}

		// 允许前端通过查询参数覆盖工作目录与尺寸。
		const url = new URL(req.url ?? "/", "http://x");
		const cols = Number(url.searchParams.get("cols") ?? 80) || 80;
		const rows = Number(url.searchParams.get("rows") ?? 24) || 24;
		const cwd = resolveCwd(url.searchParams.get("cwd"));

		let pty;
		try {
			pty = spawn(defaultShell(), ["-l"], {
				name: "xterm-256color",
				cols,
				rows,
				cwd,
				env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", DSH_TERMINAL: "1" },
			});
		} catch (error) {
			ws.send(JSON.stringify({ t: "e", d: `无法启动 shell: ${String(error?.message ?? error)}` }));
			ws.close();
			return;
		}

		/** 本条连接对应的会话记录，供退出/关闭时精确回收。 */
		const session = { ws, pty, cwd };
		sessions.add(session);

		// PTY -> 浏览器：原始文本直通。
		pty.onData((data) => {
			if (ws.readyState === ws.OPEN) ws.send(data);
		});
		pty.onExit(({ exitCode }) => {
			sessions.delete(session);
			if (ws.readyState === ws.OPEN) {
				ws.send(`\r\n\x1b[2m[进程已退出，退出码 ${exitCode}]\x1b[0m\r\n`);
				ws.close();
			}
		});

		// 浏览器 -> PTY：JSON 控制帧 {t:'i'} 输入 / {t:'r'} 尺寸。
		ws.on("message", (raw) => {
			let msg;
			try {
				msg = JSON.parse(String(raw));
			} catch {
				return;
			}
			if (msg.t === "i") pty.write(msg.d);
			else if (msg.t === "r") {
				const c = Math.max(2, Number(msg.c) || 80);
				const r = Math.max(1, Number(msg.r) || 24);
				try {
					pty.resize(c, r);
				} catch {
					/* 尺寸竞争时 pty 可能已退出，忽略。 */
				}
			}
		});

		ws.on("close", () => {
			sessions.delete(session);
			try {
				pty.kill();
			} catch {
				/* 已经退出。 */
			}
		});
	});

	ctx.effect(
		() => () => {
			for (const s of sessions) {
				try {
					s.pty.kill();
				} catch {
					/* 已经退出。 */
				}
			}
			sessions.clear();
			wss.close();
		},
		"dsh-client-ui-terminal: close pty server",
	);
}
//#endregion
export { apply, inject };
