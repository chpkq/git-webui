# Git WebUI

Git WebUI 是一个直接操作部署机器真实 Git Working Tree 的轻量 Web Client，不是 Git 托管平台。

## 当前状态

项目按 `project-execution-plan.md` 的 M0 至 M6 顺序开发。后端默认绑定 `0.0.0.0`，但只有显式开启远程门禁并配置鉴权后才会启动；Git CLI 是仓库状态的唯一真相源。

V0.1 当前实现包含：

- pnpm workspace monorepo；
- React、TypeScript、Vite、TanStack Query、Zustand 和 Monaco Diff 前端；
- Fastify 后端、SQLite 注册/操作/审计存储和共享 API schema；
- 真实 Git Working Tree 的查询、分页历史、Diff、Stage/Unstage；
- Fetch All + Prune、ff-only Pull、显式目标 Push/upstream；
- Remote/Branch 管理、操作队列、操作日志、SSE 进度和 `repo.changed` 刷新；
- 默认绑定所有网卡，但必须显式配置 session、CSRF、限流和角色门禁后才允许启动。

## 开发环境

- Node.js 22.12 或更高版本；
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

打开 <http://127.0.0.1:5173> 查看前端。后端默认绑定 `0.0.0.0:3000`，本机可通过 <http://127.0.0.1:3000> 访问。

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
- Remote URL 中的用户名、密码、Token 和常见凭据查询参数会在写入 Git 配置前被拒绝。
- 所有 ref、remote、branch、commitish 和仓库内路径都作为独立参数传给 Git，子进程使用 `shell=false`。
- 注册仓库和每次查询/写操作都会重新检查真实路径与 `allowedRoots`，防止注册后的 symlink 逃逸。

## 运行与故障排查

- 前端开发服务器：`pnpm --filter @git-webui/web dev`，后端：`pnpm --filter @git-webui/server dev`。Vite 会把 `/health` 和 `/api` 转发到 `127.0.0.1:3000`。
- 首次运行先执行 `pnpm typecheck && pnpm lint && pnpm test`。
- 主窗口支持 `Ctrl/Cmd + Shift + U` 更新、`Ctrl/Cmd + Shift + P` Pull、`Ctrl/Cmd + Shift + S` Push；输入框获得焦点时不会拦截快捷键。
- `DIRTY_WORKTREE`、`NO_UPSTREAM`、`NON_FAST_FORWARD`、`AUTH_REQUIRED` 和 `HOST_KEY_REQUIRED` 等错误会显示在 Operation Log；应用不会自动执行 force push、merge、rebase 或历史改写。
- 如果外部 Git 修改了仓库，watcher 会通过 SSE 触发状态、Locations、History 和 Diff 查询失效；查询 API 仍是真实状态入口。
- 数据库只保存仓库注册、设置、操作和审计记录。删除注册不会删除磁盘仓库；备份 SQLite 前应先停止服务或复制 WAL 相关文件后再归档。

## 发布运行方式

### pnpm/npm 兼容的源码方式

仓库使用标准 `package.json` scripts，可由 pnpm 或 npm 兼容调用。生产启动前先构建：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
GIT_WEBUI_ALLOWED_ROOTS=/Users/you/src \
GIT_WEBUI_DATABASE=/Users/you/.local/share/git-webui/data.sqlite \
corepack pnpm --filter @git-webui/server start
```

前端可由 Nginx、Caddy 或其他静态文件服务器发布 `apps/web/dist`，并将 `/api`、`/health` 反向代理到后端 `127.0.0.1:3000`。

### Standalone 目录包

Standalone 包包含后端生产依赖、前端静态文件和单进程启动代理，输出目录带有 V0.1 版本号：

```bash
corepack pnpm package:standalone
cd release/git-webui-v0.1.0
GIT_WEBUI_ALLOWED_ROOTS=/Users/you/src \
GIT_WEBUI_AUTH_ENABLED=true \
GIT_WEBUI_AUTH_PASSWORD='change-this-long-password' \
GIT_WEBUI_SESSION_SECRET='use-a-random-secret-at-least-32-chars' \
node start.mjs
```

默认访问 <http://127.0.0.1:4173>。Standalone 启动器只把后端绑定到本机回环地址；需要 LAN/Tailscale 访问时，应放在 HTTPS 反向代理之后，并完成登录、CSRF 和权限配置。

### Docker Compose + Nginx

Docker 方式把宿主机工作区映射到容器内 `/workspaces`，并由 `GIT_WEBUI_ALLOWED_ROOTS=/workspaces` 限定可注册范围；SQLite 数据保存于 named volume。先复制配置并填写真实路径、密码和随机 session secret：

```bash
cp .env.example .env
corepack pnpm exec prettier --check docker-compose.yml
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

默认只将 Nginx 发布到 `127.0.0.1:8080`。通过反向代理或 Tailscale 暴露时，保持 Web 端口在本机，启用 HTTPS 后把 `GIT_WEBUI_COOKIE_SECURE=true`。容器内的 Git 不会自动获得宿主机 SSH Agent、credential helper 或用户级 Git 配置；需要 Push/Pull 时，应按部署平台的安全方式显式提供 SSH Agent/凭据，应用本身仍不保存这些秘密。

备份 Docker 数据前停止后端容器，备份 `/var/lib/git-webui` 对应的 named volume；恢复后再启动服务。不要只复制正在写入的 SQLite 主文件而忽略 WAL 文件。

## LAN、Tailscale 与反向代理边界

- 本机开发后端默认绑定 `0.0.0.0`；Standalone 启动器仍显式绑定 `127.0.0.1`。
- 后端绑定非回环地址必须设置 `GIT_WEBUI_ENABLE_REMOTE=true`、密码、session secret 和角色；缺少任一项服务会拒绝启动。
- 更推荐由 Nginx/Caddy/Traefik 终止 HTTPS，再转发 `/`、`/api` 和 `/health`；反向代理必须支持 SSE，关闭 `/api/operations/events` 的缓冲并提高读取超时。
- Tailscale ACL、HTTPS 证书和主机防火墙属于部署层控制，不能替代 WebUI 登录、角色校验和 CSRF。

完整发布门禁和当前环境未执行的跨平台项目见 [docs/release-checklist.md](./docs/release-checklist.md)。
