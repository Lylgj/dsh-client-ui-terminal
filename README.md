# dsh-client-ui-terminal

给 **DSH（DeepSeek Harness）Web 界面**加一个**右侧常驻终端面板**：直接在 `http://127.0.0.1:3080` 的页面上敲 shell 命令，不用切到外部终端窗口。

**每个工作区各留一个真正常驻的 PTY** —— 切到别的会话再切回来，shell 不会被重建，滚动缓冲也不丢。

> 这是一个**第三方本地插件**，不走 npm 分发。用法是把本仓库放进 DSH profile 的 `node_modules/`，再在 profile 的 `cordis.patch.yml` 里加一条 `insert` 条目。
> 包名沿用 `@deepseek-ai/dsh-client-ui-terminal` 只是为了让安装路径与本机既有安装保持一致；它**不是** DeepSeek 官方包。`package.json` 里已设 `private: true`，防止误发布到 npm。

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 页内终端 | 面板固定在浏览器视口右侧，和 DSH 会话在同一个页面里 |
| 每个工作区一个常驻 shell | 以会话的 `cwd` 为键；切换会话不重建、不顶掉别的 shell |
| 两种布局 | **并排**（DSH 让出右侧空间，互不遮挡）/ **浮层**（终端盖在页面上方） |
| 明暗主题 | 浅色（白底深字）/ 暗色（Catppuccin Mocha 系），切换不重建 shell |
| 宽度可调 | 左侧边缘可拖动，280 ~ 1100 px |
| 无 CDN、无新端口、无新进程 | xterm 资源由 DSH 自己的 webServer 同源下发；后端挂在既有 webServer 上 |
| 刷新即升级 | 浏览器半边按内容哈希取包，改完 JS 刷新页面即可 |

---

## 界面说明

```
┌──────────┬──────────────────────────────┬───────────────────────────────────────┐
│          │                              │ ● 终端  ~/test/td380  ②  [并排][浅色]   │ ← 状态点/标题/工作区/常驻数/工具条
│  会话列表 │        DSH 会话正文           │                        [清屏][重连][收起]│
│          │                              ├───────────────────────────────────────┤
│          │                              │ $ ls -l                               │
│          │                              │ total 8                               │
│          │                              │ $ █                                   │
└──────────┴──────────────────────────────┴───────────────────────────────────────┘
                                           ↑ 拖动面板左边缘可调宽度
```

工具条按钮（**按钮文案显示的是「当前状态」，点一下切到另一个**）：

| 按钮 | 当前状态 | 点击后 |
| --- | --- | --- |
| `并排` / `浮层` | `并排` = DSH 让出右侧空间；`浮层` = 终端盖在页面上 | 在两种布局间切换 |
| `浅色` / `暗色` | 当前终端配色 | 切换明暗主题 |
| `清屏` | —— | 清空**当前工作区**终端的屏幕与滚动缓冲（不影响 shell 状态） |
| `重连` | —— | 重新连接**当前工作区**的 PTY |
| `收起` | —— | 折叠面板 |

其它交互：

- **Ctrl + \`**（macOS 也可 **Cmd + \`**）：展开 / 收起面板，全局生效（捕获阶段监听，在终端里按也有效，且不会把反引号送进 shell）。
- 面板折叠后，视口右侧会留一个带状态点的悬浮按钮「终端」，点它或按快捷键都能展开。**折叠不会杀掉 shell**，滚动缓冲同样保留。
- 标题左侧的状态点：`连接中` / `已连接` / `出错`。
- 标题右侧的 `②` 徽标表示当前已常驻的终端数量（只有多于 1 个时才显示）。
- 断开后每 3 秒自动重连。

---

## 安装

### 前置条件

- 已安装 DSH，`dsh web` 能正常跑起来（默认地址 `http://127.0.0.1:3080`）。
- Node.js ≥ 20（本插件在 Node 24 上验证通过）。
- Linux（宿主半边依赖 `node-pty`，需要本机能编译原生模块；Windows 未验证）。
- 知道你的 profile 目录，默认是 `~/.dsh/profiles/web`。

