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
- 对 user-facing `nyako` Session 发来的 exact PR direct command，先用当前上游 NNP 的实际 peer/message id 固定 `directUserRequest`，再对原始 `requester.identity` 调用 `resolve_user_binding`。确认 `found=true`、identity 与 canonical identity/identities 匹配且无冲突后，以 `authorization.basis="direct_user_command"`、`decision="scoped_explicit"` 和唯一允许同一 repo + PR `github.review.publish` 的 scope 派发 `github.review.execute_authorized`；该路径不要求 `reviewRequestProvenance`。
- 对 monitor 的 `notificationReason="review_requested"`，继续严格核对 `reviewRequestProvenance` 的 source/id/actor/target/viewer/time；`github.issue_event` 与 `github.graphql_review_requested_event` 都是允许的 event source。再调用 `resolve_user_binding(identity="github:user:<actorLogin>")` 独立解析 requester。binding 与 provenance 一致时，以 `authorization.basis="github_review_request"` 派发同一最小 scope。不得把 monitor 事件缺口降级成 direct-user authorization，也不得因为 direct-user request 缺少 GitHub 事件而套用 monitor 拒绝规则。
- 两条路径都必须用 `kind="request"`、intent `github.review.execute_authorized` 派发，不要使用无因果 reply 的普通 `inform`。新 Session goal 必须表达 authorization basis、authorized review outcome、repo + PR scope 与明确禁止项；Session artifacts 至少保留 repo + PR。NNP payload 按 basis 保留 direct source + requester binding 或 thread eventKey + review-request provenance + actor binding；不要用 goal/state 文本或 ledger 另造授权真相。
- 当前路径要求的 source / binding / scope 缺失或冲突时，不创建、不复用、不唤醒业务审查 Session，也不向 dev-neko 派发任务。monitor-originated provenance 失败仅通过可用用户入口发送 NNP `request` intent `github.review.authorization.confirmation_required`；direct-user 失败则对原 `kind=request` 显式 reply reason code。不能在 GitHub 上留言求确认，也不能授权代码变更、push、merge、rerun 或其它 GitHub write。
- 对重复、无新动作、approval gate 复读等漏网 monitor 信号，只在本轮处理结果中消化；不要向 monitor-neko 回发 NNP ack，也不要生成用户可见平台消息。
- 归档 Session 前必须保守判断，不确定就保留。
- 历史记忆影响路由判断时，先 `memory_search`，再读取最多一两个命中文件并保留返回的行号引用。
