# Git WebUI

Git WebUI 是一个直接操作部署机器真实 Git Working Tree 的轻量 Web Client，不是 Git 托管平台。

## 当前状态

项目按 `project-execution-plan.md` 的 M0 至 M6 顺序开发。默认服务只监听 `127.0.0.1`，Git CLI 是仓库状态的唯一真相源。

当前基线包含：

- pnpm workspace monorepo；
- React、TypeScript、Vite 前端和 Fastify 后端；
- 共享 API 错误 schema 与基础 OpenAPI 文档对象；
- Git 子进程安全执行器的基础实现；
- 三栏工作台空壳与 `/health` 健康检查。

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
