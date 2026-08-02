# ADR-006：Commit Graph 绘制

- 状态：待 M2 锁定
- 决策：M0/M1 先保留 Graph lane 数据结构的扩展点，M2 使用 Canvas 或 SVG PoC 验证分页增量 lane 的性能后锁定实现。

在大历史仓库中，图线稳定性和内存占用比一次性返回完整历史更重要。
