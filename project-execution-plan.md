# Git WebUI 项目执行计划

> 依据：`Git_WebUI_开发计划.docx`
> 计划版本：V0.1
> 基准日期：2026-08-01
> 适用范围：V0.1 可写 MVP，不包含 V0.2/V0.3 功能

## 1. 执行结论

V0.1 的产品定位是“直接操作部署机器真实 Git Working Tree 的轻量 Web Client”，不是 Git 托管平台。开发应围绕三条主线展开：

1. **可信的 Git 查询内核**：以系统 Git CLI 为真相源，正确处理 Unicode、空格、rename、detached HEAD、大仓库等边界。
2. **克制且可审计的写操作**：Stage/Unstage、Fetch、Pull、Push、Remote 和 Branch 操作统一经过预检、权限、仓库级互斥、进度和审计。
3. **Sublime Merge 风格的审查工作流**：快速建立 Locations → History/Working Copy → Summary/Diff 的三栏闭环，然后再增加同步和管理能力。

原文的 22–29 个工作日可作为理想估算。若要在 Windows、macOS、Linux 上完成真实的凭据、网络、文件监听和 E2E 验证，建议将可发布 V0.1 按 **27–35 个工作日**规划，以验收门禁而不是日期作为里程碑完成条件。

## 2. 开工前置项

### 2.1 仓库根目录

- /Users/chpkq/git/git-webui

### 2.2 需要冻结的工程决策

| 编号 | 决策 | 建议默认值 | 原因 |
| --- | --- | --- | --- |
| ADR-001 | V0.1 最低 Git 版本 | Git 2.30+ | 保证 `switch`/`restore` 可用，减少兼容分支 |
| ADR-002 | 首个可运行版的访问模式 | 后端监听 `127.0.0.1`，开发前端可监听 `0.0.0.0` | 后端保持本机安全边界，前端通过代理访问本机 API |
| ADR-003 | 前端 UI 状态 | Zustand | 面板、选中项和快捷键状态较集中 |
| ADR-004 | SQLite 实现 | 待 M0 做 PoC 后确定 | 需同时考虑 Node 24、standalone 和跨平台打包 |
| ADR-005 | API 契约 | OpenAPI + 共享 schema | 避免前后端类型手工漂移 |
| ADR-006 | Commit Graph 绘制 | Canvas/SVG 小型 PoC 后锁定 | 需先验证分页增量 lane 的性能与稳定性 |

### 2.3 开发规约

- 代码注释和 Git commit 信息使用中文。
- 每个里程碑拆分为可独立验证的提交，不把多个验收目标混入一次提交。
- 使用 `gh` 时通过系统代理运行。
- 在任务验收通过前不提交；未明确要求时不 push。

## 3. V0.1 需求冻结

### 3.1 P0 必须交付

- 注册、移除注册、切换 `allowedRoots` 内的本地 Git 仓库，不删除磁盘仓库。
- 展示 Local Branch、Remote、Remote Branch、Tag、Submodule 和 Worktree 的只读状态。
- 展示 Working Copy 的 staged、unstaged、untracked 状态。
- 按 Ref 分页浏览 Commit Graph、Commit 详情和逐文件 Diff。
- 支持 Working、Staged、Commit、Branch Compare Diff，包含 binary、rename 和超限状态。
- 支持单文件和全部 Stage/Unstage。
- Update 执行 Fetch All + Prune；Pull 固定 ff-only；Push 支持首次设置 upstream。
- 支持 Remote 增删改和 Branch 创建、切换、重命名、安全删除、设置 upstream。
- 所有写操作包含 preflight、权限、确认、per-repo mutex、结构化结果、日志和审计。
- 外部 Git 操作后能自动刷新；大仓库采用分页、虚拟列表和按需 Diff。
- 默认后端绑定 `127.0.0.1`，开发前端绑定 `0.0.0.0`；后端启动远程监听必须具备登录、Viewer/Editor/Admin 权限和 CSRF 防护。

### 3.2 P1 可延后到 V0.1 后半段

- chokidar 文件监听和精确缓存失效；MVP 前期可用 2–3 秒轮询。
- 受保护分支额外策略、Remote URL 连通性测试、操作取消。
- 响应式窄屏查看、可配置快捷键、本机编辑器打开。

### 3.3 明确不做

