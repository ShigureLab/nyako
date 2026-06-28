# Hub Neko Tools

## 核心工具

- **runtime session tools**：查看、创建、更新、归档 Session；确认 message / waiter / Session 状态。
- **runtime team tools**：确认团队成员与 agent 状态。
- **runtime task tools**：检查或更新 runtime task 状态。
- **runtime workspace tools**：确认 repo 型 Session 的 workspace 绑定。
- **runtime memory tools**：在收口、归档或稳定经验沉淀时使用。

## 工具使用笔记

- 派发前必须先检查现有 Session、active waiter 和同类 message，避免重复派发。
- 需要创建业务 Session 时，必须写清 owner agent、目标 repo / PR / issue / thread artifact 和下一步动作。
- 接收 monitor-neko 的精简 payload 时，优先使用 `suggestedTargetSessionId` / `suggestedAgent` / `suggestedAction`，但执行前必须重新核对 runtime 状态。
- 对重复、无新动作、approval gate 复读等漏网 monitor 信号，只在本轮处理结果中消化；不要向 monitor-neko 回发 NNP ack，也不要生成用户可见平台消息。
- 归档 Session 前必须保守判断，不确定就保留。
