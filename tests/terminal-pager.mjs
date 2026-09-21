/**
 * 真机集成测试：验证面板终端里的**分页器行为**。
 *
 * 背景：DSH 的 bash 工具会给它启动的 shell 注入 `PAGER=cat` / `GIT_PAGER=cat`
 * （避免 agent 的非交互命令卡在分页器里）。插件进程若从那种 shell 启动，这两个
 * 变量会一路继承到面板终端，`git log` 之类就被整段刷出来、完全不进分页器。
 * 宿主两半边都用 `ptyEnv()` 把它们归一化掉，本测试守住这个行为。
 *
 * 前置条件：
 *   1. 终端后端可达（默认独立终端进程 127.0.0.1:3110，或同源 /dsh-terminal/ws）；
 *   2. 能解析到 ws 模块（仓库 `npm i -D ws`，或本机 dsh 安装目录里有）。
 *
 * 环境变量：
 *   DSH_TERM_PAGER_WS  直接指定 WebSocket 地址（默认 ws://127.0.0.1:3110/ws）
 *   DSH_TERM_ORIGIN    dsh web 地址，默认 http://127.0.0.1:3080（用于同源回退）
 *   DSH_TERM_WS_BASE   含 ws 模块的目录（用于解析 ws）
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const ORIGIN = process.env.DSH_TERM_ORIGIN ?? "http://127.0.0.1:3080";
const HELPER_PORT = process.env.DSH_TERMINAL_PORT ?? "3110";
const ORIGIN_WS = ORIGIN.replace(/^http/, "ws") + "/dsh-terminal/ws";
const CANDIDATES = [
	process.env.DSH_TERM_PAGER_WS ?? `ws://127.0.0.1:${HELPER_PORT}/ws`,
	ORIGIN_WS
].filter((x) => typeof x === "string" && x !== "");

/**
 * 解析 ws 模块：先试本仓库，再试环境变量指定的目录，最后试全局 dsh 安装目录。
 * @returns WebSocket 构造器。
 */
function loadWs() {
	const tries = [import.meta.url];
	if (process.env.DSH_TERM_WS_BASE) tries.push(join(process.env.DSH_TERM_WS_BASE, "noop.js"));
	try {
		const root = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		if (root !== "") tries.push(join(root, "@deepseek-ai", "dsh", "noop.js"));
	} catch {
		/* 没有 npm 就跳过。 */
	}
	for (const base of tries) {
		try {
			return createRequire(base)("ws");
		} catch {
			/* 换下一个。 */
		}
	}
	throw new Error("找不到 ws 模块：请在仓库执行 npm i -D ws，或设 DSH_TERM_WS_BASE 指向含 ws 的目录");
}

const WebSocket = loadWs();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 去掉 ANSI 转义与回车，便于文本断言。 */
const strip = (s) =>
	s
		.replace(/\x1b\][^\x07]*\x07/g, "")
		.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
		.replace(/\r/g, "");

let pass = 0;
let fail = 0;
/**
 * 断言并打印结果。
 * @param name - 断言名。
 * @param cond - 条件。
 * @param extra - 失败时的补充信息。
 * @returns 无返回值。
 */
function check(name, cond, extra = "") {
	if (cond) {
		pass++;
		console.log(`  ✅ ${name}`);
	} else {
		fail++;
		console.log(`  ❌ ${name}${extra === "" ? "" : `  ← ${extra}`}`);
	}
}

/**
 * 连上终端后端（依次尝试候选地址）。
 * @returns 已打开的 WebSocket，或 null。
 */
async function connect() {
	for (const base of CANDIDATES) {
		const url = `${base}?cols=100&rows=30&cwd=${encodeURIComponent(process.cwd())}`;
		const ws = await new Promise((resolve) => {
			const sock = new WebSocket(url);
			const done = (ok) => resolve(ok ? sock : null);
			sock.on("open", () => done(true));
			sock.on("error", () => done(false));
			setTimeout(() => done(false), 4000);
		});
		if (ws !== null) {
			console.log(`  已连接: ${base}`);
			return ws;
		}
	}
	return null;
}

const ws = await connect();
if (ws === null) {
	console.log(`  ❌ 无法连接终端后端（试过: ${CANDIDATES.join(" / ")}）`);
	console.log("     请确认 dsh web 在跑、插件已加载；或设 DSH_TERM_PAGER_WS 指定地址");
	process.exit(1);
}

let buf = "";
ws.on("message", (d) => {
	buf += d.toString();
});

await sleep(800);

// 1) PTY 环境：不应残留 cat 版 pager，且 less 带 F/R/X/K 参数
buf = "";
ws.send(JSON.stringify({ t: "i", d: 'printf "ENVCHECK:%s|%s|%s\\n" "$PAGER" "$GIT_PAGER" "$LESS"\n' }));
await sleep(1200);
const envLine = strip(buf)
	.split("\n")
	.find((l) => l.startsWith("ENVCHECK:"));
const [pager, gitPager, less] = (envLine ?? "ENVCHECK:||").slice("ENVCHECK:".length).split("|");
check("PTY 里没有 PAGER=cat", pager !== "cat", `PAGER=${pager}`);
check("PTY 里没有 GIT_PAGER=cat", gitPager !== "cat", `GIT_PAGER=${gitPager}`);
check("LESS 含 K（Ctrl+C 退出分页器）与 F（一屏不打扰）", /K/.test(less ?? "") && /F/.test(less ?? ""), `LESS=${less}`);

// 2) 长输出进入分页器，而不是整段打印
buf = "";
ws.send(JSON.stringify({ t: "i", d: "seq 1 500 | less\n" }));
await sleep(2500);
const first = strip(buf).trimEnd();
const atPrompt = /[$#]\s*$/.test(first);
const lines = first.split("\n").length;
check("长输出停在分页器里（未回到 shell 提示符）", !atPrompt, `末尾: ${JSON.stringify(first.slice(-60))}`);
check("首屏只显示一屏内容（≤ 45 行）", lines <= 45, `实际 ${lines} 行`);

// 3) Enter 翻行
buf = "";
ws.send(JSON.stringify({ t: "i", d: "\r" }));
await sleep(700);
check("按 Enter 有响应", buf.length > 0, `${buf.length} 字节`);

// 4) Ctrl+C 退出分页器
buf = "";
ws.send(JSON.stringify({ t: "i", d: "\u0003" }));
await sleep(800);
buf = "";
ws.send(JSON.stringify({ t: "i", d: "echo PAGER_CTRLC_OK\n" }));
await sleep(1200);
check("Ctrl+C 退出分页器并回到 shell", buf.includes("PAGER_CTRLC_OK"), JSON.stringify(strip(buf).slice(-80)));

// 5) q 也能退出
buf = "";
ws.send(JSON.stringify({ t: "i", d: "seq 1 500 | less\n" }));
await sleep(2000);
ws.send(JSON.stringify({ t: "i", d: "q" }));
await sleep(800);
buf = "";
ws.send(JSON.stringify({ t: "i", d: "echo PAGER_QUIT_OK\n" }));
await sleep(1200);
check("按 q 也能退出分页器", buf.includes("PAGER_QUIT_OK"), JSON.stringify(strip(buf).slice(-80)));

ws.close();
console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