### 步骤

```bash
# 1) 把仓库克隆到 profile 的 node_modules 下（目录名要与包名一致）
PROFILE=~/.dsh/profiles/web
mkdir -p "$PROFILE/node_modules/@deepseek-ai"
git clone https://github.com/Lylgj/dsh-client-ui-terminal.git \
  "$PROFILE/node_modules/@deepseek-ai/dsh-client-ui-terminal"
```

```bash
# 2) 在 profile 的 cordis.patch.yml 末尾追加下面这段
#    文件不存在就新建；已存在就直接追加（顶层是 YAML 数组）
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'YAML'

# DSH Web 右侧常驻终端面板（宿主半边）
- insert:
    - id: ui-terminal
      name: './node_modules/@deepseek-ai/dsh-client-ui-terminal/lib/index.js?rev=1'
YAML
```

```bash
# 3) 让配置生效
#    cordis.patch.yml 受 Cordis HMR 监视，保存后通常立即生效；
#    若没生效（例如首次新增条目），重启一次 dsh web 即可。
```

```bash
# 4) 验证：应返回一段 JSON
curl -s http://127.0.0.1:3080/dsh-terminal/info
# {"shell":"/bin/bash","cwd":"...","busy":false}
```

最后**刷新浏览器页面**（http://127.0.0.1:3080），右侧就会出现终端面板。

### 关于依赖

**通常不需要单独装依赖。** DSH 自身就依赖 `node-pty` 与 `ws`，插件里的这两个裸导入会由 DSH 的模块回退机制解析到 DSH 安装目录，所以只放一个插件目录就能跑（本机实测 profile 的 `node_modules` 里只有插件本身，没有 `node-pty`/`ws`）。

只有当你的 DSH 环境里确实找不到这两个模块（表现为面板报「无法启动 shell」）时，才在**插件目录内**补装：

```bash
cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-terminal
npm install --omit=dev
```

### ⚠️ 不要在 profile 根目录装依赖

**不要**在 `~/.dsh/profiles/web/` 下执行 `pnpm install`、`npm install`，也不要执行 `dsh plugin add / remove`。

本插件是「手工放进 `node_modules`」的，并未写进 profile 的 `package.json` 依赖。包管理器会把这种未声明的目录判定为 **extraneous 并直接删除**，等于把终端功能删掉。（`dsh web` 启动本身不跑包管理器，所以正常启动是安全的。）

---

## 配置：`cordis.patch.yml` 里那条 `insert` 是什么意思

`cordis.patch.yml` 是 profile 的「用户 patch 层」，在 profile 的所有 bundle 层之后应用，顶层是一个 loader patch 条目数组。上面那条 `insert` 就是往插件列表里插入一个条目：

- `id: ui-terminal`：条目标识。
- `name:` **刻意用的是相对路径 + `?rev=N`**，而不是裸包名。原因是 cordis loader 以「解析后的 URL」作为模块导入的缓存键：裸包名永远解析到同一个 URL，改了代码也不会重新导入；带上 `rev` 查询串就能得到一个新 URL，从而在**不重启 `dsh web`** 的前提下热加载宿主半边的新代码。改完宿主代码把 `rev` 加一保存即可。

（浏览器半边不需要这样：它的 URL 自带内容哈希，刷新页面就是最新的。）

---

## 使用

### 每个工作区一个常驻终端

面板显示的是**当前会话所在工作区**的终端。工作区路径取自会话记录里的 `cwd`：

- 切到另一个工作区的会话 → 面板换成那个工作区的终端，**前一个 shell 继续在后台跑**（滚动缓冲保留）。
- 切回来 → 直接复用原 shell，**不会重建**，`cd` 状态、正在跑的命令、屏幕内容都还在。
- 标题右侧的徽标显示当前一共常驻了几个终端。
- 还没有工作区的会话（例如新建会话页）会归到同一个「`(默认目录)`」终端：此时连接不带 `cwd` 参数，由宿主决定起始目录（一般是 `dsh web` 进程的工作目录）。

### 面板布局：并排 / 浮层

