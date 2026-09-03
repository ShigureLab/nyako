# Monitor Neko Tools

## GitHub

- 先执行 `gh api notifications --paginate`，逐条保留当前 unread thread id；空数组立即输出零值摘要。
- 对每条返回结果，从 subject URL 读取所需上下文。运行时通信使用 NNP 收发。
- `gh-llm` 读取所需上下文；trusted actor 只按 `adapters/github/adapter.toml` 的 login 判断。
- 发送 comment/review 前，用 REST 或 GraphQL 精确 endpoint 再读一次 event 与 current head。

Native 路径只认 configured trusted actor 的最新 user-target review-request，且 target 确为当前 viewer；
REST `event=review_requested` 映射为 `github.review_requested` 或
`github.review_requested_event`，GraphQL 映射为 `github.graphql_review_requested_event`；
`github.issue_event` 无效。Natural-language 路径只认最后刷新、trusted actor 正文明确点名 viewer review
的 exact comment。两者都用 exact `{sourceEvent,classification,currentStatus?}`；
review 必须带 `currentStatus.repo/pr`。

## Ledger and delivery

- exact event 的 `check`/`record` 传同一 `sourceEvent.type + id`，key 由
  `github_monitor_ledger` 决定；synthetic 只传当前 unread 的 `github:thread:<thread_id>`。
- `shouldAct=false` 是硬停止。Approval-only 和已知同根因记录 suppressed。
- Durable NNP success 后调用 `record(outcome="routed", targetSessionId="hub_neko")`。
- 完成后 DELETE `notifications/threads/<thread_id>`；route 只发给 `session:hub_neko` 的
  `kind="inform"`，payload 只含事实。
