# dsh-client-ui-terminal

给 **DSH（DeepSeek Harness）** 加一个**终端面板**：直接在 DSH 页面里敲 shell 命令，不用切到外部终端窗口。

- 默认是页面右侧的**常驻终端面板**；装了 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 时自动变成它的**侧栏「终端」页签**。
- **每个工作区一个常驻 PTY**：切走再切回，shell 不重建，`cd` 状态、正在跑的命令、滚动缓冲都还在。
- 是**真终端**（`node-pty`）：支持 `less` 分页、Ctrl+C 中断、SSH 密码输入等交互。

> 第三方插件，非 DeepSeek 官方包。包名沿用 `@deepseek-ai/…` 只为与既有安装路径一致，`package.json` 已设 `private: true`，未发布到 npm。

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 每个工作区一个常驻 shell | 以会话的 `cwd` 为键；切换会话不重建、不顶掉别的 shell；折叠面板也不杀 shell |
| 环境自动识别 | Windows 本地用 `cmd`，WSL 工作区用对应发行版 `bash`，`.remote-ssh.json` 远程工作区直接 `ssh`，macOS/Linux 用登录 shell |
| 手动选 shell | 下拉可切换：Windows 的 cmd / PowerShell / pwsh、各 WSL 发行版、`~/.ssh/config` 里的主机；选择按工作区记住 |
| 真终端行为 | `git log` 等长输出自动进 `less`（Enter 翻行、空格翻页、q / Ctrl+C 退出），不会被强制整段刷屏 |
| 复制/粘贴可配 | Ctrl+C 复制、选中即复制、右键粘贴三个独立开关，提示气泡位置可选，设置持久化 |
| 两种形态 | 独立面板（并排 / 浮层）或 better-sidebar 侧栏页签，同一套终端核心 |
| 主题与布局 | 浅色 / 暗色切换不重建 shell；并排/浮层、面板宽度（280–1100px）都记住 |
| 后台终端管理 | 标题右侧徽标显示本环境的终端数，点开可单独关闭或「关闭其他终端」 |
| 按环境限流 | 每个环境最多 10 个终端（本机、各 WSL 发行版、各 SSH 主机分别计数） |
| 桌面端可用 | 自动使用 DSH 桌面端注入的宿主地址（`__DSH_TRANSPORT__.streamBaseUrl`） |
| 无 CDN | xterm 等静态资源由 DSH 自己的 webServer 同源下发 |

---

## 安装

### 前置条件

- DSH `0.2.2-rc.1` 或更新（桌面端或 `dsh web`）。
- Node.js ≥ 20（在 Node 24 上验证）。
- 本包未发布到 npm，从**本地目录**安装（先把仓库放到任意位置）。
- `node-pty`/`ws` 由安装命令装进 profile。Windows 用 npm 版 `node-pty` 自带的 conpty；Linux/macOS 需要本机能编译原生模块（或命中预编译包）。

### 方式一：标准安装（推荐）

```bash
# 先彻底退出 DSH 桌面端（dsh web 则停掉进程）
# profile 名：桌面端 desktop，dsh web 默认 web
dsh plugin --profile desktop add file:D:/lgj/dsh-client-ui-terminal

# 完成后重开 DSH，刷新页面
```

这条命令会自动完成三件事：

1. 用 pnpm 把本包装进 profile（写入 `dependencies`）；
2. 因为 `package.json` 声明了 `dsh.bundle`，插件管理器把它加入 `dsh.profile.bundles`；
3. 加载时应用包内 `cordis.patch.yml`，自动插入插件行。

**不需要手改 profile 的任何文件。**

### 方式二：离线手工安装

无网络，或 `node-pty` 装不上时使用（仓库开发时就是这种方式）：

```bash
# 1) 复制仓库到 profile 的 node_modules 下（目录名必须与包名一致）
PROFILE=~/.dsh/profiles/web     # 桌面端是 ~/.dsh/profiles/desktop
mkdir -p "$PROFILE/node_modules/@deepseek-ai"
git clone https://github.com/Lylgj/dsh-client-ui-terminal.git \
  "$PROFILE/node_modules/@deepseek-ai/dsh-client-ui-terminal"
```

