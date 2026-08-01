# Monitor Neko Tools

## GitHub

- `gh api notifications --paginate` 读取 unread inbox 并保留 thread id；不用 `all=true` 或
  最近时间窗，除非显式恢复/排障。
- `gh-llm` 读取非 ignored 上下文；auto-collapse authors 默认不展开。
- trusted / ignored actor 只按 `adapters/github/adapter.toml` 的 login 判断。
- 发送 comment/review 前，用 REST 或 GraphQL 精确 endpoint 再读一次 event 与 current head。

Native 路径只认 configured trusted actor 的最新 user-target review-request，且 target 确为当前 viewer；
REST `event=review_requested` 映射为 `github.review_requested` 或
`github.review_requested_event`，GraphQL 映射为 `github.graphql_review_requested_event`；
`github.issue_event` 无效。Natural-language 路径只认最后刷新、trusted actor 正文明确点名 viewer review
的 exact comment。两者都用 exact `{sourceEvent,classification,currentStatus?,relatedSessionId?}`；
review 路径必须带 `currentStatus.repo/pr`。

## Ledger and delivery

- exact event 的 `check`/`record` 传同一 `sourceEvent.type + id`，key 由
  `github_monitor_ledger` 决定；synthetic state 才传结构化 state。
- `shouldAct=false` 是硬停止。Ignored actor、approval-only 和已知同根因记录 suppressed。
- Durable NNP success 后调用 `record(outcome="routed", targetSessionId="hub_neko")`。
- 用 `gh api -X DELETE notifications/threads/<thread_id>` 消费已完成 thread。
- route 只发给 `session:hub_neko` 的 `kind="inform"`；payload 只含事实。
