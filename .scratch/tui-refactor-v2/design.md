# Setup TUI 重构方案（终版 v3 · 2026-10-27）

状态：**实施中（P0/P1/P2 完成，见 §9）**。交互骨架已由原型 D 在真 PTY 验证冻结；本文吸收交接文档
`.scratch/tui-refactor-v2/handoff-b92de67.md`（HEAD `b92de67`）的两个新事实：
UseGPT 服务控制已进 setup（状态/启动/停止，确认制，服务 detached），
顶部上下文条为 **6 上下文**（Exa/Tavily/Firecrawl/SearXNG/WeKnora/UseGPT）。

## 0. 结论一览

| 决定 | 内容 |
|---|---|
| 引擎 | `@earendil-works/pi-tui@1.4.0`（exact 锁定），3 个纯 JS 依赖，差量渲染 + SelectList/Box/HStack/VStack/overlay/mouse |
| 交互 | 保留 ADR 0017 三轴工作台（Top 上下文 / Left Menu / Right Content，Tab/Shift-Tab 焦点环） |
| 视觉 | opencode 风格圆角边框面板（自研 `Framed`，~20 行） |
| Node | engines 提至 `>=22.19.0`（用户已批） |
| 分层 | port（防腐）→ controller（纯 reducer）→ components/pages；业务动作复用现有 config/credentials/services 层 |
| ADR | 0023 取代 0016 的"无依赖"条款（保留全部安全条款）；0024 更新 0017 实现细节。均为"修订"而非"废弃" |

## 1. 已验证的事实基线（原型证据）

`.scratch/tui-prototype/`（README 含 6 项工程坑 + 三轮修复记录）：

- **定高布局**：pi-tui 普通组件 `render(width)` 拿不到分配高度 → 应用层自算
  `H = rows - 4`，`Framed.setH()` 补行/裁剪；strip/status/footer 均 `basis:1`
  单行截断。PTY 实测 8 状态边框恒 [1..20] 行零跳动。
- **对齐**：一律 `visibleWidth` 感知 `padV()`；状态 chips 定宽；热区按可见列累加。
- **功能面**（假数据全流程 PTY 通过）：a/e/d/Space、`i` 详情、`p` 安全预览、
  `t` chooser→计费同意→逐项进度→Esc 停止→历史入诊断、删/改制作废诊断、
  order 草稿（未保存标题/Del/I 同意流/Ctrl-S/no-op/Esc 放弃确认）、
  两级连接页 + 验证/服务启停模拟、confirm/choose 两类 modal、help。
- **安全骨架已验证**：overlay 开启时全局快捷键全栅栏；焦点随 mode 切换
  （`switchContent()`）；菜单失焦不画反色环；退出五连恢复
  （?1049l/?25h/?1000l/?1003l/?2004l）实测全 OK。
- winsize race：`process.stdout.rows || 24`、`columns || 80` 兜底必须进生产。

## 2. 目标架构

```
src/cli/main.ts            仅改 setup 分支 → 调 setupTui()；--json/非TTY 输出路径不动
src/tui/index.ts           setupTui(options)：TTY 守卫（非 TTY 拒绝进 alt-screen），组装并运行
src/tui/port.ts            防腐层：Terminal/Overlay/Key 输入/渲染循环的最小抽象
                           ★ 全仓唯一允许 import pi-tui 的文件；ASCII-icon 集开关也在这
src/tui/controller.ts      SetupController：纯 reducer
                           (state, event) → { state, commands: Command[] }
                           不碰 IO、不碰终端 → 可用普通单测穷举事件序列
src/tui/commands.ts        Command 执行器：把 save/remove/test/start 等落到既有服务
                           （config、credentials、key-tests、usegpt services、weknora）
src/tui/components/        framed.ts line.ts masked-input.ts top-strip.ts key-table.ts
                           chooser.ts（confirm/choose/notice/previewSecret 四模态）
src/tui/pages/             providers.ts config.ts settings.ts diagnostics.ts
                           connection-weknora.ts connection-usegpt.ts searxng 列变体
src/tui/messages.ts        en/zh 消息表（收编 ~150 处 inline t("en","zh")）
```

状态顶层形状：

