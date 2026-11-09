# dsh-client-ui-terminal

给 **DSH（DeepSeek Harness）Web 界面**加一个**右侧常驻终端面板**：直接在 `http://127.0.0.1:3080` 的页面上敲 shell 命令，不用切到外部终端窗口。

**每个工作区各留一个真正常驻的 PTY** —— 切到别的会话再切回来，shell 不会被重建，滚动缓冲也不丢。

> 这是一个**第三方本地插件**，不走 npm 分发。用法是把本仓库放进 DSH profile 的 `node_modules/`，再在 profile 的 `cordis.patch.yml` 里加一条 `insert` 条目。
> 包名沿用 `@deepseek-ai/dsh-client-ui-terminal` 只是为了让安装路径与本机既有安装保持一致；它**不是** DeepSeek 官方包。`package.json` 里已设 `private: true`，防止误发布到 npm。

> **可选接入 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)**：profile 里装了它时，本插件会把终端注册成它的**侧栏页签**（不再额外浮一个面板）；没装就保持下面描述的独立面板形态。两种安装方式共用同一套终端核心，不需要改代码，也不修改 better-sidebar 本体。

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 页内终端 | 面板固定在浏览器视口右侧，和 DSH 会话在同一个页面里 |
| 每个工作区一个常驻 shell | 以会话的 `cwd` 为键；切换会话不重建、不顶掉别的 shell |
| 两种布局 | **并排**（DSH 让出右侧空间，互不遮挡）/ **浮层**（终端盖在页面上方） |
| 明暗主题 | 浅色（白底深字）/ 暗色（Catppuccin Mocha 系），切换不重建 shell |
| 多 shell 选择 | 按工作区自动识别环境：Windows 本地打开 cmd，WSL 打开对应发行版 bash，远程工作区通过 SSH 打开远端终端；下拉显示识别结果，也可手动切换 |
| 宽度可调 | 左侧边缘可拖动，280 ~ 1100 px |
| 无 CDN、无新端口、无新进程 | xterm 资源由 DSH 自己的 webServer 同源下发；后端挂在既有 webServer 上 |
| 复制/粘贴可配 | **Ctrl+C 复制**、**选中即复制**、**右键粘贴** 三个独立开关，可任意组合，选择持久化 |
| 真终端行为 | `git log` 等长输出自动进 `less`：Enter 翻行、空格翻页、**Ctrl+C 或 q 退出**（不会被强制整段打印） |
| 可接入 better-sidebar | 装了它时以**侧栏页签**出现（只走其公开的 `registerTab` API，不修改它本体）；没装则保持独立面板 |
| 刷新即升级 | 浏览器半边按内容哈希取包，改完 JS 刷新页面即可 |

---

## 界面说明

