/**
 * 真机集成测试：连上正在运行的 dsh web，同时开两条不同工作区的 PTY 连接，
 * 验证互不顶掉、各自 cd 状态独立、断开后不泄漏 shell。
 *
 * 前置条件：
 *   1. dsh web 已启动（默认 http://127.0.0.1:3080），且已加载本插件；
 *   2. 能解析到 ws 模块（仓库里 `npm i -D ws`，或本机 dsh 安装目录里有）。
 *
 * 环境变量：
 *   DSH_TERM_ORIGIN   dsh web 地址，默认 http://127.0.0.1:3080
 *   DSH_TERM_WS_A/_B  两个工作区目录，默认在系统临时目录下各建一个
 *   DSH_TERM_WS_BASE  含 ws 模块的目录（用于解析 ws）
 *
 * 注意：本脚本依赖 Linux 的 ss / ps 来数宿主的 shell 进程。
 */
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGIN = process.env.DSH_TERM_ORIGIN ?? "http://127.0.0.1:3080";
const PORT = new URL(ORIGIN).port !== "" ? new URL(ORIGIN).port : "80";
const BASE = ORIGIN.replace(/^http/, "ws") + "/dsh-terminal/ws";

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
	} catch { /* 没有 npm 就跳过 */ }
	for (const base of tries) {
		try { return createRequire(base)("ws"); } catch { /* 换下一个 */ }
	}
	throw new Error("找不到 ws 模块：请在仓库执行 npm i -D ws，或设 DSH_TERM_WS_BASE 指向含 ws 的目录");
}
const WebSocket = loadWs();

// 两个真实存在的工作区目录（默认临时建，避免依赖本机路径）
const A = process.env.DSH_TERM_WS_A ?? mkdtempSync(join(tmpdir(), "dsh-term-a-"));
const B = process.env.DSH_TERM_WS_B ?? mkdtempSync(join(tmpdir(), "dsh-term-b-"));

/**
 * 统计宿主当前托管的 PTY shell 数量。
 * 先用 ss 取监听端口的 dsh web 进程 pid（避免 pgrep 自匹配），再数它的 shell 子进程。
 * @param shell - shell 可执行文件绝对路径（取自 /info）。
 * @returns shell 进程数；探测失败返回 -1。
 */
function hostPtyCount(shell) {
	try {
		const listen = execSync(`ss -H -ltnp 'sport = :${PORT}'`, { encoding: "utf8" });
		const m = listen.match(/pid=(\d+)/);
		if (m === null) return -1;
		const ps = execSync("ps -eo ppid,args", { encoding: "utf8" });
		return ps.split("\n").filter((l) => l.startsWith(`${m[1]} `) && l.includes(`${shell} -l`)).length;
	} catch {
		return -1;
	}
}

/**
 * 打开一条终端连接。
 * @param cwd - 工作区目录。
 * @param tag - 日志标签。
 * @returns 连接与输出收集器。
 */
function open(cwd, tag) {
	const ws = new WebSocket(`${BASE}?cols=100&rows=30&cwd=${encodeURIComponent(cwd)}`);
	const buf = { s: "" };
	ws.on("message", (d) => { buf.s += d.toString(); });
	ws.on("close", (code, reason) => console.log(`  [${tag}] 连接关闭 code=${code} reason=${reason.toString()}`));
	return new Promise((resolve) => ws.on("open", () => resolve({ ws, buf, tag })));
}

/**
 * 在连接里执行命令并取回输出。
 * @param c - 连接对象。
 * @param cmd - 命令。
 * @returns 输出文本。
 */
function run(c, cmd) {
	c.buf.s = "";
	c.ws.send(JSON.stringify({ t: "i", d: `${cmd}\n` }));
	return new Promise((resolve) => {
		const t = setInterval(() => {
			if (c.buf.s.includes("__END__")) {
				clearInterval(t);
				const m = c.buf.s.match(/__S__\r?\n([\s\S]*?)\r?\n__END__/);
				resolve(m !== null ? m[1].trim() : c.buf.s.trim());
			}
		}, 60);
		setTimeout(() => { clearInterval(t); resolve(c.buf.s.trim()); }, 6000);
	});
}

let pass = 0, fail = 0;
const check = (n, cond, extra = "") => {
	if (cond) { pass++; console.log(`  ✅ ${n}`); }
	else { fail++; console.log(`  ❌ ${n}  ${extra}`); }
};

const info0 = await (await fetch(`${ORIGIN}/dsh-terminal/info`)).json();
const SHELL = info0.shell;
console.log(`宿主 shell=${SHELL}，工作区 A=${A}，B=${B}`);

// 基线：此刻宿主上已有的常驻 shell（用户自己开的终端也在这里面，不能假设为 0）
const count0 = hostPtyCount(SHELL);

console.log("建立两条不同工作区的终端连接…");
const a = await open(A, "A");
const b = await open(B, "B");
await new Promise((r) => setTimeout(r, 400));

const count1 = hostPtyCount(SHELL);
check("两条连接各开了一个 PTY（互不顶掉）", count1 === count0 + 2, `基线 ${count0} → 现在 ${count1}`);
check("连接 A 仍处于 OPEN（未被 B 顶掉）", a.ws.readyState === WebSocket.OPEN, `readyState=${a.ws.readyState}`);
check("连接 B 仍处于 OPEN", b.ws.readyState === WebSocket.OPEN, `readyState=${b.ws.readyState}`);

const outA = await run(a, "echo __S__; pwd; echo __END__");
const outB = await run(b, "echo __S__; pwd; echo __END__");
console.log(`  A 目录: ${outA}`);
console.log(`  B 目录: ${outB}`);
check("A 落在自己的工作区", outA === A, outA);
check("B 落在自己的工作区", outB === B, outB);

// 互相独立：在 A 里 cd，不影响 B
await run(a, "cd /tmp");
const outB2 = await run(b, "echo __S__; pwd; echo __END__");
check("在 A 里 cd 后 B 的目录不受影响", outB2 === B, outB2);
const outA2 = await run(a, "echo __S__; pwd; echo __END__");
check("A 自己保留了自己的 cd 状态（独立 shell）", outA2 === "/tmp", outA2);

// 关闭 A，B 必须存活
a.ws.close();
await new Promise((r) => setTimeout(r, 500));
check("关闭 A 后 B 仍 OPEN", b.ws.readyState === WebSocket.OPEN, `readyState=${b.ws.readyState}`);
const outB3 = await run(b, "echo __S__; pwd; echo __END__");
check("关闭 A 后 B 仍可执行命令", outB3 === B, outB3);

b.ws.close();
await new Promise((r) => setTimeout(r, 600));
const info2 = await (await fetch(`${ORIGIN}/dsh-terminal/info`)).json();
const count2 = hostPtyCount(SHELL);
// 只有本测试开的两条断开了；用户自己在页面上开着的常驻终端仍在，所以要和基线比，不能断言 0
check("测试的两条连接断开后，宿主 PTY 数回到基线（无泄漏）", count2 === count0, `基线 ${count0} → 现在 ${count2}`);
check("busy 与基线一致", info2.busy === (count0 > 0), JSON.stringify(info2));

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
