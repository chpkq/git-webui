# ADR-004：SQLite 实现

- 状态：已接受
- 决策：使用 Node.js 22.12+ 提供的 `node:sqlite` `DatabaseSync`，避免 V0.1 引入平台相关的 native addon。

SQLite 只保存 repositories、settings、operations、audit_logs 和可选 UI state，不保存 Commit、Branch、Remote 或 Working Tree 的真实状态。