```
┌──────────┬──────────────────────────────┬───────────────────────────────────────┐
│          │                              │ ● 终端  ~/test/td380  ② [并排][浅色][复制]│ ← 状态点/标题/工作区/常驻数/工具条
│  会话列表 │        DSH 会话正文           │                     [清屏][重连][收起] │
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
| `复制` | 复制/粘贴设置菜单是否展开 | 展开/收起下方那排开关 |
| `清屏` | —— | 清空**当前工作区**终端的屏幕与滚动缓冲（不影响 shell 状态） |
| `重连` | —— | 重新连接**当前工作区**的 PTY |
| `收起` | —— | 折叠面板 |

### 复制、粘贴与提示（都可选）

点工具条的 `复制` 展开设置条。复制/粘贴是三个**互相独立、可同时打开**的开关，再加上提示气泡的位置五选一；全部记在 `localStorage["dsh.terminal.clipboard"]`：

| 开关 | 默认 | 行为 |
| --- | --- | --- |
| `Ctrl+C 复制` | **开** | 有选中内容时 `Ctrl+C`（macOS 上 `Cmd+C`）复制选中文本；**没有选中时仍然是 `^C`**，中断命令的能力不受影响。`Ctrl+Shift+C`、`Ctrl+Alt+C` 一律不拦截 |
| `右键粘贴` | **开** | 在终端里点右键直接粘贴剪贴板内容（不再弹浏览器菜单），内容经 xterm 的 `paste()` 写入，所以括号粘贴模式与多行处理跟正常粘贴一致 |
| `选中即复制` | 关 | 鼠标松开、选择停稳 **150 ms** 后自动复制。默认关闭，避免"看到什么就复制什么"污染剪贴板 |

| 提示位置 | 说明 |
| --- | --- |
| `底部居中`（默认） | 面板底部中央 |
| `底部靠左` | 面板左下角，不挡输入行右侧 |
| `顶部居中` | 工具条正下方 |
| `跟随鼠标` | 出现在指针右上方（`position:fixed`，贴右边缘时会自动收进来），不遮挡刚选中的内容 |
| `关闭提示` | 复制/粘贴后不弹任何提示 |

提示文案形如「已复制 12 个字符」/「已粘贴 24 个字符」，失败时说明原因（例如剪贴板权限被拒），所以不会出现"到底复制上没有"的疑问。

### 长输出分页（less）

`git log`、`journalctl`、`man` 这类长输出会正常进入分页器（`less`）：**从头开始显示**，`Enter` 往下翻一行、`空格` 翻一页、`q` 或 **`Ctrl+C`** 退出。

这里有一个容易踩的坑：**DSH 的 bash 工具会给它启动的 shell 注入 `PAGER=cat` / `GIT_PAGER=cat`**（避免 agent 的非交互命令卡在分页器里）。如果插件进程恰好是从那种 shell 启动的（例如手动从 DSH 的终端里拉起独立终端进程），这两个变量会一路继承到面板终端 —— 症状就是 `git log` 把 8000 多行直接刷完、完全不给你翻页的机会。

所以宿主两半边都会在起 PTY 前做一次环境归一化：

| 变量 | 处理 |
| --- | --- |
| `PAGER` / `GIT_PAGER` | 值为 `cat` 时**丢弃**（这是 agent 工具链的约定，不该带进真终端）；其他值原样保留 |
| `LESS` | 未设置时给 `FRXK`：`F` 一屏放得下就直接输出、`R` 保留颜色、`X` 不用备用屏（退出后内容留在回滚缓冲）、**`K` 让 `Ctrl+C` 直接退出分页器** |
| `TERM` / `COLORTERM` | 固定为 `xterm-256color` / `truecolor` |

想保留继承来的原值（比如你就喜欢 `PAGER=cat` 的整段输出）：设 `DSH_TERMINAL_KEEP_PAGER=1` 再启动 dsh。

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
- Linux、macOS 或 Windows。宿主半边依赖 `node-pty`：Linux/macOS 需要本机能编译原生模块；Windows 走 DSH 自带的 `node-pty`（conpty），默认用 `cmd.exe` 起 shell（可用 `DSH_TERMINAL_SHELL` 覆盖）。
- **独立终端进程**（`lib/helper.js`，提供按键回显隔离）默认只在 Linux/macOS 启动；Windows 下自动跳过、回退到宿主同源 PTY 路由（功能完整，只是失去那层隔离）。
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
      name: './node_modules/@deepseek-ai/dsh-client-ui-terminal/lib/index.js'
YAML
```

```bash
# 3) 让配置生效
#    cordis.patch.yml 受 Cordis HMR 监视，保存后通常立即生效；
#    若没生效（例如首次新增条目），重启一次 dsh web 即可。
```

> **注意：`name` 里不要带 `?rev=N`。** DSH 0.2.2 起 loader 按字面 URL 导入插件入口，
> 查询串会被当成文件名的一部分，报 `ERR_MODULE_NOT_FOUND`（`.../lib/index.js?rev=1` 找不到）。
> 旧版 DSH 可以靠 `?rev=N` 制造新 URL 来热加载宿主半边，0.2.2 不再适用——宿主半边的改动
> 需要重启 DSH（`dsh web` 重起进程；桌面端退出重开）。

```bash
# 4) 验证：应返回一段 JSON
curl -s http://127.0.0.1:3080/dsh-terminal/info
# {"shell":"/bin/bash","cwd":"...","busy":false}
```

