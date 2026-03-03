# Monitor Neko Heartbeat

每次心跳唤醒（每 20 分钟），执行以下操作：

1. **轮询 GitHub 通知** — `gh api notifications --paginate -f all=true`
2. **分类每条通知** — 按类型标记（issue-assign / pr-review / pr-merged / comment / ci-failure / cherry-pick 等）
3. **路由到 Session** — 使用 `~/.nyako/bin/session_store.sh route` 匹配活跃 Session
4. **报告新任务** — 无匹配的重要通知上报给 nyako
5. **标记已处理** — 将已处理通知标记为已读
6. **Session 反查补偿** — 对活跃 Session 的关联 PR 执行 `gh pr view`，补抓 merged/review 状态变化
7. **输出结构化摘要** — 输出 `notifications_fetched/classified/routed/unmatched/marked_read/session_prs_checked/pr_merged_detected/duration_ms/errors`
