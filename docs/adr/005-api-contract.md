# ADR-005：API 契约

- 状态：已接受
- 决策：共享 Zod schema 作为运行时契约来源，并以共享 OpenAPI 文档对象作为生成基线。

Route 负责请求校验、身份和转换，Git 语义与数据组装留在 service 和 `git-core` package。