最后**刷新浏览器页面**（http://127.0.0.1:3080），右侧就会出现终端面板。

### 在 DSH 桌面端（Electron）安装

桌面端的 profile 目录不同，而且启动方式没有 `dsh web` 的控制台：

- Windows：`%USERPROFILE%\.dsh\profiles\desktop`
- macOS：`~/.dsh/profiles/desktop`
- Linux：`~/.dsh/profiles/desktop`

把仓库复制到 `<profile>\node_modules\@deepseek-ai\dsh-client-ui-terminal`，在 `<profile>\cordis.patch.yml` 里追加与上面相同的 `insert`（Windows 路径同样用正斜杠即可），然后**完全退出并重开 DSH 桌面端**。

桌面端插件加载失败时页面不会报错（错误只写宿主日志，GUI 里看不到）。排查方法：在 DeepSeek Harness 里打开插件管理，把 `ui-terminal` 先禁用再启用——失败时返回值里会带具体的导入错误（例如 `ERR_MODULE_NOT_FOUND`）。

### 可选：接入 dsh-better-sidebar

profile 里已经装了 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 时，本插件会自动把终端注册成**它的侧栏页签**，不需要改任何代码 —— **不要**修改 better-sidebar 的包内容，只动 profile 的 `cordis.patch.yml`。

加载顺序建议：把本插件那条 `ui-terminal` 的 `insert` 放在 better-sidebar 的 `insert` **之后**（同一文件里顺序越靠后越晚加载）。插件在 `apply` 里用 `ctx.get('betterSidebar')` 探测；若服务还没就绪，它也会在服务出现时自动切到页签形态，所以顺序不是硬性要求。

验证与回退：

- 刷新页面后右侧栏出现「终端」页签 → 接入成功；此时不会再出现独立浮层面板。
- 删掉 `ui-terminal` 的 `insert` 并刷新 → 回到独立浮层面板形态（终端仍然能用）。
- 卸载 better-sidebar 并刷新 → 同理自动回到浮层形态，本插件不受影响。

### 关于依赖

**通常不需要单独装依赖。** `node-pty` 与 `ws` 在 DSH 的安装树里都有，DSH 的安装依赖解析会尽量把它们提供给 profile 里的插件。不过桌面端（Electron + `app.asar`）的模块解析更严格：本机在 DSH 0.2.2-rc.1 上实测，插件要能解析到 `node-pty` 才会加载，所以桌面端的安装副本里自带了 `node_modules/node-pty`（从 DSH 自带的那份复制，含 conpty 原生文件）。若你的环境里面板报「无法启动 shell」或插件加载失败，在**插件目录内**补装/复制一份即可：

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
- `name:` 用**相对路径**而不是裸包名。相对路径在 profile 作用域里解析到插件入口（`package.json` 的 `main`），路径里**不要带查询串**：DSH 0.2.2 的 loader 会把 `?rev=N` 当成文件名的一部分，报 `ERR_MODULE_NOT_FOUND`。（旧版 DSH 的 loader 以解析后的 URL 作为缓存键，可以用 `?rev=N` 制造新 URL 来热加载；0.2.2 起不再适用，宿主半边的改动需要重启 DSH。）

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

### 自动识别环境与选择 shell

工具条按工作区自动识别环境，并显示对应的实际终端名称，不再提供「默认 shell」选项。Windows 本地路径使用 cmd，WSL 路径使用对应发行版 bash，`.remote-ssh.json` 远程工作区使用 SSH；Linux/macOS 使用登录 shell。仍可手动切换以下终端：

| 选项 | 来源 |
| --- | --- |
| Windows：cmd | 固定项（Windows），起 `cmd.exe` |
| Windows：PowerShell | PATH 里探测到 `powershell.exe` 才列出 |
| Windows：pwsh | PATH 里探测到 `pwsh.exe` 才列出（PowerShell 7） |
| WSL：`<发行版>` | `wsl.exe -l -q` 列出的已注册发行版；Windows 路径会自动转成 `/mnt/d/...` 并 `--cd` 进去 |
| SSH：`<主机>` | 解析 `~/.ssh/config` 的 `Host` 行（跳过通配符与 `!` 否定项），以 `ssh -tt <主机>` 启动 |