```ts
type State = {
  region: "top" | "menu" | "content";
  context: 0..5;                    // 6 上下文条（4 web + weknora + usegpt）
  page: "providers" | "config" | "settings" | "diagnostics";
  selection: { row: number };
  mode: "browse" | "form" | "details" | "preview" | "busy";
  form?: { fields: …; dirty: boolean; editing?: ref };
  modal: null | { kind: "confirm" | "choose" | "notice" | "previewSecret"; … };
  orderDraft: string[] | null;
  diagnostics: Entry[];             // 仅内存
  busy: null | { kind: "test" | "verify" | "service"; i: number; n: number };
};
```

复用不动的边界：`src/config/*` 读写与校验、credentials 存储、`setup-key-tests.ts`
的测试语义、`src/usegpt/services.ts` 的 detached start/stop/status。
`setup-weknora.ts` / `setup-usegpt.ts` **拆成动作层**（去渲染、留业务方法，
移入 commands.ts 调用面），不是删除。

## 3. 交互契约（冻结稿 = 原型 D）

- 焦点环：Tab/Shift-Tab 在三轴循环；Content 内 Left→Menu；`↓`/`Enter` 下钻。
- Top：`←→` 或 `[ ]` 切上下文（只切上下文，不启用不发请求）；`v` 启停当前上下文；
  点标签可切。连接上下文（WeKnora/UseGPT）显示连接详情页而非密钥表。
- Providers 页：`a` 添加 `e`/`Enter` 编辑 `i` 详情 `p` 安全预览 `t` 测试
  `d` 移除 `Space` 停用；env 行只读守卫。SearXNG 变体列 = URL + 实例状态。
- Config 页：草稿语义（u/d/Del/I → 标题"未保存" → Ctrl-S 提交；Esc 脏放弃确认）。
- Diagnostics：仅内存、逐项时间/耗时/分类结论（无 payload）、删改制作废该键历史。
- Modal：一律 **Cancel 默认项在首位**；Esc=取消；打开期间全局键全栅栏。
- Busy：状态行 `i/n · Esc 停止`；停止保留已完成部分；再按 `t` 拒绝重入。
- 底部 keyBar 随 region/page/mode 动态生成，`[键]`+白话标签。
- 鼠标：标签/行/菜单已验证；按钮条点击已实现（P2），PTY 鼠标证据归 P5。

## 4. 安全语义迁移清单（每项必须可验收）

1. 掩码密钥输入（含 bracketed paste；不落 echo、不进历史、错误信息不含值）
2. 非 TTY 永不进 alt-screen：保持现 `--json`/管道行为逐字节不变（回归测试锁）
3. 退出终端恢复五连序列 + ctrl+c 任一路径（含 busy/modal 中）
4. Cancel-default 确认：移除、启停服务、启动前副作用、纳入路由、覆盖 env 密钥
5. env 管理密钥只读；本地优先需显式覆盖确认后才替换
6. SearXNG 私有 CIDR 逐实例授权，未授权不发请求
7. 计费/live-test 同意前置；测试可 Esc 停止且不自动重试
8. `p` 预览仅受信 TTY，离开页面即清除；详情读取前刷新快照、引用变更则拒绝
9. 草稿不写盘；保存增量、无锁跨输入/网络；no-op 保存不产生写入
10. winsize race 兜底；resize 后布局不残留

## 5. 分阶段实施

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| **P0 地基** | ADR 0023/0024；engines `>=22.19.0`；dep 精确锁定；`port.ts` + 三轴空壳 + TTY 守卫 + messages 骨架 | `npm run validate/typecheck` 绿；真 TTY 起退正常；非 TTY 行为逐字节不变 |
| **P1 只读** | 真数据浏览：6 上下文条、菜单、密钥/路由/语言/诊断只读渲染 + 详情/预览页 | 数据与 `--json` 输出口径一致；定高/对齐断言进组件单测 |
| **P2 管理** | a/e/d/Space + 生产级 MaskedInput（字段级 Enter/Esc/Ctrl-S、dirty-cancel、图素计数）+ credentials 写路径 + 按钮条鼠标 | controller 单测覆盖全部表单事件序列；PTY 测一遍增删改 |
| **P3 测试流** | chooser/同意/进度/Esc 停止/失效规则/历史 + CIDR 逐实例授权 | 安全清单 6、7 验收；模拟中断/超时/429 各一测 |
| **P4 连接** | WeKnora（verify/改密钥）、UseGPT（状态/启动/停止，确认+detached，对齐 `b92de67`）、SearXNG 页 | `arks setup weknora/usegpt` 直入上下文语义保留；服务操作与 CLI 命令一致 |
| **P5 资格** | 重写 `scripts/test-setup-pty.mjs`：启动/三轴/每动作一例/非TTY 旁路/恢复序列/resize；`.scratch/tui-prototype/ptygrid.py` 网格断言法直接移植（已处理 ioBusy 丢键需等网格稳定）；macOS/Windows 手工证据（maintenance.md） | `npm test` 全绿（774 基线只增不减）+ PTY 套件 + verify:package |
| **P6 清场** | 删 `setup-terminal.ts`（518 行）、`setup.ts:76-313` injected-menu、旧 weknora/usegpt UI 壳；迁移动作测试；README/INSTALL 同步 | 无死代码；`git grep setup-terminal` 为空 |