- Commit 创建、Amend、Commit Message 编辑和所有 Stash 功能。
- Merge、Rebase、Cherry-pick、Revert、交互式冲突解决。
- Force Push、Hard Reset、强制删除未合并分支及批量历史改写。
- Git 托管、SSH Git Server、Fork、Pull Request、Issue 和 CI/CD。
- 将 Commit、Branch、Remote、Stash 或 Working Tree 真实状态复制到 SQLite。
- 保存 PAT、Remote 密码、SSH 私钥或 Authorization 数据。

## 4. 架构边界与依赖顺序

```text
Browser
  → Web UI（React + TypeScript）
  → REST / SSE
  → Fastify Route（仅做契约、身份和输入转换）
  → Git Query Service / Git Operation Service
  → GitProvider + Operation Runner + Per-Repo Queue
  → System Git CLI（shell=false，独立 argv）
  → Local Repository / OS Credential Manager / SSH Agent
```

强制边界：

- Route 层不得拼接或执行 Git 命令。
- 所有仓库请求都重新验证 `realpath` 仍位于 `allowedRoots` 内。
- 查询真相源始终是 Git CLI；watcher 只触发失效，不生成仓库状态。
- Stage 之前必须已有安全的 command runner、参数校验和 per-repo queue，因此不能将 Operation Runner 整体留到同步里程碑再实现。
- 审计表和操作记录表在 M1 创建，各写操作从首次上线起就接入，不在发布前集中补记。
- 远程鉴权未完成时服务必须继续绑定 `127.0.0.1`。

## 5. 里程碑执行计划

| 里程碑 | 目标 | 主要交付物 | 依赖 | 估算 |
| --- | --- | --- | --- | --- |
| M0 | 建立可重复开发的工程基线 | monorepo、质量工具、health API、三栏 Shell、ADR | 前置决策 | 2–3 天 |
| M1 | 跑通真实仓库注册和核心查询 | command runner、SQLite、repository/status/locations | M0 | 4–5 天 |
| M2 | 建立可用的历史浏览界面 | Locations、Commit Graph、Summary、URL 状态 | M1 | 4–5 天 |
| M3 | 建立“审查变更 → 整理暂存区”闭环 | Working Copy、Diff Viewer、Stage/Unstage | M1、M2 | 5–6 天 |
| M4 | 建立安全同步闭环 | operation API/SSE、Fetch/Pull/Push、Operation Log | M1、M3 | 4–5 天 |
| M5 | 完成日常仓库管理 | Remote/Branch 管理、角色、确认、审计 | M1、M4 | 4–5 天 |
| M6 | 安全加固并发布 | watcher、鉴权/CSRF、跨平台验证、打包文档 | M2–M5 | 4–6 天 |

### M0：工程骨架

- [x] **BOOT-001** 确定唯一 Git 根目录和远程绑定。
- [x] **BOOT-002** 建立 `apps/web`、`apps/server`、`packages/git-core`、`packages/shared`、`packages/ui-components`。
- [x] **BOOT-003** 配置 pnpm workspace、TypeScript project references 和统一 scripts。
- [x] **BOOT-004** 配置 ESLint、Prettier、Vitest、Playwright 和基础 CI。
- [x] **BOOT-005** 建立共享 API error schema、schema 校验和 OpenAPI 生成基线。
- [x] **BOOT-006** 实现 Fastify `/health` 与 React 三栏空壳。
- [x] **BOOT-007** 记录 ADR-001 至 ADR-006，冻结 V0.1 范围。

**退出门禁**：全新环境可一条命令安装依赖并启动前后端；`/health` 通过；类型检查、lint 和单元测试可运行；三栏 Shell 可正常缩放。

### M1：Repository 与 Query Core

- [x] **CORE-001** 实现 `CommandRunner`：`spawn/execFile`、`shell=false`、超时、取消、输出上限、脱敏。
- [x] **CORE-002** 实现 `realpath + allowedRoots + rev-parse` 仓库验证，覆盖 symlink 和路径逃逸。
- [x] **DATA-001** 建立 SQLite migration：repositories、settings、operations、audit_logs。
- [x] **CORE-003** 实现 Repository CRUD，移除注册不删除本地目录。
- [x] **CORE-004** 实现 porcelain v2 `-z` parser，支持 staged/unstaged/untracked/rename/conflict。
- [x] **CORE-005** 实现 Branch/Remote/Tag/Submodule/Worktree provider。
- [x] **CORE-006** 实现 HEAD、upstream、ahead/behind 和进行中 Git 状态检测。
- [x] **API-001** 实现 repository/status/locations REST API 和结构化错误。
- [x] **TEST-001** 建立临时工作仓库 + bare remote 测试工具。
- [x] **TEST-002** 覆盖空格、中文、rename、detached HEAD、多 Remote、symlink 和恶意 ref。