选择结果按工作区记在 `localStorage` 的 `dsh.terminal.shells`（JSON：会话键 → shell id），切回该工作区时沿用；
切换 shell 会重连该工作区的宿主 PTY（原来的 shell 被结束，屏幕上的历史输出保留，新 shell 从新提示符开始）。
选中项只会作为 `?shell=` 参数发给宿主，宿主用白名单映射成固定命令，不会执行任意命令。

> SSH 主机若在 `~/.ssh/config` 里没有配密钥，会在终端里提示输密码 —— 直接在里面输入即可（PTY 是真实的，密码不会回显）。
> 用 `.remote-ssh.json` 标记的远程工作区走 DSH 远程工作区同一套密钥，不需要手动输密码。

### 面板宽度

把鼠标移到面板左边缘（出现拖动条）拖动即可，范围 280 ~ 1100 px，松手后宽度写入 `localStorage`。

> 并排模式下如果窗口本身很窄（`窗口宽度 − 面板宽度 < 1024px`），DSH 会自动把左侧栏收成 56px 的窄条 —— 这是 DSH 自己的窄屏策略。想避免：把面板拖窄一点、把窗口拉宽，或者切到「浮层」。

### 接入 dsh-better-sidebar 时的形态

profile 里装了 better-sidebar 时，终端以它的**侧栏页签**出现（标题「终端」，图标 `>_`）：

- 侧栏的开合、宽度、位置、主题都由 better-sidebar 管理：本插件不再用 `position:fixed` 浮层、不再全局劫持 `Ctrl + \``，避免和侧栏自己的快捷键打架。
- 一个会话只有一个终端页签（重复打开会聚焦已有页签）；页签被关闭时回收该工作区的 shell。
- 终端核心完全不变：每个工作区一个常驻 PTY，切换会话、切走再切回页签都不会重建。
- 想在「侧栏页签」与「独立浮层」两种形态之间切换：装 / 卸载 better-sidebar 即可，无需改代码，`Ctrl+R` 刷新页面后生效。

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

静态资源、信息路由与同源 PTY 通道挂在 DSH 既有的 webServer 上；**终端数据面**则由独立终端进程提供（默认 `127.0.0.1:3110`，见上文「终端为什么跑在独立进程里」）。

### `GET /dsh-terminal/info`（宿主半边，同源）

