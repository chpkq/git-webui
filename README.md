# Git WebUI

Git WebUI 是一个直接操作部署机器真实 Git Working Tree 的轻量 Web Client，不是 Git 托管平台。

## 当前状态

项目按 `project-execution-plan.md` 的 M0 至 M6 顺序开发。默认服务只监听 `127.0.0.1`，Git CLI 是仓库状态的唯一真相源。

V0.1 当前实现包含：

- pnpm workspace monorepo；
- React、TypeScript、Vite、TanStack Query、Zustand 和 Monaco Diff 前端；
- Fastify 后端、SQLite 注册/操作/审计存储和共享 API schema；
- 真实 Git Working Tree 的查询、分页历史、Diff、Stage/Unstage；
- Fetch All + Prune、ff-only Pull、显式目标 Push/upstream；
- Remote/Branch 管理、操作队列、操作日志、SSE 进度和 `repo.changed` 刷新；
- 默认回环监听，以及显式配置才开启的 session、CSRF、限流和角色门禁。

## 开发环境

- Node.js 22.5 或更高版本；
- pnpm 10；
- Git 2.30 或更高版本。

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm dev
```

打开 <http://127.0.0.1:5173> 查看前端。后端默认运行在 <http://127.0.0.1:3000>。

## 范围边界

V0.1 不实现 Commit 创建、Stash、Merge、Rebase、Cherry-pick、Revert、Force Push、Hard Reset、Git 托管、Pull Request、Issue 或 CI/CD。应用不保存 Remote 密码、PAT、SSH 私钥或 Authorization 数据。

详细里程碑、验收门禁和安全约束见 [project-execution-plan.md](./project-execution-plan.md)。

## 配置

默认配置只允许本机访问，仓库只能注册在 `GIT_WEBUI_ALLOWED_ROOTS` 内。环境变量使用系统的路径分隔符分隔多个根目录：macOS/Linux 使用 `:`，Windows 使用 `;`。

```bash
GIT_WEBUI_ALLOWED_ROOTS=/Users/you/src:/Users/you/work \
GIT_WEBUI_DATABASE=/Users/you/.local/share/git-webui/data.sqlite \
GIT_WEBUI_ROLE=admin \
pnpm --filter @git-webui/server start
```

远程模式必须同时显式设置 `GIT_WEBUI_ENABLE_REMOTE=true`、至少 12 个字符的 `GIT_WEBUI_AUTH_PASSWORD` 和至少 32 个字符的 `GIT_WEBUI_SESSION_SECRET`。缺少任一项时服务拒绝启动，不会降级为无鉴权的 LAN 服务。

```bash
GIT_WEBUI_HOST=0.0.0.0 \
GIT_WEBUI_ENABLE_REMOTE=true \
GIT_WEBUI_AUTH_PASSWORD='change-this-long-password' \
GIT_WEBUI_SESSION_SECRET='use-a-random-secret-at-least-32-chars' \
GIT_WEBUI_COOKIE_SECURE=true \
GIT_WEBUI_ROLE=admin \
pnpm --filter @git-webui/server start
```

建议将远程服务放在 HTTPS 反向代理之后，并把 `GIT_WEBUI_COOKIE_SECURE` 设为 `true`。V0.1 的 session 存在服务进程内，重启服务会使现有登录失效；密码和 session secret 只从环境变量读取，不写入 SQLite、日志或 Git 配置。

## 凭据与 Git 安全边界

- Git 子进程继承系统 SSH Agent、credential helper 和用户级 Git 配置。
- 服务设置 `GIT_TERMINAL_PROMPT=0` 和 `GCM_INTERACTIVE=Never`，需要交互输入时返回结构化错误。
- 应用不保存 Remote 密码、PAT、SSH 私钥或 Authorization 数据；Remote URL、操作目标和错误输出会脱敏。
- 所有 ref、remote、branch、commitish 和仓库内路径都作为独立参数传给 Git，子进程使用 `shell=false`。
- 注册仓库和每次查询/写操作都会重新检查真实路径与 `allowedRoots`，防止注册后的 symlink 逃逸。

## 运行与故障排查

- 前端开发服务器：`pnpm --filter @git-webui/web dev`，后端：`pnpm --filter @git-webui/server dev`。Vite 会把 `/health` 和 `/api` 转发到 `127.0.0.1:3000`。
- 首次运行先执行 `pnpm typecheck && pnpm lint && pnpm test`。
- `DIRTY_WORKTREE`、`NO_UPSTREAM`、`NON_FAST_FORWARD`、`AUTH_REQUIRED` 和 `HOST_KEY_REQUIRED` 等错误会显示在 Operation Log；应用不会自动执行 force push、merge、rebase 或历史改写。
- 如果外部 Git 修改了仓库，watcher 会通过 SSE 触发状态、Locations、History 和 Diff 查询失效；查询 API 仍是真实状态入口。
- 数据库只保存仓库注册、设置、操作和审计记录。删除注册不会删除磁盘仓库；备份 SQLite 前应先停止服务或复制 WAL 相关文件后再归档。

当前仓库提供 pnpm 源码运行方式。Docker/Nginx 镜像、跨平台真机和真实浏览器验收需要在目标部署环境继续执行，不能用本地 typecheck 或 API 测试替代。
