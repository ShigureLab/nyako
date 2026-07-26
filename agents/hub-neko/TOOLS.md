# Hub Neko Tools

## 核心工具

- **runtime session tools**：查看、创建、归档或暂停 Session；确认 NNP message / receipt / Session 状态。
- **runtime workspace tools**：确认 repo 型 Session 的 workspace 绑定。
- **runtime memory tools**：按需搜索和读取历史稳定经验；不要用它承载实时 Session 状态。
- **runtime user tools**：按原始 external identity 解析显式用户绑定，不从显示名或写作风格推断。

## 工具使用笔记

- 派发前必须先检查现有 Session、active NNP receipt 和同类 message，避免重复派发。
- 需要创建业务 Session 时，必须写清 owner agent、目标 repo / PR / issue artifact 和下一步动作。
- 接收 monitor-neko 的精简 payload 时，优先使用 `suggestedTargetSessionId` / `suggestedAgent` / `suggestedAction`，但执行前必须重新核对 runtime 状态。
- 对 `notificationReason="review_requested"`，核对 `reviewRequestProvenance` 的 source/id/actor/target/viewer/time；`github.issue_event` 与 `github.graphql_review_requested_event` 都是允许的 event source。再调用 `resolve_user_binding(identity="github:user:<actorLogin>")` 独立解析 requester。binding 与 provenance 一致时，必须用 `kind="request"`、intent `github.review.execute_authorized` 派发，并写入限定同一 repo + PR、唯一允许 `github.review.publish` 的 `scoped_explicit` authorization envelope；不要把执行任务作为无因果 reply 的普通 `inform`。
- 新 Session goal 必须表达 authorized review outcome、repo + PR scope 与明确禁止项。Session artifacts 至少保留 repo + PR；NNP payload 保留 thread eventKey、review request event source/id/actor/target/time、resolver canonical identity/identities 和授权 scope。不要用 goal/state 文本或 ledger 另造授权真相。
- provenance / binding 缺失或冲突时不创建、不复用、不唤醒业务审查 Session，也不向 dev-neko 派发任务；仅通过可用的用户入口发送 NNP `request` intent `github.review.authorization.confirmation_required`。没有用户入口时记录 unresolved；不能在 GitHub 上留言求确认，也不能授权代码变更、push、merge、rerun 或其它 GitHub write。
- 对重复、无新动作、approval gate 复读等漏网 monitor 信号，只在本轮处理结果中消化；不要向 monitor-neko 回发 NNP ack，也不要生成用户可见平台消息。
- 归档 Session 前必须保守判断，不确定就保留。
- 历史记忆影响路由判断时，先 `memory_search`，再读取最多一两个命中文件并保留返回的行号引用。