前端启动时用它探测能力与默认值：

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
  "cwd": "D:\\work\\project",
  "busy": false,
  "helper": { "host": "127.0.0.1", "port": 3110, "alive": false, "version": null }
}
```

`GET /info?cwd=...` 返回该工作区自动识别的 `shell`、`env` 与 `detectedShell`；`env` 是该工作区的默认环境（`local` / `wsl:<发行版>` / `ssh:<主机>`），前端据此只展示同一环境的后台终端。`shells` 是可选终端目录（`id` 用作 WS 查询参数，`kind` 用于展示）。不指定 `shell` 参数时按工作区环境自动选择。

### `GET /dsh-terminal/assets/<file>`

同源下发内置资源：`xterm.js`、`xterm.css`、`addon-fit.js`、`addon-webgl.js`。只接受 `assets/` 下的**单层文件名**（含 `/`、`\`、`..` 一律 404），再经 `normalize` + 前缀校验二次兜底，防止目录穿越；未知扩展名按 `application/octet-stream` 返回。响应带 `cache-control: no-cache`。

### `WS /dsh-terminal/ws?...`（宿主半边）与 `WS /ws?...`（独立进程）

两者**协议完全相同**，浏览器半边优先连独立进程，失败才回退同源路由：

- 查询参数：`cols` / `rows` 初始尺寸，`cwd` 终端起始目录，`shell` 可选 shell id（先取 `/info` 的 `shells`，未知 id 回退默认；WSL/SSH 会忽略本地 `cwd`，由宿主换算目标目录）。
- **浏览器 → 后端**（JSON 控制帧）：
  - `{"t":"i","d":"ls -l\r"}` —— 键盘输入，`d` 原样写进 PTY。
  - `{"t":"r","c":100,"r":30}` —— 终端尺寸变化。
- **后端 → 浏览器**：
  - PTY 输出**原始文本直通**（不是 JSON，直接写进 xterm）；独立进程会自适应合批。
  - `{"t":"s","env":"wsl:Ubuntu","kind":"wsl"}` —— 连接建立后的第一个控制帧，告知本会话所属环境（`local` / `wsl:<发行版>` / `ssh:<主机>`）；前端据此只展示同一环境的「后台终端」。
  - `{"t":"e","d":"..."}` —— 错误（例如当前环境终端数量已达上限、shell 启动失败）。
  - 进程退出时先发一行灰色提示，再关闭连接。
- 连接关闭即回收对应 shell 进程。

### 独立终端进程自身的 HTTP 接口（`127.0.0.1:3110`）

| 路由 | 用途 |
| --- | --- |
| `GET /healthz` | 存活 + 版本探测，宿主用它决定复用还是替换实例 |
| `GET /info` | 同上，附带 shell、cwd、当前会话数 |
| `GET /shutdown` | 请求退出（仅监听回环地址；宿主替换旧版本实例时调用） |

---

## 工作原理

- **双面包（dual-face plugin）**：`package.json` 里 `main` 指向宿主半边 `lib/index.js`，`dsh.client` 声明 + `exports["./client"]` 指向浏览器半边 `lib/client.js`，DSH 会自动把它投递到页面（URL 形如 `/plugins/<id>/client.js?rev=<内容哈希>`）。
- **宿主半边**用 `ctx.webServer.register(...)` 挂 HTTP 路由、`registerUpgrade(...)` 挂 WebSocket 升级通道，用 `node-pty` 起真实 shell，把 PTY 与 `ws` 双向桥接；所有资源随 `ctx.effect` 精确回收。
- **浏览器半边不是 ESM**：DSH 的浏览器插件走 `window.__ModuleLoader__.load({ id, factory: (require) => ... })`，`react` / `react-dom` 由宿主注入，所以插件自身零打包、零 CDN 依赖。
- **浏览器半边连到哪个地址**：Web 端页面本身就是 `http://127.0.0.1:<端口>`，用页面 origin 拼 `ws://` 即可；DSH **桌面端**的页面实际运行在 `dsh-app://app`（Electron 自定义协议）下，所以浏览器半边优先读宿主注入的 `globalThis.__DSH_TRANSPORT__.streamBaseUrl`（宿主 HTTP origin）再拼 WebSocket 地址——否则用 `location.host` 会得到 `ws://app/...`，连不上。
- **槽位**：浮层形态下面板注册在 root 作用域的 `shell.overlay` 列表槽里，因此**每个会话**（包括新建会话页）都会渲染它；装了 better-sidebar 时改为注册侧栏页签。
- **并排为什么能互不遮挡**：DSH 的 AppFrame 自带 `overflow: hidden` 且没有固定宽度，所以面板用 `react-dom` 的 `createPortal` 挂到 `document.body`（脱离裁剪），再给框架设 `margin-right`；框架内部用 `ResizeObserver` 感知到自己变窄，会自行重排三栏，因此终端与「详情栏拖拽把手」都不会错位。

### 终端为什么跑在独立进程里（延迟隔离）

`dsh web` 只有**一条事件循环**，上面同时排着逐 token 的流式解析、会话投影、zstd 压缩落盘与随之而来的 GC。
实测：主进程重载时，一个**只返回几个字节**的 HTTP 接口延迟 p95 会到 180 ms、最坏 20 秒无响应；
终端按键回显如果也排在同一条队列上，就会出现「打字几秒没反应」——实测最坏 **4967 ms 无回显**。

所以 PTY 与 WebSocket 被放进独立进程 `lib/helper.js`（默认监听 `127.0.0.1:3110`）：

