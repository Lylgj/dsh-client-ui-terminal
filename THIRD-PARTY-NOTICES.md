# 第三方组件声明

本仓库自有的代码（`lib/`、`tests/`、`examples/` 及文档）以 MIT 许可发布，见 [LICENSE](LICENSE)。

`assets/` 下四个文件是为了让终端面板**在断网/无 CDN 的环境下也能用**而内置的第三方运行库，
它们是上游 MIT 构建产物的**逐字节副本**（未做任何修改）。版权归上游作者所有。

## 1. @xterm/xterm 5.5.0

- 文件：`assets/xterm.js`、`assets/xterm.css`
- 来源包：[@xterm/xterm@5.5.0](https://www.npmjs.com/package/@xterm/xterm/v/5.5.0)
  （包内 `lib/xterm.js` 与 `css/xterm.css`）
- 上游仓库：<https://github.com/xtermjs/xterm.js>
- 许可：MIT
- 版权声明：
  - Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
  - Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
  - Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)
- 校验（与本仓库一致）：
  - `xterm.js` 289441 字节，md5 `7ab162c8b43e3d6590400143d9b4388f`
  - `xterm.css` 5559 字节，md5 `b9e25e4fb0f5a4fbf4b23962dc246b34`

## 2. @xterm/addon-fit 0.10.0

- 文件：`assets/addon-fit.js`
- 来源包：[@xterm/addon-fit@0.10.0](https://www.npmjs.com/package/@xterm/addon-fit/v/0.10.0)
  （包内 `lib/addon-fit.js`）
- 上游仓库：<https://github.com/xtermjs/xterm.js>（addons 目录）
- 许可：MIT
- 版权声明：Copyright (c) 2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
- 校验（与本仓库一致）：
  - `addon-fit.js` 1497 字节，md5 `f8d75700a8b8838b556c11d7e0a61845`
  - 备注：0.9.0 与 0.10.0 的该构建产物字节完全相同，此处按配套版本 0.10.0 声明。

## 3. @xterm/addon-webgl 0.19.0

- 文件：`assets/addon-webgl.js`
- 来源包：[@xterm/addon-webgl@0.19.0](https://www.npmjs.com/package/@xterm/addon-webgl/v/0.19.0)
  （包内 `lib/addon-webgl.js`）
- 上游仓库：<https://github.com/xtermjs/xterm.js>（addons 目录）
- 许可：MIT
- 版权声明：Copyright (c) 2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
- 校验（与本仓库一致）：
  - `addon-webgl.js` 247535 字节，sha256 前缀 `b85f8d4b3e9756be`
  - 配套 xterm 版本：5.5.0（与上文第 1 条一致）
- 用途：把终端绘制从主线程 DOM 搬到 GPU。聊天区流式输出时每个 token 都要重渲染，
  DOM 渲染器会和它抢同一个主线程；WebGL 之后终端绘制几乎不占主线程。
  **可选增强**：该文件加载失败或设备不支持 WebGL 时，`lib/client.js` 会静默退回默认渲染器。

## 关于 MIT 许可正文

上述三个上游组件均使用 MIT 许可，其许可正文与本仓库 [LICENSE](LICENSE) 中的 MIT 正文
一致（仅版权行不同，已在上文逐条列出）。

## 如何自行重新校对/升级这些内置资源

内置资源也可以用官方包重新生成，便于核对哈希或升级版本：

```bash
mkdir -p /tmp/xv && cd /tmp/xv
npm pack @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0 @xterm/addon-webgl@0.19.0
tar xzf xterm-5.5.0.tgz
cp package/lib/xterm.js  <repo>/assets/xterm.js
cp package/css/xterm.css <repo>/assets/xterm.css
tar xzf xterm-addon-fit-0.10.0.tgz
cp package/lib/addon-fit.js <repo>/assets/addon-fit.js
tar xzf xterm-addon-webgl-0.19.0.tgz
cp package/lib/addon-webgl.js <repo>/assets/addon-webgl.js
md5sum <repo>/assets/*        # 与上文哈希对照
```

升级到更高版本时请注意：本插件用的是 UMD 构建产物，依赖三个全局变量
`globalThis.Terminal`（xterm.js）、`globalThis.FitAddon.FitAddon`（addon-fit）
与 `globalThis.WebglAddon.WebglAddon`（addon-webgl，可选）；
换用官方 ESM 构建（`lib/xterm.mjs`）需要同步调整 `lib/client.js` 的 `loadAssets()`。
addon-webgl 的版本要与 xterm 主版本配套（本例 5.5.0 ↔ 0.19.0）。
