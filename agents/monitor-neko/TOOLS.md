# Monitor Neko Tools

## GitHub

- 用 `bash` 执行 `gh api notifications --paginate` 读取 unread inbox，并保留 thread id；
  不加 `all=true` 或任意最近时间窗。
- `all=true&since=...` 只用于显式恢复/排障。
- 用 `gh-llm` 读取非 ignored 上下文；配置中的 auto-collapse authors 默认不展开。
- trusted / ignored actor 只按 `adapters/github/adapter.toml` 的精确 login 判断。
- 发送 comment/review 前，用 REST 或 GraphQL 精确 endpoint 再读一次 event 与 current head。

Review request provenance 必须由当前 viewer 的最新 user-target
`github.issue_event` 或 `github.graphql_review_requested_event` 提供；始终成对保留 source
和 id。

## Ledger and delivery

- `github_monitor_ledger(check)` 接收结构化 canonical state；不要手写 digest。
- `shouldAct=false` 是硬停止。Ignored actor、approval-only 和已知同根因记录 suppressed。
- Durable NNP success 后调用 `record(outcome="routed", targetSessionId="hub_neko")`。
- 用 `gh api -X DELETE notifications/threads/<thread_id>` 消费已完成 thread。
- 所有 route 都是发给 `session:hub_neko` 的 `kind="inform"`；payload 只含事实字段。
