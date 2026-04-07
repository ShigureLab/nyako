---
id: session-cleanup
kind: session.run
cron: '0 5 * * *'
timezone: Asia/Shanghai
session: telegram_1066949855
reset: false
task: scheduled.session_cleanup
---

请执行一次每日 session 清理。目标是归档已经完成且没有继续复用价值的 session，保持活跃 session 列表干净。

## 强制要求

1. 由当前 Telegram channel session 负责执行清理；不要只回复“收到”，要实际检查并归档符合条件的 session。
2. 必须先调用 `list_sessions` 获取当前非 archived session 列表；必要时再对候选项调用 `get_session` 查看详情。
3. 必须跳过以下 session，不要归档：
   - 当前 session `telegram_1066949855`
   - 默认入口 `nyako`
   - 长期系统/调度 session，例如 `sess_monitor_neko_github_watch`
   - 你无法确认是否仍在进行中的 session
4. 归档条件满足其一即可：
   - `PR 已 merged`：session 明确关联某个 PR，且 runtime 已知信息里已经明确显示该 PR 已 merged / 已合并 / merge 完成 / monitor 的 `pr-merged` 信号已处理；同时不存在“相似性任务”活跃 session
   - `长期不活跃`：session 的 `updatedAt` 距现在已满 7 天；同时不存在“相似性任务”活跃 session
5. “相似性任务”按保守规则判断，只要存在以下任一情况，就视为仍有相似任务，不要归档原 session：
   - 同 repo 且同 PR
   - 同 repo 且同 issue
   - 同 repo 且 title/topic/goal 明显是在继续同一工作流
6. 对关联 PR 的 session，如果无法从 runtime 已知信息中确认 PR 已 merged，就不要靠猜测归档；只有明确已 merged 才按该规则归档。
7. 对 7 天及以上不活跃的 session，也要先看它是否仍有清晰的下一步动作、等待回复、或被其他活跃 session 承接；拿不准就保留。
8. 实际归档时，必须调用 `archive_session`，逐个传精确 `sessionId`；不要归档当前 session。
9. 清理结束后输出结构化摘要：`checked` / `archived` / `skipped_system` / `skipped_similar` / `skipped_uncertain`

## 目标

- 归档已经 merged 且无相似性任务的 PR session
- 归档 7 天及以上无活动且无相似性任务的 session
- 对拿不准的 session 采取保守策略，宁可保留，不要误归档
