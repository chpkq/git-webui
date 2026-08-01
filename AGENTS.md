# Git WebUI 项目约束

## 1. 指令优先级

1. 用户当前明确指令。
2. 本文件 `AGENTS.md`。
3. `project-execution-plan.md` 中的 V0.1 范围、里程碑和验收门禁。
4. 其他项目文档与代码现状。

如果不同来源冲突，按上述优先级执行，并在变更说明中指出冲突及选择。

## 2. 项目基线

- 项目根目录为 `/Users/chpkq/git/git-webui`。
- 禁止在项目根目录内再创建嵌套 Git 仓库。
- V0.1 是直接操作部署机器真实 Git Working Tree 的轻量 Web Client，不是 Git 托管平台。
- Git 历史、Branch、Remote 和 Working Tree 的真实状态以系统 Git CLI 与本地文件系统为准。
- 开发必须按 `project-execution-plan.md` 的 M0 至 M6 顺序推进，不跳过前置依赖或退出门禁。

## 3. 语言与命名

- 代码注释使用中文。
- Git commit 信息使用中文。
- 用户面向的项目文档默认使用中文，除非用户另有要求。
- 目录名和文件名必须使用英文，使用 `kebab-case`；框架约定的文件名保持其标准形式，例如 `AGENTS.md`、`README.md`、`package.json`。
- TypeScript 类型、函数、变量、API 字段和数据库字段使用英文。
- TypeScript 类型和组件使用 `PascalCase`，函数和变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。
- 避免无信息的缩写和单字母命名；命名应表达 Git 语义和操作范围。

## 4. V0.1 范围约束

### 4.1 允许实现

- 本地仓库注册、移除注册和切换，不删除磁盘上的真实仓库。
- Local Branch、Remote、Remote Branch、Tag、Submodule 和 Worktree 查询与只读展示。
- Working Copy、Commit History、Commit Detail 和按需 Diff 查看。
- 单文件或全部 Stage/Unstage。
- Fetch All + Prune、ff-only Pull、Push 和首次设置 upstream。
- Remote 增删改和 Branch 创建、切换、重命名、安全删除、设置 upstream。
- Viewer、Editor、Admin 权限、写操作审计、操作进度和仓库变更刷新。

### 4.2 禁止实现

未经用户明确调整版本范围，不得在 V0.1 实现以下功能：

- Commit 创建、Amend、Commit Message 编辑和 Stash。
- Merge、Rebase、Cherry-pick、Revert 和交互式冲突解决。
- Force Push、Hard Reset、强制删除未合并分支或其他历史改写。
- Git 托管、SSH Git Server、Fork、Pull Request、Issue 和 CI/CD。
- 将 Git 真实状态复制到 SQLite 作为真相源。
- 保存 Remote 密码、PAT、SSH 私钥或 Authorization 数据。

如果任务需要突破上述边界，必须停止实现，说明产品影响、安全风险和里程碑变化，等待用户确认。

## 5. 工程结构与技术栈

- 使用 pnpm workspace 管理 monorepo。
- 前端使用 React、TypeScript、Vite、TanStack Query、Zustand 和 TanStack Virtual。
- Diff UI 使用 Monaco Diff Editor，Stage/Unstage 由外围控件执行，不直接编辑工作区文件。
- 后端使用 Node.js、TypeScript 和 Fastify。
- Git 引擎使用宿主机的系统 Git CLI，V0.1 最低支持 Git 2.30。
- SQLite 仅保存 repositories、settings、operations、audit_logs 和可选 UI state。
- REST API 契约使用共享 schema 并生成 OpenAPI；前后端不重复手写不受约束的同义类型。
- SSE 用于操作进度与仓库变更通知；查询 API 仍是完整状态的获取入口。

目标目录结构：

```text
apps/
  web/
  server/
packages/
  git-core/
  shared/
  ui-components/
tests/
```

跨 package 共享代码必须放入明确的 package，禁止通过跨越包边界的相对路径引用内部文件。

## 6. Git 命令与仓库安全

以下规则为不可放宽的强制约束：

