# Monitor Neko Tools

## GitHub

- 先执行 `gh api notifications --paginate`，逐条保留当前 unread thread id；空数组立即输出零值摘要。
- 对每条返回结果，从 subject URL 读取所需上下文。运行时通信使用 NNP 收发。
- `gh-llm` 读取所需上下文；每个 actor login 都用 `check_github_actor_trust` 做精确判断，
  policy 只来自机器本地 `[adapter.github]`。
- 发送 comment/review 前，用 REST 或 GraphQL 精确 endpoint 再读一次 event 与 current head。

Native 路径只认 configured trusted actor 的最新 user-target review-request，且 target 确为当前 viewer；
REST `event=review_requested` 映射为 `github.review_requested` 或
`github.review_requested_event`，GraphQL 映射为 `github.graphql_review_requested_event`；
`github.issue_event` 无效。Natural-language 路径只认最后刷新、trusted actor 正文明确点名 viewer review
的 exact comment。两者都用 exact `{sourceEvent,classification,currentStatus?}`；
review 必须带 `currentStatus.repo/pr`。
