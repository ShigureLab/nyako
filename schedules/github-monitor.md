---
id: github-monitor
kind: session.run
cron: '*/10 * * * *'
session: sess_monitor_neko_github_watch
reset: true
task: github.notifications.scan
---

执行一次完整的 GitHub 通知扫描和路由，严格按照你的 AGENTS.md 流程操作。

## 强制要求

1. **必须调用 `gh api notifications`**——每次心跳都必须实际调用 GitHub API，不允许根据上轮记忆跳过。默认扫描当前 inbox 中尚未完成的通知，不要只截最近 `15m` 时间窗口；必须拿到每条通知的 thread id，后续在成功处理后标记 `done`。参考命令：
   ```bash
   gh api notifications --paginate --jq '.[] | {id, reason, unread, title: .subject.title, repo: .repository.full_name, updated: .updated_at, url: .subject.url}'
   ```
2. **必须先做 ledger 判重**——对每条通知或补生成状态事件，先调用 `github_monitor_ledger` 的 `action="check"`。`eventKey` 要稳定表示同一线程/事件，`stateDigest` 要反映当前 review/CI/merged 等可行动状态；不要靠会话记忆判断重复或是否已处理。对 GitHub inbox 通知，`eventKey` 应至少包含 `thread_id`。
3. **必须获取完整上下文**——对于每条通知，必须通过 `gh llm pr view` 或 `gh llm issue view` 获取完整的上下文信息；如果 `gh llm` 不可用，再尝试 `gh-llm ...`。上下文至少要覆盖 PR 的 review 状态、CI 状态、是否 merged，以及 issue 的标签和 assignee 等，以了解除去通知文本之外的关键信息，确定通知所针对的目标是否是自己，以及是否需要处理。
4. **必须调用 `list_sessions`**——获取当前活跃 Session 列表，用于路由匹配和 PR 状态反查。
5. **分类并路由**——对每条通知按 AGENTS.md 分类表分类，然后：
   - `pr-review`：review request、新 review 提交、bot review；不要和 human mention/comment 混类
   - `comment`：trusted human mention/comment，以及活跃 review Session 上 PR 未 merged 的普通回复 / `author` 通知
   - `pr-merged`：通知流明确显示已 merged，或对 `author` / reply 类通知反查后确认已 merged
   - **匹配到活跃 Session** → 用 `session_message_send` 将通知内容作为 `inform` 发送到该 Session
   - **活跃 review Session 上的普通回复 / `author` 通知** → 即使没有 @，也要路由到对应 Session
   - **无匹配但需处理**（`pr-review` / `issue-assign` / `ci-failure` / trusted human `comment`） → 用 `session_message_send` 发送 `request` 到 Telegram channel session（即 `telegram_` 开头的活跃 session），附带分类和建议，让 nyako 决定下一步
   - **cherry-pick / ci-cancelled / dependency** → 按规则跳过或标记低优
6. **Session PR 状态反查**——对活跃 Session 关联的 PR，以及所有 `author` / reply 类通知，检查是否有 merged / new review / CI 状态变化；已 merged 时优先补发 `pr-merged inform`，未 merged 且处于活跃 review Session 时普通回复也要补路由。
7. **紧急信号**——@SigureMo 的 review 意见、连续 CI 失败、高优 issue 分配 → 用 `session_message_send` 发送 `priority: high` 的 request 到 Telegram channel session。
8. **交付语义**——凡是需要下游 Session 知晓的结果，必须已经通过 `session_message_send` 显式发送 `inform` / `reply`；凡是需要 nyako 决策或派发下一步的，必须显式发送 `request`；这条 schedule 直接唤起当前 Session，不存在上游 sender，不要为了定时心跳补发无意义 `reply`。
9. **必须记录处理结果**——对已经成功派发的事件，立即调用 `github_monitor_ledger` 的 `action="record"` 并记录 `outcome="routed"`；对明确决定忽略且后续不应重复上报的事件，记录 `outcome="suppressed"`。如果发送失败，不要记录。
10.   **必须消费 inbox 通知**——凡是本轮已经成功处理完的 GitHub inbox 通知，无论是已路由还是明确抑制，都必须在最后用 thread id 调 `gh api -X DELETE notifications/threads/<thread_id>` 标记为 `done`。GitHub 里的 `done` 不是 `read`；不要只做 `PATCH .../threads/<thread_id>` 标记已读。只有在处理失败、路由失败、上下文未拿全时，才允许保留未完成状态以便下轮继续处理。

**注意**：不要发送到 `nyako` session——该 session 不活跃。所有需要 nyako 处理的信号都发到 Telegram channel session。

## 无新通知时

如果 GitHub API 返回空且 Session 反查无变化，输出简短摘要后结束；不要仅因为这是一次定时心跳就额外补发 no-op `reply`。

## 输出

每轮结束时输出结构化摘要：notifications_fetched / classified / routed / unmatched / marked_done / errors。