- Route 层不得直接拼接或执行 Git 命令。
- 所有 Git 查询与写操作必须经过 `GitProvider`、`GitQueryService` 或 `GitOperationService`。
- 子进程必须使用 `spawn` 或 `execFile`，必须设置 `shell: false`。
- ref、remote、branch、path 和 commitish 必须作为独立 argv 传递，不得进入 shell 命令字符串。
- 文件路径参数前使用 `--` 终止 Git 选项解析。
- 使用 Git 提供的机器可读格式；状态使用 `git status --porcelain=v2 -z --branch`，不按普通换行拆分路径。
- 注册仓库时执行 `realpath + allowedRoots + git rev-parse --show-toplevel`。
- 每次查询或操作前都必须重新验证仓库 `realpath` 仍在 `allowedRoots` 内，防止注册后 symlink 替换。
- ref、remote、branch 和 commitish 必须使用 Git 能力和白名单规则校验，不信任用户输入。
- 每个子进程必须配置超时、stdout/stderr 上限、并发上限和结构化错误映射。
- 任何日志、审计、数据库或 API 响应都必须对 Token、密码、Authorization、敏感 URL 和凭据提示脱敏。

## 7. 写操作执行模型

- 同一仓库任意时刻只能运行一个写操作；不同仓库可并行。
- 每个写操作必须创建 `operationId`，状态只能在 `queued`、`running`、`success`、`failed`、`conflict`、`cancelled` 之间按规定转换。
- 写操作必须保存 preflight snapshot，至少包含 HEAD、当前 Branch、Working Tree、upstream 和进行中 Git 状态。
- 执行前必须在前端展示实际目标和预计影响，并在服务端重做校验；不得仅依赖前端禁用。
- 完成或失败后必须重新查询仓库状态，不得根据预期结果乐观篡改真实 Git 状态。
- 所有写操作从首次实现起就必须接入操作日志和审计，不得延后补做。
- Pull 默认使用 `--ff-only`，在脏工作区、无 upstream、非快进或冲突状态下停止并返回结构化错误。
- Push 目标 Remote 和 Branch 必须显式；默认禁止 `--force`、`--force-with-lease` 和其他强制参数。
- Branch 删除只允许 `git branch -d`；当前分支、未合并分支或被 Worktree 占用的分支必须拒绝。
- 只有在能证明中断安全且能重新确认状态时才能提供取消功能。

## 8. API 与数据约束

- Fastify Route 只负责身份、权限、schema 校验、请求转换和响应映射。
- 业务规则位于 service 层，Git 语义位于 `git-core`，数据持久化细节不得泄漏到 Web UI。
- API 错误必须使用稳定错误码和可读信息，不得要求前端解析原始 stderr 判断状态。
- Commit API 默认每页 50 条，最大 200 条；禁止一次返回全部历史。
- 文件内容、Diff、stdout 和 stderr 必须有字节数或行数上限；超限时返回统计与明确的 truncated/oversize 状态。
- 大数据使用分页、虚拟列表和按需加载；不得为简化实现而一次返回所有 Commit 或所有 Diff。
- watcher 仅用于缓存失效通知，必须保留周期性校准或完整重查机制。

## 9. 鉴权与网络约束

- 默认只监听 `127.0.0.1`。
- 登录、安全 session/cookie、CSRF、Viewer/Editor/Admin 权限和登录限流未全部完成前，禁止监听 `0.0.0.0`。
- 前端必须按权限显示或禁用操作；后端 route 和 service 必须独立重新验证权限。
- WebUI 登录凭据与 Git Remote 凭据必须完全分离。
- Git 操作继承系统 SSH Agent、Git Credential Manager、credential helper 和用户级 Git 配置；应用不接管或持久化这些秘密。
- 需要交互式输入时必须停止并返回结构化指引，不在服务器进程中弹出或伪造交互终端。

## 10. 前端交互约束

- 主界面保持顶部工具栏 + Locations + History/Working Copy + Summary/Diff + 底部状态栏的信息架构。
- 参考 Sublime Merge 的信息密度和工作流，不复制其品牌、图标或受保护视觉资产。
- 任何异步数据组件必须处理 loading、empty、error 和 stale 状态。
- Diff 必须处理 added、deleted、renamed、binary、LFS pointer、oversize 和 truncated 状态。
- 写操作不得只用一个无上下文的按钮触发；必须展示目标、预检、进度、结果和失败恢复建议。
- 操作完成后通过查询失效和服务端重查刷新 UI，不把乐观状态当作 Git 真实状态。
- 移动端 V0.1 只保证查看，不为追求移动端完整写操作而扩大范围。