顺序执行不并行；每阶段结束跑全量验证再进下一阶段。

## 6. 测试策略

- **controller 纯单测**：事件序列 → state + Command[] 断言（无终端、无 IO）。
- **组件单测**：`render(width)` 行数恒等 = 定高契约；padV/截断的 CJK+ANSI 宽度用例。
- **PTY 端到端**：确定性键序 + 终端网格模拟断言（`.scratch/tui-prototype/ptygrid.py`，已验证可行）。
- **安全回归**：stdout 全文不含密钥子串；非 TTY 输出无 `?1049`；modal 中全局键无效。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 宽字符风险 | **已消除（2026-10-27 用户确认）**：自绘字符串一律无歧义 ASCII 图标（`+ ~ ! ? - * / ...`），禁用集 `✓ • — … ⋯ ⏸ → ·`；全角标点（W 类，pi-tui 按宽 2 一致计算）与边框字符（pi 宿主同假设且已在用）白名单保留。port 层落成断言：组件/messages 字符串过 deny-list 检查，不设开关 |
| pi-tui 上游破坏性变更 | exact 版本 + lockfile；port.ts 单点吸收 |
| Overlay 键穿透 | 已验证栅栏方案（modalHandle 守卫在 listener 首位） |
| SelectList filter 误触发 | 创建即 `setFilter("")`；生产统一经 chooser 组件封装 |
| Windows ConPTY/mouse | P5 手工证据；不可用则 mouse 降级为键盘等价路径（已具备） |
| main.ts 1338 行 | 本轮只换 setup 分支，其余不动 |

## 8. 明确不做（本重构范围外）

Pi worker handoff 故障诊断、全局安装/`/usr/bin/arks` 切换、systemd 开机自启、
二进制 artifact 输入、分支合并策略——交接文档 follow-up 独立排期，不搭 TUI 便车。

## 9. 实施状态

- **P0 地基（完成）**：`src/tui/port.ts`（pi-tui 唯一入口 + `assertWidthSafe` 禁字集）、`components/{style,framed,line}`、`messages.ts`、三轴空壳 + TTY 守卫 + 退出确认。validate/typecheck 绿；非 TTY 逐字节不变。
- **P1 真数据只读（完成）**：`controller.ts` 纯状态机 + `view.ts` 纯渲染 + `data.ts` 快照/预览守卫；`tests/tui-workbench.test.ts` 12 测。全量 786/786；PTY 真数据烟测通过（含预览离开即清除、退出五连恢复序列）。
- **P2 管理写路径（完成，2026-11 验收）**：
  - controller 扩展：FormState/ModalState/7 种 Op（addKey/replaceKey/removeKey/toggleKey/toggleProvider/saveOrder/setLanguage），modal→form→browse 三级优先级；预览/密钥值离页即清；确认类 modal 一律 Cancel 光标 0。
  - `commands.ts`：`runOp` 直连 `config/manage.ts` 写 API，错误只回显白名单安全文本（`setupSafeError` 本地化，未知细节抑制为 opFailed+reason）。
  - `index.ts`：modal/form/browse 三态按键栅栏、括号粘贴进表单、`ioBusy` 期间丢键（防异步重入）、strip/menu/row/按钮条鼠标分发。
  - 单测 26/26（新 14）：表单事件序列、env 密钥只读拒绝、覆盖确认、dirty-cancel、草稿保存/丢弃、consent 门（新增未路由 Provider 才触发）、语言映射。全量 **800/800**、validate 0、非 TTY 逐字节不变。
  - PTY 沙箱（隔离 `XDG_CONFIG_HOME`）实测通过：掩码输入不落屏、add/overwrite-confirm/replace/toggle/remove(cancel-default) 全部持久化且 credentials `0600`、order d/换+Ctrl-S 落盘、退出五连恢复、**输出流全文无明文密钥**。
  - 遗留（归 P5）：PTY 脚本的按键-异步同步策略（ioBusy 丢键需 ack/等待网格稳定后再断言）；order 光标不随条目移动的 vim 式手感待用户试用反馈；`setupSafeError` 对新 form 错误串的覆盖率待 P3 诊断联调时补测。
