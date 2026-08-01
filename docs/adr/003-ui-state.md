# ADR-003：前端 UI 状态

- 状态：已接受
- 决策：使用 Zustand 保存面板尺寸、当前仓库、Ref、选中 Commit 和 Diff 偏好等 UI 状态；服务器数据由 TanStack Query 管理。

两类状态分开，避免把 Git 查询结果复制成不可验证的客户端真相源。