## 11. 测试与验证

- parser、command builder、validation、permission、redaction 和 error mapping 必须有单元测试。
- Git 写操作必须使用临时工作仓库和 bare remote 运行真实 Git 集成测试，不得仅 mock Git 输出。
- 测试必须覆盖空格、中文、换行路径、rename、delete、binary、detached HEAD、多 Remote 和恶意 ref。
- 并发测试必须覆盖同仓库多写请求、多浏览器标签页和外部 Git 同时修改。
- 失败测试必须覆盖断网、认证失败、非快进、脏工作区、冲突状态、超时和输出超限。
- 关键用户流必须有 Playwright E2E：注册仓库 → 查看变更 → Stage/Unstage → Update → Pull/Push，以及 Branch/Remote 管理。
- 涉及布局、Diff、对话框和权限可见性的变更必须执行真实浏览器验证；静态检查或单元测试不能替代 UI 验收。
- 发布前必须在 macOS、Linux 和 Windows 上至少各验证一次启动与核心流程。
- 无法在当前环境执行的测试或手动验收必须如实列出，不得宣称已通过。

## 12. Definition of Done

任务只有同时满足以下条件才算完成：

- 实现与当前里程碑和 V0.1 边界一致。
- 正常、空、加载、失败、超限和无权限状态都有明确行为。
- 新增后端行为有单元测试或真实临时仓库集成测试，关键用户流有 E2E 测试。
- 输入校验、权限、并发、超时、输出上限、脱敏和审计已按风险处理。
- 相关 typecheck、lint、unit 和 integration 检查通过。
- 相关文档、配置、限制和故障处理已同步更新。
- 真实浏览器或跨平台验收如果未执行，必须在交付说明中标记为缺口。
- 工作区中没有与当前任务无关的自动格式化或重构改动。

## 13. Git 与交付规则

- 开始任务前检查 `git status`，区分用户已有改动和当前任务改动。
- 保留用户已有改动，不得使用 `git reset --hard`、`git checkout --`、`git clean` 或其他破坏性方式清理工作区。
- 只修改当前任务所需文件，不夹带无关重构、依赖升级或格式化。
- 每个 commit 只包含一个可独立验收的逻辑单元，提交前必须完成对应测试。
- commit 信息使用中文，建议格式为 `<type>(<scope>): <中文摘要>`，例如 `feat(git-core): 实现仓库路径校验`。
- 未经用户明确要求，不创建 commit，不 push，不创建或修改 Pull Request。
- 使用 `gh` 命令时必须使用当前系统代理环境，不得清除代理变量、绕过代理或改为直连。
- 交付说明必须列出实际改动、已执行验证、未执行验收和已知风险，不得用静态检查冒充真实运行验证。

## 14. 开发工作流

1. 读取 `project-execution-plan.md` 中当前里程碑、任务 ID、依赖和退出门禁。
2. 检查工作区、现有实现、测试基线和相关 ADR，不假设计划中的技术选型已经落地。
3. 在编码前确认当前任务的输入、输出、失败状态、安全边界和验收方式。
4. 优先实现最小完整纵向切片，不提前搭建 V0.2/V0.3 抽象。
5. 同步增加最接近真实风险的测试和 fixture，不在里程碑末尾集中补测试。
6. 按 Definition of Done 和当前里程碑门禁验证，记录真实证据与未覆盖项。
7. 只有用户要求时才创建中文 commit；只有用户明确要求时才 push。

## 15. 需要停止并确认的情况

出现以下情况时，不得自行扩大范围或选择高风险方案：

- 任务要求开放 V0.1 明确禁止的高风险 Git 能力。
- 需要删除或覆盖用户仓库、分支、未提交变更、配置或持久化数据。
- 需要改变已冻结的产品范围、安全模型、仓库真相源或核心技术栈。
- 需要在鉴权和 CSRF 门禁完成前开放远程监听。
- 工作区中的用户改动与当前任务冲突，无法在不覆盖的情况下继续。
- 需要从外部网络下载依赖、发布到外部系统或使用新的第三方服务，且用户尚未授权该行为。