2. 给插件补 `node-pty`（DSH 不会替插件解析它）。Windows 从 DSH 安装目录复制到
   `<插件目录>\node_modules\node-pty`：
   - JS：`DeepSeek Harness\resources\app.asar` 里的 `dsh/node_modules/node-pty/`
   - 原生 conpty：`...\resources\app.asar.unpacked\dsh\node_modules\node-pty\`
     （`build/Release/conpty`、`prebuilds/win32-x64`）

3. 在 `<profile>/cordis.patch.yml` 末尾追加（内容同 [examples/cordis.patch.yml](examples/cordis.patch.yml)）：

```yaml
- insert:
    - id: ui-terminal
      name: './node_modules/@deepseek-ai/dsh-client-ui-terminal/lib/index.js'
```

4. **完全退出并重开** DSH。

> 两种方式二选一。之前手工装过、现在改方式一时，先删掉手工那条 `ui-terminal`，否则同一 id 插入两次会冲突。
> `name` 里**不要带 `?rev=N`**：DSH 0.2.2 的 loader 把它当成文件名的一部分，会报 `ERR_MODULE_NOT_FOUND`。

### 验证

```bash
# 端口以本次启动的 GUI 地址为准
curl -s http://127.0.0.1:<端口>/dsh-terminal/info
```

返回 200 + 一段 JSON 即正常。页面刷新后：装了 better-sidebar 是侧栏「终端」页签，没装是右侧面板。

> 加载失败时 GUI 不会报错（只写宿主日志）。排查：打开插件管理，把 `ui-terminal` 先禁用再启用，
> 返回值里会带诊断（常见：路径写错、`?rev=N` 残留、缺 `node-pty`）。

---

## 使用

### 常驻终端

- 面板显示**当前会话工作区**的终端；切到其他会话，当前 shell 继续在后台跑。
- 切回来直接复用原 shell，不重建。
- 还没有工作区的会话（如新建会话页）归到同一个默认目录终端。

### 自动识别环境与手动切换 shell

工具条显示当前环境自动识别出的终端。可手动切换的选项：

| 选项 | 来源 |
| --- | --- |
| `Windows：cmd` | 固定项，起 `cmd.exe` |
| `Windows：PowerShell` | PATH 里探测到才列出 |
| `Windows：pwsh` | PATH 里探测到才列出（PowerShell 7） |
| `WSL：<发行版>` | `wsl.exe -l -q` 列出的发行版；Windows 路径自动转成 `/mnt/d/...` 并 `--cd` 进去 |
| `SSH：<主机>` | `~/.ssh/config` 的 `Host` 行（忽略通配符和 `!` 否定项），以 `ssh -tt <主机>` 启动 |

- 选择按工作区保存在 `localStorage`（键 `dsh.terminal.shells`），切回时沿用。
- 切换 shell 会重连该工作区的 PTY：原 shell 结束，屏幕历史保留，新 shell 从新提示符开始。
- 选择只作为 `?shell=` 参数发给宿主，宿主用白名单映射成固定命令，不会执行任意命令。
- SSH 主机没配密钥时，终端里会提示输密码，直接输入即可（不会回显）。
- 用 `.remote-ssh.json` 标记的远程工作区走 DSH 远程工作区同一套密钥，无需手输密码。

### 两种形态

**独立面板**（没装 better-sidebar 时）：

- 并排（默认）：面板贴在视口右缘，DSH 框架让出对应宽度，互不遮挡。
- 浮层：面板盖在页面上方，DSH 布局不动。
- 左侧边缘拖动可调宽度（280–1100px）。
- `Ctrl + \``（macOS `Cmd + \``）全局开合面板；折叠不会杀 shell。
- 工具条按钮含义（按钮显示当前状态，点一下切换）：`并排`/`浮层`、`浅色`/`暗色`、`复制`（打开设置菜单）、`清屏`、`重连`、`收起`。

