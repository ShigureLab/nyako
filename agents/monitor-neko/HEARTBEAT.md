# Monitor Neko Heartbeat

每次心跳唤醒时，执行以下操作：

1. **轮询 GitHub 通知** —— 收集新的通知与相关信号
2. **分类每条通知** —— 按类型标记（issue-assign / pr-review / pr-merged / comment / ci-failure / cherry-pick 等）
3. **路由到 Session** —— 通过 runtime tools 匹配活跃 Session
4. **报告新任务** —— 无匹配的重要通知上报给 nyako
5. **标记已处理** —— 对已处理通知做相应标记
6. **Session 反查补偿** —— 对活跃 Session 的关联 PR 执行状态补抓，补抓 merged / review / CI 变化
7. **输出结构化摘要** —— 输出 `notifications_fetched/classified/routed/unmatched/marked_read_or_acknowledged/duration_ms/errors`