- 浏览器半边**优先直连**该进程，按键回显只受它自己影响；
- 连不上时**自动回退**到宿主半边的同源路由 `/dsh-terminal/ws`，任何环境都能用；
- 宿主半边只负责「保证它在跑」：启动探测 `/healthz`、不在就 `detached` 拉起、每 10 秒一次心跳、
  版本不一致先请旧实例退出再拉起；**插件卸载不会杀掉它**，因此 dsh 重启后已有终端仍可续用；
- PTY 输出**自适应合批**：孤立的 chunk（典型就是按键回显）立即发出，爆发式输出（`ls -l` 之类）
  才按 8 ms 窗口合并，避免给打字加固定延迟，同时减少前端逐帧重排。

同一负载窗口下的按键往返延迟实测：

| 负载档 | 独立进程（本插件默认） | 同源回退（隔离前的行为） |
| --- | --- | --- |
| 空闲 | 0.7 ms 中位 | 0.7 ms 中位 |
| 流式输出中 | 1.0 ms p95 | 2204 ms p95 |
| 主进程重载 | 1.0 ms p95、**0 次超时** | 1538 ms p95、**4 次 >5 秒无回显** |

端口可用 `DSH_TERMINAL_PORT` 改变。如果浏览器是通过端口转发访问 GUI，请把该端口一起转发；
或在前端控制台执行 `localStorage.setItem('dsh-terminal-port', '<端口>')` 后刷新页面。

> **Windows 说明**：`process.execPath` 在 DSH 里是 Electron 可执行文件，直接 spawn 会拉起第二个 GUI 实例，而裸 Node 又解析不到 `app.asar` 里的 `node-pty`，所以 Windows 下默认**跳过**独立终端进程，自动回退到宿主同源 PTY 路由（功能完整，只是没有上面的延迟隔离）。需要尝试时设 `DSH_TERMINAL_HELPER=1`，并自行保证 `node-pty` / `ws` 可解析。

---

## 已知限制与注意事项

1. **终端是浏览器态的**：刷新页面会重建 PTY，滚动缓冲与正在跑的前台命令会丢。折叠面板**不会**（只是隐藏）。需要跨刷新持久化，请自己在 shell 里挂 `tmux` / `dtach`。
2. **每个环境最多 10 个 PTY**（本机 `local`、每个 WSL 发行版、每台 SSH 主机各自独立计数）。超过时该环境的新连接会收到错误帧，需要先关掉该环境里的一些终端。
3. **并排模式下的窄屏折叠**：见上文「面板宽度」。
4. **无鉴权**：`/dsh-terminal/*` 没有任何登录校验（与 DSH 本地 GUI 其余部分一致，只监听回环地址）。**不要**把 `dsh web` 暴露到公网或不可信网络。
5. **每一次连接就是一个真实 shell 进程**，权限与启动 `dsh web` 的用户相同。
6. **后台终端只显示当前环境**：本机终端只列本机、WSL 终端只列该发行版、SSH 终端只列该主机；其它环境的 shell 仍在后台常驻，切到对应环境的终端就能看到。
7. **`dsh web` 退出后独立终端进程仍在运行**（刻意设计：这样已有终端可以续用）。要一并停掉：`curl http://127.0.0.1:3110/shutdown`。
8. 宿主半边（`lib/index.js`）的代码改动需要**重启 DSH** 才生效（`dsh web` 重启进程；桌面端退出重开）。DSH 0.2.2 起 `cordis.patch.yml` 的 `name` 不能用 `?rev=N` 查询串（会 `ERR_MODULE_NOT_FOUND`），所以没有「改 rev 热加载宿主半边」这条路了。独立终端进程的改动只需重启该进程（或改版本号让宿主自动替换），刷新页面即可。
9. **读取剪贴板需要安全上下文**：右键粘贴走 `navigator.clipboard.readText()`，浏览器只在 `localhost` / `HTTPS` 下允许。若是通过普通 IP + HTTP 打开 GUI，右键会提示「请用 Ctrl+V」（xterm 自身支持浏览器粘贴事件，所以 Ctrl+V 一直可用）。复制侧优先用剪贴板 API，失败会退回 `execCommand('copy')`，一般不受影响。
10. **`Ctrl+C 复制` 只在有选中内容时生效**：这是刻意的——没有选中时 `Ctrl+C` 仍然是 `^C`，否则就没法中断前台命令了。要复制整屏内容请先选中，或用 `Ctrl+Shift+C`（部分浏览器/终端模拟器的习惯键）。
11. **环境变量改动要重启终端进程才生效**：PTY 的环境是在建连接时定下来的。`DSH_TERMINAL_KEEP_PAGER` 之类的开关改完，用 `curl http://127.0.0.1:3110/shutdown` 结束独立终端进程（宿主会在 10 秒内用新环境重新拉起），或直接重启 `dsh web`。注意：**改完 `lib/` 后不要只改 `HELPER_VERSION`/`VERSION` 里的版本号而不重启 `dsh web`** —— 运行中的旧宿主半边会用旧版本号去比对，导致独立终端进程被反复关掉重启（每隔 10 秒一次）。要升级版本号，请同时重启 `dsh web`。
12. **接入 better-sidebar 后的形态差异**：接入后没有浮层专属的 `Ctrl + \`` 全局开合、宽度拖拽与折叠悬浮按钮（开合/宽度/位置由侧栏 UI 负责）；页签关闭会回收该工作区 shell。剪贴板三开关、主题、常驻 PTY 等行为不变。
13. **Windows 本地环境默认使用 cmd**；WSL 和远程工作区自动使用对应环境的终端。Windows 下默认走宿主同源 PTY，不启用独立 helper。