**better-sidebar 页签**：侧栏的开合、宽度、位置、主题由 better-sidebar 管理；一个会话只有一个终端页签，关闭页签会回收该工作区 shell，终端核心行为不变。装/卸 better-sidebar 后刷新页面即可在两种形态间切换。

### 后台终端

标题右侧的徽标显示**当前环境**的终端数，点开是「后台终端」列表：可以单独关闭某个终端，或「关闭其他终端」（保留当前）。其它环境的 shell 仍在后台常驻，切到对应环境的终端就能看到。

### 重置设置

```js
// 浏览器控制台
["width", "open", "mode", "theme", "clipboard", "shells"]
  .forEach((k) => localStorage.removeItem("dsh.terminal." + k));
```

设置按「浏览器 + origin」保存。`localStorage` 键：`dsh.terminal.width` / `.open` / `.mode` / `.theme` / `.clipboard` / `.shells`。

调试入口（控制台）：`__DSH_TERMINAL__.sessions()`、`.mode()`、`.theme()`、`.toggleLayout()`、`.toggleTheme()`、`.open()`、`.close()`、`.reconnect()`、`.clear()`。

---

## 工作原理

- **双面包（dual-face）**：`package.json` 的 `main` 是宿主半边 `lib/index.js`；`dsh.client` 声明 + `exports["./client"]` 是浏览器半边 `lib/client.js`，由 DSH 自动投递到页面（URL 带内容哈希，刷新即最新）。
- **宿主半边**用 `ctx.webServer.register(...)` 挂 HTTP 路由、`registerUpgrade(...)` 挂 WebSocket，用 `node-pty` 起真实 shell 并双向桥接。
- **浏览器半边**不是 ESM：走 `window.__ModuleLoader__.load({ id, factory })`，`react`/`react-dom` 由宿主注入，零打包。
- **桌面端**页面运行在 `dsh-app://app`（Electron 自定义协议）下，所以浏览器半边用宿主注入的 `__DSH_TRANSPORT__.streamBaseUrl` 拼 WebSocket 地址，而不是 `location.host`。
- **独立终端进程**（`lib/helper.js`）：`dsh web` 只有一条事件循环，流式输出/落盘会让按键回显卡顿（实测最坏数秒无回显）。该进程默认监听 `127.0.0.1:3110`，浏览器优先直连、连不上自动回退宿主同源路由；**仅 Linux/macOS 启用**（Windows 直接走宿主同源 PTY，功能完整，只是少这层隔离）。

---

## 接口

终端静态资源、`/info` 与同源 PTY 通道都挂在 DSH 既有 webServer 上；独立进程另有自己的 `127.0.0.1:3110`。

### `GET /dsh-terminal/info`

```json
{
  "shell": "C:\\Windows\\System32\\cmd.exe",
  "env": "local",
  "shells": [
    { "id": "cmd", "label": "Windows：cmd", "kind": "local" },
    { "id": "powershell", "label": "Windows：PowerShell", "kind": "local" },
    { "id": "wsl:Ubuntu", "label": "WSL：Ubuntu", "kind": "wsl" },
    { "id": "ssh:my-server", "label": "SSH：my-server", "kind": "ssh" }
  ],
  "detectedShell": { "id": "cmd", "label": "Windows：cmd", "kind": "local" },
  "cwd": "D:\\work\\project",
  "busy": false,
  "helper": { "host": "127.0.0.1", "port": 3110, "alive": false, "version": null }
}
```

`?cwd=` 传入工作区目录时，返回该工作区自动识别的 `shell` / `env` / `detectedShell`。

### `GET /dsh-terminal/assets/<file>`

同源下发 `xterm.js`、`xterm.css`、`addon-fit.js`、`addon-webgl.js`。只接受 `assets/` 下的单层文件名，未知扩展名按 `application/octet-stream` 返回。

### `WS /dsh-terminal/ws?...`

