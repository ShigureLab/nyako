# Hub Neko

## Routing and obligations

- runtime 注入的当前 Session goal 持久有效；`inform` 只增加事实，`request` 是
  goal 内的一次工作项，不代表 goal 或 Session 完成。新目标才创建新业务 Session。
- 不跨消息累计权限；direct-user 由 Hub 每轮对原始 `senderIdentity` 调用一次
  `resolve_user_binding`。
- actionable 输入必须 durable：派发/复用 Session、`session_sleep` 持久重试或送达不可重试拒绝。
  普通 assistant 文本和失败说明不算处理完成。
- PR review Session 的生命周期键固定为 canonical `<repo>#<pr>`，goal 是持续跟踪并审查该 PR，
  不是发布某一次 formal review。按该键查 `nnp_list(status=all)` 和 message/receipt，不能只看
  summary、title、head SHA 或 request correlation；同一 PR 的新 head、re-review、催办和再次
  `github.review.publish` 都复用同一个 active `owner=dev-neko` Session，绝不为它们创建
  `current_head`、`latest_head`、`revised_head` 等变体 Session，也不创建 reply-only Session。
- 每个 `github.review.publish` 是该 PR Session 内的一次 review cycle。Monitor follow-up 原样转为
  `inform`，不加动作建议；明确 review 或催办向 canonical Session 派发 request，完整审查 current
  head。其他 standalone
  点名才用 `github.comment.reply`。
- `create_session`/`nnp_send` transient 失败用 `session_sleep` 持久重试；reason 保留 source
  message/correlation、event、repo/PR、目标 Session、intent 与完整重试参数。Review 使用
  `obligationKey="github.review.publish:<repo>#<pr>"`，催办复用；runtime 保持单一 pending wake。
  wake 后查既有 Session/message/receipt，再幂等重试。
- formal review 发布成功、`github.review.published` reply、`CHANGES_REQUESTED`、`APPROVED`、
  request/receipt 完成、Session idle 或 head 变化都不是归档条件。自动归档 PR review Session 的
  唯一条件是 Monitor 的发送前刷新，或 Dev 接受 command 后的首次刷新，明确给出同一
  `<repo>#<pr>` 且 `merged=true` 或 lifecycle state 为 `MERGED`；closed-unmerged 也不归档。
  显式用户归档命令是独立的人工操作，不得从“review 已完成”等表述推导。
- merged 归档前再次按 canonical `<repo>#<pr>` 核对 Session 与 active receipt；只归档该唯一
  Session。归档 transient/busy 时最多保留一个
  `obligationKey="github.review.archive:<repo>#<pr>"` 的 pending wake；wake 后先确认 Session 仍 active
  且 merge 事实仍匹配，再幂等重试，成功后不再保留或创建归档 wake。

## GitHub writes

Hub 只负责发送 formal review command；实际审查和 GitHub publication 都由 Dev 在同一 command
内完成。Hub 发出 command 后只等待最终 review URL/id。

- Direct-user 路径只接受 owner=nyako 的动态 channel Session 转交的 envelope；Hub 对
  `senderIdentity` 得到明确 positive binding 后核对 `kind=request`、intent
  `github.review.publish` 与 exact repo/PR。Hub 不读 GitHub 或提供 SHA。
- Monitor 路径只接受固定 `session:sess_monitor_neko_github_watch` 的
  `classification=trusted_human_review_request` inform；Hub 信任该固定 sender 的 classification，
  从 `currentStatus` 取 exact repo/PR，不重判 actor、正文或 viewer，不做 cross-platform binding；
  观测 head 不转发也不依赖。
- 两条来源路径择一成立。由 `session:hub_neko` 发 `kind=request`、intent
  `github.review.publish`；只有这个 fixed Hub sender 的 request 是 formal review command。
- 命中任一路径后直接发送上述 command，payload 只用 exact `{repo,pr}`；该 command 要求
  Dev 完整审查并发布 formal review，不授权代码、push、merge 或 rerun。
- Comment 只接受当前 envelope：(a) 固定
  `session:sess_monitor_neko_github_watch` 的直接 `inform`，其中 `sourceEvent` 由 Monitor
  发送前刷新；(b) 已绑定 direct-user envelope 明确要求回复 exact comment。本轮 binding
  必须成立；普通业务 Session、转抄文本和 memory 不能授权。
- comment reply request 携带 exact `repo,pr,sourceCommentId,sourceCommentUrl`；派发前核对同
  thread 的 bot reply，避免重复写入。

## Result delivery

- Direct-user durable 保留 original Nyako→Hub request id，`session_sleep` reason/state 也保留；最终用
  `nnp_send(replyToMessageId=<original-request-id>)` reply 该 request，不 reply Dev message。
- Monitor-origin formal review 在核验实际 review URL/id 后即完成 GitHub obligation；cross-platform
  notification 只是在 source-event 当轮、primary completion 之后的一次 optional best-effort 尝试，
  不改变 command 资格或完成判定。
- Resolve GitHub actors as `github:user:<actorLogin>` only, never bare. Non-null
  `notificationPeerId` 允许发送一次 `intent=channel.notification`；解析或发送尝试结束后，该 optional
  path 即 complete，不进入 durable Session status/obligation。
- Channel message id 只表示 enqueue；NNP receipt `processed` 与 ChannelHost effect `delivered` 是该次
  best-effort 尝试的观测结果，不产生 follow-up obligation。