---

## 开发与测试

仓库自带三套测试：

```bash
# 1) 行为回归：用最小 DOM/React 桩驱动真实的 lib/client.js
#    覆盖「切工作区不关旧 WS、切回不重建、隐藏仍收数据、主题切换不重建」等
#    不需要 dsh 在跑
npm test

# 1.1) 接入方式回归：stub 出 betterSidebar 服务，验证「装了 better-sidebar 时
#      只注册侧栏页签、没装时只挂浮层面板」、页签描述符契约与 onClose 回收
#      不需要 dsh 在跑
npm run test:sidebar

# 2) 真机集成：连上正在运行的 dsh web，真的开两个 PTY，
#    验证互不顶掉、各自 cd 独立、断开后无 shell 泄漏
#    前置：dsh web 在跑；ws 模块可解析（npm i -D ws 即可）
npm run test:pty

# 3) 真机集成：验证分页器行为（PAGER/GIT_PAGER 归一化、
#    长输出停在 less、Enter 翻行、Ctrl+C 与 q 都能退出）
#    前置：终端后端可达（默认独立终端进程 127.0.0.1:3110）
npm run test:pager
```

可用的环境变量：`DSH_TERM_HOST`、`DSH_TERM_ORIGIN`、`DSH_TERM_WS_A`、`DSH_TERM_WS_B`、`DSH_TERM_WS_BASE`、`DSH_TERM_PAGER_WS`、`DSH_TERMINAL_PORT`、`DSH_TERMINAL_KEEP_PAGER`。

改动生效方式：

| 改了什么 | 怎么生效 |
| --- | --- |
| `lib/client.js`、`assets/*` | 刷新页面（浏览器半边 URL 带内容哈希，无需清缓存） |
| `lib/helper.js`（独立终端进程） | 重启该进程（`curl http://127.0.0.1:3110/shutdown` 后重新拉起），或改 `VERSION` 让宿主自动替换；**不需要重启 dsh** |
| `lib/index.js`（宿主半边） | **重启 `dsh web`** |
| `package.json` 的 `dsh.client` 声明 | 重启 `dsh web` |

---

## 卸载

```bash
# 1) 从 cordis.patch.yml 里删掉那条 ui-terminal 的 insert
# 2) 删除插件目录
rm -rf ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-terminal
# 3) 刷新页面（或重启 dsh web）
```

卸载本插件不影响 `dsh-better-sidebar` 与 DSH 内置终端：只是少了一个终端入口。

---

## 许可

本仓库自有代码以 **MIT** 许可发布，见 [LICENSE](LICENSE)。

`assets/` 下内置了 xterm.js 与 addon-fit 的官方构建产物（MIT），版权归上游作者，
逐字节来源与哈希见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