- **P3 测试流（完成，2026-11 验收）**：
  - controller：testIntent（keyed 用 chooser，Cancel 默认 + 计费/日志同意正文；SearXNG 单条 live-confirm）+ testBegin/Progress/Result/End；运行中围栏：变更键全拦、导航只读放行、二次 testIntent 拒绝；pool 起点清空历史（动全局健康），allKeys 保留；testResult 按引用去重上限 60；任意托管写 opDone 保守清空全部诊断。
  - host：复用 `testSetupKeys`（runner 层已有中断/超时/429 参数化测）与池测 `executeWebSearch`；运行中 Esc 触发 abort 保留部分结果；退出（含 ctrl+C）先 abort 再恢复终端；结果行只出引用/分类，无密钥无原始错误。
  - CIDR：provider 层既有强约束（私有地址仅实例授权段可达）直接生效；实例增删/授权 UI 归 P4 专属页。
  - 验收：reducer +10 测（共 36），全量 **810/810**；PTY 沙箱 11 断言全过（黑洞端点确定性中止，不外联）；非 TTY 逐字节不变；发现并清除 view 标题拼接遗留的 `·`（消息表扫描不覆盖拼接串，已归一 ASCII 分隔）。
  - 遗留（归 P5）：旧 workbench PTY 测满载偶发 1 例超时 flaky（重跑必绿）；pool 模式 e2e 样本入 P5 套件。
- **P4 连接管理（完成，2026-11 验收）**：
  - SearXNG 实例页：a/e/d 增改删（URL 表单，非掩码 field 泛化进 FormState.intent/field）；改端点不迁移授权（ADR 0014），同 URL 保存保留原 CIDR；私有 IP 字面量（v4/v6）触发逐实例授权 chooser（Cancel/精确 /32|/128/手动列表），公网端点直通；环境端点全链只读拦截；last-local 删除用专同意文案。
  - WeKnora 页：endpoint/key/kb/verify 四行 Enter 驱动；首次配置链式（URL→密钥一次写入）；改根需显式同意复用密钥；替换已存密钥先确认；source=environment/conflict 围栏；验证走 `executeWeknoraVerify` 真实 GET /auth/me（确认默认 Cancel + 计费/日志正文）；密钥仅掩码显示，取消零写入。
  - UseGPT 页：hub/tunnel 实状态（PID 探活）；start/stop 同意弹窗（detached 后台，启动后可关终端）+ svcBusy 围栏（变更全拦、导航/刷新放行）；diagnose 纯本地不发请求；动作后重诊断报 daemon/tunnel 实况。
  - 架构：新增 `service` Effect 车道（与 op 平行，host `runService` 统一 busy/notice/refresh）；`connData` 事件携带 weknora/usegpt 快照（`data.getConnections` 只读，与主快照同批加载）；`initialState(context)` + `arks setup <id>` 直达六上下文；setupSafeError 对新串未覆盖处走受控英文兑底（opFailed）。
  - 发现并修复 P1 遗留布局 bug：searxng 实例行表头/正文列宽不一致（16 vs 34）且英文状态串超宽重叠 → 行布局收窄至 URL26/状态12，状态/来源文案缩短（未探测/env-managed）。
  - 验收：reducer +12 测（共 48），全量 **822/822** + validate=0；PTY 沙箱 p4pty.py 16/16（公开实例直写/私有 gate 取消零写/grant 写 /32/删除确认/掩码不回显/退出恢复序列）+ env 围栏 3/3；非 TTY 输出带/不带 ARKS_TUI=v2 逐字节一致。