**退出门禁**：API 与相同仓库上的 Git CLI 结果一致；非 `allowedRoots` 仓库、symlink 逃逸和非法 ref 被稳定拒绝；不存在 shell 字符串拼接。

### M2：主界面与 Commit History

- [x] **CORE-007** 实现按 Ref 的 Commit 分页，返回 parents、decorations、stats 和 cursor。
- [x] **CORE-008** 实现 Commit Detail 与 changed-files 摘要。
- [x] **API-002** 实现 commits/commit-detail API，默认 50 条、上限 200 条。
- [x] **WEB-001** 实现顶部工具栏、Locations、History、Detail 和状态栏布局。
- [x] **WEB-002** 实现仓库选择、Locations 分组、计数、当前分支标记与 Ref 切换。
- [x] **WEB-003** 实现 Commit Timeline、Graph lane、decoration、虚拟列表和无限滚动。
- [x] **WEB-004** 实现 Summary，显示 Hash、Author、Date、Parents、stats 和 changed files。
- [x] **WEB-005** 实现 repo/ref/commit URL 状态、浏览器刷新恢复和面板尺寸保存。
- [x] **TEST-003** 建立大历史、merge commit、多 decoration 的性能与组件测试。

**退出门禁**：用户可从 Locations 切换任意 Local/Remote Ref，分页浏览大仓库历史，刷新后保留仓库、Ref 和 Commit 选中状态。

### M3：Diff、Working Copy 与 Stage

- [x] **CORE-009** 实现 Working/Staged/Commit/Compare changed-files 查询。
- [x] **CORE-010** 实现按 path 加载 Diff，支持 rename、binary、LFS pointer、字节/行数上限。
- [x] **CORE-011** 实现 Stage/Unstage 单文件和全部文件，并接入 per-repo queue、日志与审计。
- [x] **API-003** 实现 diff/stage/unstage API，路径必须作为独立 argv。
- [x] **WEB-006** 实现固定 Working Copy 项和 Staged/Changes/Untracked 分组。
- [x] **WEB-007** 接入 Monaco Diff Editor，实现 Split/Unified、文件 tabs 和查看偏好保存。
- [x] **WEB-008** 实现 loading、empty、binary、oversize、error 和 truncated 状态。
- [x] **WEB-009** 实现 Stage/Unstage 操作确认、禁用状态和完成后精确刷新。
- [x] **TEST-004** 覆盖中文/空格/换行路径、rename、删除、binary、超大 Diff 和并发 Stage。

**退出门禁**：Working Copy 与任意 Commit 可逐文件审查；Stage/Unstage 结果与 Git CLI 一致；错误操作不会产生部分成功且无提示的 UI 状态。

### M4：Update、Pull 与 Push

- [x] **OPS-001** 完善 per-repo Operation Queue，支持 queued/running/success/failed/conflict/cancelled。
- [x] **OPS-002** 实现 operationId、preflight snapshot、结构化结果和操作日志持久化。
- [x] **OPS-003** 实现 SSE 事件流，处理断线重连和事件去重。
- [x] **OPS-004** 实现 `fetch --all --prune --progress`、进度解析和安全取消。
- [x] **OPS-005** 实现 Pull preflight 和 `pull --ff-only --progress`。
- [x] **OPS-006** 实现 Push 目标显式选择、`--set-upstream`和默认禁止 force。
- [x] **OPS-007** 实现 AUTH_REQUIRED、HOST_KEY_REQUIRED、NON_FAST_FORWARD、DIRTY_WORKTREE 等错误映射。
- [x] **WEB-010** 实现 Update/Pull/Push 目标摘要、预检、进度、结果与 Operation Log。
- [x] **TEST-005** 覆盖 bare remote、首次 Push、无 upstream、非快进、断网、鉴权失败和多标签页并发。

**退出门禁**：同一仓库的写操作严格串行，不同仓库可并行；网络失败、认证失败、非快进和冲突均不破坏工作区，且 UI 提供可操作的下一步建议。

### M5：Remote、Branch 与权限