- **并排**（默认）：面板用 `position: fixed` 贴在视口右缘，同时给 DSH 的框架设 `margin-right = 面板宽度`，让框架自己重排三栏 —— 所以终端不遮挡会话内容，右侧的详情栏也不会错位。
- **浮层**：面板盖在页面上方，DSH 布局完全不动。适合临时看一眼、或窗口很窄时。
- 默认布局记在 `localStorage`，下次打开沿用。

### 明暗主题

点 `浅色` / `暗色` 切换。只改 xterm 的配色，**不会重建 shell**，也就不会中断正在跑的命令。选择同样记在 `localStorage`。

### 面板宽度

把鼠标移到面板左边缘（出现拖动条）拖动即可，范围 280 ~ 1100 px，松手后宽度写入 `localStorage`。

> 并排模式下如果窗口本身很窄（`窗口宽度 − 面板宽度 < 1024px`），DSH 会自动把左侧栏收成 56px 的窄条 —— 这是 DSH 自己的窄屏策略。想避免：把面板拖窄一点、把窗口拉宽，或者切到「浮层」。

### 调试入口

页面控制台里有 `window.__DSH_TERMINAL__`：

```js
__DSH_TERMINAL__.sessions()       // 当前已常驻终端的工作区路径列表
__DSH_TERMINAL__.mode()           // 'dock' | 'overlay'
__DSH_TERMINAL__.theme()          // 'light' | 'dark'
__DSH_TERMINAL__.frameMargin()    // 当前给 DSH 框架让出的右边距（px）
__DSH_TERMINAL__.toggleLayout()   // 切换布局
__DSH_TERMINAL__.toggleTheme()    // 切换主题
__DSH_TERMINAL__.open()           // 展开
__DSH_TERMINAL__.close()          // 收起（不杀 shell）
```

### 重置为默认设置

```js
["width", "open", "mode", "theme"].forEach((k) => localStorage.removeItem("dsh.terminal." + k));
```

`localStorage` 键：`dsh.terminal.width`、`dsh.terminal.open`、`dsh.terminal.mode`、`dsh.terminal.theme`。设置按「浏览器 + origin」保存，换浏览器需要重设。

---

## 接口

全部挂在 DSH 既有的 webServer 上（同源、随 `dsh web` 启停、不额外占端口）。

### `GET /dsh-terminal/info`

前端启动时用它探测能力与默认值：

```json
{ "shell": "/bin/bash", "cwd": "/home/me/work", "busy": false }
```

### `GET /dsh-terminal/assets/<file>`

