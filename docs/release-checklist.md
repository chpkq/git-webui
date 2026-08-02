# V0.1 发布验收清单

这份清单记录当前 checkout 的可复验结果，不把静态检查当作跨平台或浏览器部署证据。

## 本地验证

- [x] `corepack pnpm typecheck`
- [x] `corepack pnpm lint`
- [x] `corepack pnpm format:check`
- [x] `corepack pnpm test`：真实临时 Git 仓库、bare remote、边界路径、权限、同步和取消测试
- [x] `corepack pnpm exec playwright test tests/e2e --project=chromium`：注册仓库、Working Copy、URL 状态、面板尺寸保存、Stage/Unstage、Fetch/Pull/Push 和 Branch/Remote 管理
- [x] 默认配置绑定所有网卡，并保留远程监听门禁、session、CSRF 和登录限流
- [x] `Dockerfile`、`docker-compose.yml`、Nginx SSE 代理和 standalone 打包脚本已提交

## 2026-08-01 候选版验证记录

- 当前环境：macOS 14.6 arm64、Git 2.39.5、Node.js 24.18.0、pnpm 10.14.0、Docker Server 29.4.0。
- [x] `corepack pnpm typecheck`、`lint`、`format:check` 通过。
- [x] `corepack pnpm test` 并行执行通过：14 个测试文件、26 个测试；包含外部 Git 并发下遗留 `index.lock` 的回归测试。
- [x] `corepack pnpm exec playwright test tests/e2e --project=chromium` 通过：3 个场景，覆盖注册仓库、Working Copy、Stage/Unstage、Fetch/Pull/Push 和 Branch/Remote 管理。
- [x] 使用临时校验值执行 `docker compose config` 通过，确认 Compose 配置可展开；未写入真实 `.env`。
- [ ] standalone 依赖部署未完成：本地 pnpm store 缺少 `zod` tarball，离线模式明确报告 `ERR_PNPM_NO_OFFLINE_TARBALL`；未下载外部依赖。
- [ ] 未执行 `docker compose up -d --build`、真实挂载仓库、真实凭据和 HTTPS 反向代理验收。

## 目标部署环境仍需执行

- [ ] macOS、Linux、Windows 各执行一次启动、中文路径、Stage/Unstage、Fetch/Pull/Push
- [ ] 在装有 Docker daemon 的主机运行 `docker compose up -d --build`，检查 `/health`、登录和真实挂载仓库
- [ ] 在目标 HTTPS 反向代理和 Tailscale ACL 下验证 Secure Cookie、SSE、断线重连和权限
- [ ] 使用目标主机实际 SSH Agent 或 credential helper 完成 Push/Pull，并确认认证失败提示不泄漏凭据

未执行项目不能在发布说明中标记为“通过”；完成后应补充平台、Git 版本、Docker 版本和操作证据。