- [x] **SEC-001** 实现 Viewer/Editor/Admin 权限矩阵和 route/service 双层检查。
- [x] **CORE-012** 实现 Remote add/set-url/remove，区分 fetch/push URL 并脱敏。
- [x] **CORE-013** 实现 Branch create/switch/rename/delete `-d`/set-upstream。
- [x] **CORE-014** 实现当前分支、未合并分支、Worktree 占用、脏工作区的预检。
- [x] **API-004** 实现 Remote/Branch REST API，操作目标和影响摘要作为契约一部分。
- [x] **WEB-011** 实现 Locations 上下文菜单和 Remote 增删改对话框。
- [x] **WEB-012** 实现 Branch 创建/切换/重命名/删除/设置 upstream 对话框。
- [x] **WEB-013** 根据权限和 preflight 结果控制入口、禁用原因和二次确认。
- [x] **TEST-006** 覆盖恶意 Remote/Branch 名、当前分支删除、未合并删除、Worktree 占用和越权请求。

**退出门禁**：日常 Remote/Branch 操作可从 Locations 完成；高风险和越权操作被服务端拒绝，不仅是前端隐藏；审计日志不包含凭据。

### M6：实时刷新、安全与发布

- [x] **RT-001** 实现活跃仓库 watcher、debounce 和 `repo.changed` SSE。
- [x] **RT-002** 实现 status/locations/history/diff 的精确失效，保留定时校准轮询。
- [x] **SEC-002** 实现远程模式登录、安全 session/cookie、CSRF 和登录限流。
- [x] **SEC-003** 实现远程监听安全门禁，鉴权未就绪时拒绝绑定 `0.0.0.0`。
- [x] **SEC-004** 完成凭据、URL、环境变量、stdout/stderr 和 API 响应的脱敏审计。
- [x] **TEST-007** 完成 Unit、Integration、API、Frontend、E2E、Concurrency、Failure 分层测试。
- [ ] **TEST-008** 在 macOS、Linux、Windows 上验证启动、中文路径、Stage/Unstage、Fetch/Pull/Push。
- [x] **REL-001** 输出 npm/standalone/Docker 三类运行方式与版本化配置。
- [x] **REL-002** 编写 README：安装、allowedRoots、凭据、SSH Agent、Tailscale/LAN、反向代理、Docker 挂载和故障排查。
- [ ] **REL-003** 按第 8 节发布清单执行完整候选版验收。

**退出门禁**：默认配置安全；远程模式的身份、权限、CSRF 和审计闭环通过；外部变更数秒内可见；三平台核心流程有真实证据；安装和运维文档可被新用户独立执行。

## 6. 任务依赖与并行策略

```text
BOOT-001..007
  └─ CORE-001 + CORE-002 + DATA-001 + TEST-001
       ├─ Repository/Status/Locations ────────┐
       │                                      ├─ History UI ──┐
       │                                      └─ Diff Core ───┤
       └─ Queue/Audit 基础 ── Stage/Unstage ──────┘
                                                  └─ Fetch/Pull/Push
                                                       └─ Remote/Branch 管理
                                                            └─ Security/Watcher/Release
```

单人开发以评审负担可控为优先，每次只保持一个主任务。以下工作可在同一里程碑内交错进行：

- parser 实现与临时仓库 fixture 建设。
- API schema 与前端 loading/error/empty 状态。
- 同步操作实现与错误映射 fixture。
- 功能测试与 README 对应章节，文档不留到 M6 集中补写。

## 7. 统一 Definition of Done

任务只有同时满足以下条件才能标记完成：

- 实现内容与本计划的 V0.1 边界一致，没有夹带 V0.2/V0.3 功能。
- 正常、空、加载、失败、超限和无权限状态都有明确行为。
- 新增后端行为有单元或真实临时仓库集成测试；关键用户流有 E2E 测试。
- 输入校验、权限、并发、超时、输出上限、脱敏和审计已按风险处理。
- typecheck、lint、unit/integration 测试通过，且没有与当前任务无关的改动。
- 手动验证步骤和结果已记录；没有执行的浏览器或跨平台验收必须明确标注为缺口。
- 相关配置、限制、用户流和故障处理已同步到文档。
- Git commit 信息使用中文，一个 commit 对应一个可独立验收的逻辑单元。

## 8. V0.1 发布门禁

### 8.1 功能

- [ ] 三栏布局、面板缩放、状态恢复和基础快捷键通过。
- [ ] Local/Remote Branch、Remote、Tag、Submodule、Worktree 与 Git CLI 一致。
- [ ] Commit Graph、Commit Detail 和分页在大历史仓库中可用。
- [ ] Working Copy、四类 Diff、Stage/Unstage 和边界文件通过。
- [ ] Update、ff-only Pull、Push/set-upstream 在正常与失败场景通过。
- [ ] Remote 与 Branch 日常管理流程通过。