同源下发内置资源：`xterm.js`、`xterm.css`、`addon-fit.js`。只接受 `assets/` 下的**单层文件名**（含 `/`、`\`、`..` 一律 404），再经 `normalize` + 前缀校验二次兜底，防止目录穿越；未知扩展名按 `application/octet-stream` 返回。响应带 `cache-control: no-cache`。

### `WS /dsh-terminal/ws?cols=80&rows=24&cwd=<urlencode 工作区绝对路径>`

- 查询参数：`cols` / `rows` 初始尺寸，`cwd` 终端起始目录。
- **浏览器 → 宿主**（JSON 控制帧）：
  - `{"t":"i","d":"ls -l\r"}` —— 键盘输入，`d` 原样写进 PTY。
  - `{"t":"r","c":100,"r":30}` —— 终端尺寸变化。
- **宿主 → 浏览器**：
  - PTY 输出**原始文本直通**（不是 JSON，直接写进 xterm）。
  - `{"t":"e","d":"..."}` —— 错误（例如超过会话上限、shell 启动失败）。
  - 进程退出时先发一行灰色提示，再关闭连接。
- 连接关闭即回收对应 shell 进程。

---

## 工作原理

- **双面包（dual-face plugin）**：`package.json` 里 `main` 指向宿主半边 `lib/index.js`，`dsh.client` 声明 + `exports["./client"]` 指向浏览器半边 `lib/client.js`，DSH 会自动把它投递到页面（URL 形如 `/plugins/<id>/client.js?rev=<内容哈希>`）。
- **宿主半边**用 `ctx.webServer.register(...)` 挂 HTTP 路由、`registerUpgrade(...)` 挂 WebSocket 升级通道，用 `node-pty` 起真实 shell，把 PTY 与 `ws` 双向桥接；所有资源随 `ctx.effect` 精确回收。
- **浏览器半边不是 ESM**：DSH 的浏览器插件走 `window.__ModuleLoader__.load({ id, factory: (require) => ... })`，`react` / `react-dom` 由宿主注入，所以插件自身零打包、零 CDN 依赖。
- **槽位**：面板注册在 root 作用域的 `shell.overlay` 列表槽里，因此**每个会话**（包括新建会话页）都会渲染它。
- **并排为什么能互不遮挡**：DSH 的 AppFrame 自带 `overflow: hidden` 且没有固定宽度，所以面板用 `react-dom` 的 `createPortal` 挂到 `document.body`（脱离裁剪），再给框架设 `margin-right`；框架内部用 `ResizeObserver` 感知到自己变窄，会自行重排三栏，因此终端与「详情栏拖拽把手」都不会错位。

---

## 已知限制与注意事项

1. **终端是浏览器态的**：刷新页面会重建 PTY，滚动缓冲与正在跑的前台命令会丢。折叠面板**不会**（只是隐藏）。需要跨刷新持久化，请自己在 shell 里挂 `tmux` / `dtach`。
2. **常驻上限 12 个 PTY**（跨工作区合计）。超过时新连接会收到错误帧，需要先关掉一些工作区的终端。
3. **并排模式下的窄屏折叠**：见上文「面板宽度」。
4. **无鉴权**：`/dsh-terminal/*` 没有任何登录校验（与 DSH 本地 GUI 其余部分一致，只监听回环地址）。**不要**把 `dsh web` 暴露到公网或不可信网络。
5. **每一次连接就是一个真实 shell 进程**，权限与启动 `dsh web` 的用户相同。
6. **只显示当前工作区的终端**：其它工作区的 shell 在后台常驻但不显示（没有多标签页 UI）。
7. **`dsh web` 退出时所有 shell 一起回收**。
8. 宿主半边的代码改动需要把 `cordis.patch.yml` 里的 `?rev=N` 加一（或重启 `dsh web`）；只改浏览器半边刷新页面即可。

---

## 开发与测试

仓库自带两套测试：

```bash
# 1) 行为回归：用最小 DOM/React 桩驱动真实的 lib/client.js
#    覆盖「切工作区不关旧 WS、切回不重建、隐藏仍收数据、主题切换不重建」等
#    不需要 dsh 在跑
npm test

# 2) 真机集成：连上正在运行的 dsh web，真的开两个 PTY，
#    验证互不顶掉、各自 cd 独立、断开后无 shell 泄漏
#    前置：dsh web 在跑；ws 模块可解析（npm i -D ws 即可）
npm run test:pty
```

可用的环境变量：`DSH_TERM_HOST`、`DSH_TERM_ORIGIN`、`DSH_TERM_WS_A`、`DSH_TERM_WS_B`、`DSH_TERM_WS_BASE`。

改动生效方式：

| 改了什么 | 怎么生效 |
| --- | --- |
| `lib/client.js`、`assets/*` | 刷新页面（浏览器半边 URL 带内容哈希，无需清缓存） |
| `lib/index.js`（宿主半边） | 把 `cordis.patch.yml` 里的 `?rev=N` 加一保存（HMR），或重启 `dsh web` |
| `package.json` 的 `dsh.client` 声明 | 重启 `dsh web` |

---

## 卸载

```bash
# 1) 从 cordis.patch.yml 里删掉那条 ui-terminal 的 insert
# 2) 删除插件目录
rm -rf ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-terminal
# 3) 刷新页面（或重启 dsh web）
```

---

## 许可

本仓库自有代码以 **MIT** 许可发布，见 [LICENSE](LICENSE)。

`assets/` 下内置了 xterm.js 与 addon-fit 的官方构建产物（MIT），版权归上游作者，
逐字节来源与哈希见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
