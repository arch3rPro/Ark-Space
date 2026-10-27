# TUI 重构原型（存档）

> 状态：方向已定稿并进入生产实施（P0/P1/P2 完成，见 `.scratch/tui-refactor-v2/design.md` §9）。
> 本目录只保留选定的**原型 D** 与其工程结论；A/B/C 及一次性冒烟脚本已删除。
> 运行无需 `npm install`——pi-tui 已是仓库根的生产依赖，从本目录直接解析。

```bash
node .scratch/tui-prototype/d-workbench.mjs     # pi-tui 引擎三轴工作台（假数据，不读写真实配置）
ARKS_LANG=en node .scratch/tui-prototype/d-workbench.mjs
```

`ptygrid.py` — PTY 网格断言工具（P5 重写 `scripts/test-setup-pty.mjs` 的基础件）：
`PTY(env)` 起进程、`send(逻辑键)`、`grid()` 重建终端画面。已处理多参 SGR、`?` 私有序列、OSC 8。
注意：应用 `ioBusy` 期间丢键，脚本必须在按键间等待网格稳定（send 的 pump 时间）再断言。

## 原型 D 的已验证结论（生产实施直接沿用）

- 引擎收益实测：行级差分无闪烁、滚轮/点击鼠标、`SelectList`/`Box` 现成件、NO_COLOR 兼容。
- 键位模型：Tab 焦点环（top→menu→content）、`[ ]` 切 Context、确认框 Cancel 默认、overlay 开启时全局键全部栅栏。
- pi-tui 无内建边框组件 → `Framed` 自建并处理鼠标坐标偏移；`Input` 无掩码 → `MaskedInput` 自封装（含 bracketed paste）。
- `render(width)` 拿不到分配高度 → 定高必须应用层自算（`Framed.setH`），否则切页边框跳动。
- 对齐必须 `visibleWidth` 感知（`padEnd` 对 CJK/ANSI 都错位）；状态 chips 要定宽，否则标签条居中位置随数量横抖。
- 宽字符风险已消除：自绘串一律 ASCII 图标（`+ * - ... /`），port 层 deny-list 断言防回归。
- winsize 竞态：`process.stdout.columns` 可能为 0，需 fallback（旧 `setup-terminal.ts` 同款隐患）。
- pi-tui 把 `q` 等所有键路由给焦点组件，全局键必须走 `addInputListener` 的 `consume` 语义。
- `styleText()` 第三参 `mode` 必填、颜色要 `parseColor/rgbColor` 对象；`SelectList` 创建即 `setFilter("")`。

## 落选方案（一轮对比后否决，记录备查）

- A clack 线性向导：+4 依赖、丢同屏总览、丢单键快捷，需同时推翻 0016/0017。
- B 零依赖差分工作台：可行但输入解码/表单/modal 全自写，重复造轮子。
- C pi-tui 下钻式：交互不直观（用户否决），但其 PTY 冒烟贡献了上面的引擎坑清单。