### 8.2 安全与可靠性

- [ ] `allowedRoots`、symlink 逃逸、非法 ref/path/remote/branch 输入通过安全测试。
- [ ] Git 子进程全部使用 `shell=false` 和独立 argv。
- [ ] 同仓库写操作串行，重复请求和多标签页不产生静默竞态。
- [ ] 进行中的 merge/rebase/cherry-pick/bisect 能检测并限制不兼容操作。
- [ ] 日志、数据库和 API 中无 PAT、密码、私钥、Authorization 和完整敏感 URL。
- [ ] 远程模式的登录、权限、CSRF、cookie 和限流通过。

### 8.3 兼容性与运维

- [ ] macOS、Linux、Windows 完成核心流程验证并留存证据。
- [ ] localhost、LAN/Tailscale、HTTPS 反向代理的边界和配置已验证。
- [ ] npm/standalone/Docker 至少有一种作为主推安装路径完整通过。
- [ ] README 包含安装、配置、凭据、代理、挂载、备份和故障排查。

## 9. 主要风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 双重 Git 根目录 | 源码、文档和远程状态分裂 | BOOT-001 作为绝对前置，未决策前不脚手架 |
| Git 输出解析脆弱 | Unicode、rename、换行路径导致状态错乱 | 优先 NUL 分隔和机器可读格式，使用真实 repo fixture |
| Git 命令注入/路径逃逸 | 宿主机代码与凭据受损 | `shell=false`、独立 argv、`--`、realpath 复验、ref/name 校验 |
| 外部 Git 与 WebUI 并发 | 界面过期或写操作冲突 | preflight snapshot、per-repo queue、完成后重查、watcher + 校准轮询 |
| 凭据和 Git 交互差异 | CI/服务进程中 Push 失败 | 明确 non-interactive 策略，结构化错误，三平台真实验证 |
| Monaco + 大 Diff 内存压力 | 浏览器卡顿或崩溃 | changed-files 先行、按 path 加载、最大字节/行数、显式 truncated |
| Commit Graph 分页 lane 不稳定 | 滚动时图线跳变 | M0/M1 早期 PoC，cursor 包含足够的增量上下文 |
| 远程鉴权范围膨胀 | 拖延 MVP 且增加攻击面 | 本机模式先行，远程功能统一在 M6 通过安全门禁后开启 |
| 跨平台发现过晚 | 发布前集中返工 | M1 起在 CI 运行核心 parser/integration，M3/M4 后开始真机抽验 |

## 10. 产品缺口与后续决策

以下问题不阻止本执行计划生成，但必须在对应里程碑前冻结：

1. **实际项目根目录**：保留外层仓库，还是将内层仓库作为唯一工程根目录。
2. **首发安装形式**：npm、standalone 和 Docker 中哪一个是主推路径；Docker 对宿主机 Git/SSH Agent 的体验有明显限制。
3. **远程账户模型**：单一管理员、多用户本地账户，还是依赖反向代理身份。
4. **Pull 的脏工作区策略**：原计划要求脏工作区阻止 Pull，执行时应作为产品规则，不交给 Git 自行判定。
5. **Stage All 的语义**：是包含删除文件，还是只处理界面明确选中的路径；默认建议发送 UI 当前列表的显式 paths。
6. **操作幂等**：多标签页重复点击如何去重，建议写 API 支持客户端 idempotency key。
7. **“在本机编辑器打开”的安全语义**：服务器与浏览器可能不在同一台机器；V0.1 建议降级为复制宿主机路径。
8. **操作取消边界**：Fetch 可安全终止；Push 取消必须验证远端和本地状态，不应仅依赖杀死子进程。

## 11. 建议开工顺序

1. 完成 BOOT-001，只保留一个明确的 Git 项目根目录。
2. 执行 M0，先交付可启动、可测试、有范围约束的骨架。
3. 执行 M1，先用真实临时仓库把 Git 数据结构和安全边界跑通。
4. 执行 M2 和 M3，优先形成“选 Ref → 看历史/变更 → 看 Diff → Stage/Unstage”核心闭环。
5. 执行 M4，复用既有 Queue/Audit 基础完成同步能力。
6. 执行 M5，以同一套 preflight、权限和审计模型完成 Remote/Branch 管理。
7. 执行 M6，用真实的浏览器、网络、凭据和三平台证据关闭发布清单。

本项目的第一个开发任务应为 **BOOT-001 确定唯一 Git 根目录**；该任务完成后再开始 monorepo 初始化。