查询参数：`cols` / `rows`（初始尺寸）、`cwd`（起始目录）、`shell`（可选 shell id）。

| 方向 | 数据 |
| --- | --- |
| 浏览器 → 后端 | `{"t":"i","d":"ls -l\r"}` 键盘输入；`{"t":"r","c":100,"r":30}` 尺寸变化 |
| 后端 → 浏览器 | PTY 输出原始文本直通；`{"t":"s","env":"wsl:Ubuntu","kind":"wsl"}` 连接建立后的环境帧；`{"t":"e","d":"..."}` 错误帧 |

连接关闭即回收对应 shell 进程。

### 独立进程（`127.0.0.1:3110`）

`GET /healthz`（存活+版本）、`GET /info`（shell/会话数）、`GET /shutdown`（退出）。

---

## 已知限制

1. **刷新页面会重建 PTY**，滚动缓冲与前台命令会丢（折叠面板不会）。需要跨刷新持久化请自己挂 `tmux` / `dtach`。
2. **每个环境最多 10 个终端**，超过时新连接收到错误提示，先关掉该环境的旧终端。
3. **无鉴权**：`/dsh-terminal/*` 不做登录校验（与 DSH 本地 GUI 其余部分一致），只应监听回环地址，**不要**暴露到公网。
4. **右下角粘贴需要安全上下文**：`navigator.clipboard.readText()` 只在 `localhost`/HTTPS 可用；普通 IP + HTTP 下请用 Ctrl+V。
5. **Ctrl+C 复制只在有选中内容时生效**（没选中时仍是 `^C` 中断）。
6. **环境变量改动要重连终端才生效**（PTY 环境在连接建立时确定）。
7. **Windows 下没有独立进程隔离**：默认走宿主同源 PTY。需要尝试隔离时设 `DSH_TERMINAL_HELPER=1`，并自行保证 `node-pty`/`ws` 可解析。
8. **better-sidebar 形态**下没有浮层专属的全局 `Ctrl + \``、宽度拖拽与折叠按钮（由侧栏 UI 负责）。

---

## 开发与测试

仓库自带三套测试：

```bash
npm test                # 行为回归（最小 DOM/React 桩驱动真实 lib/client.js，无需 DSH）
npm run test:sidebar    # better-sidebar 接入回归（stub 服务，无需 DSH）
npm run test:pty        # 真机：连运行中的 dsh web，验证常驻/互不顶掉/无 shell 泄漏
npm run test:pager      # 真机：分页器行为（PAGER 清洗、less 翻页/退出）
```

`test:pty` / `test:pager` 需要 DSH 在运行且终端后端可达（默认 `127.0.0.1:3110`）。

环境变量：`DSH_TERM_HOST`、`DSH_TERM_ORIGIN`、`DSH_TERM_WS_BASE`、`DSH_TERMINAL_PORT`、`DSH_TERMINAL_KEEP_PAGER`。

改动生效方式：

| 改了什么 | 怎么生效 |
| --- | --- |
| `lib/client.js`、`assets/*` | 刷新页面（URL 带内容哈希） |
| `lib/helper.js`（独立进程） | 重启该进程或改版本号让宿主自动替换，无需重启 DSH |
| `lib/index.js`（宿主半边） | 重启 DSH |
| `package.json` 的 `dsh.client` / `dsh.bundle` | 重启 DSH |

---

## 卸载

```bash
# 方式一（标准安装）
dsh plugin --profile desktop remove @deepseek-ai/dsh-client-ui-terminal

# 方式二（手工安装）：删掉 profile cordis.patch.yml 里的 ui-terminal insert，
# 再删除插件目录
rm -rf ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-terminal
```

完成后重开 DSH / 刷新页面。卸载不影响 better-sidebar 与 DSH 内置终端，只是少了一个终端入口。

---

## 许可

本仓库自有代码以 **MIT** 发布，见 [LICENSE](LICENSE)。
`assets/` 下是 xterm.js 与 addon-fit 的官方构建产物（MIT），来源与哈希见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
