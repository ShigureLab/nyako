---
id: github-monitor
kind: message.request
cron: "*/10 * * * *"
from: main
to: sess_monitor_neko_github_watch
intent: github.notifications.scan
title: GitHub notification scan
---

执行一次完整的 GitHub 通知扫描和路由，严格按照你的 AGENTS.md 流程操作。

## 强制要求

1. **必须调用 `gh api notifications`**——每次心跳都必须实际调用 GitHub API，不允许根据上轮记忆跳过。时间窗口必须通过 `date` 命令动态计算，禁止从上下文复制旧时间戳。参考命令：
   ```bash
   gh api "notifications?all=true&since=$(date -u -v-15M +%Y-%m-%dT%H:%M:%SZ)" --jq '.[] | {reason, title: .subject.title, repo: .repository.full_name, updated: .updated_at, url: .subject.url}'
   ```
2. **必须获取完整上下文**——对于每条通知，必须通过 `gh-llm pr view` 或 `gh-llm issue view` 获取完整的上下文信息，包括 PR 的 review 状态、CI 状态、是否 merged，以及 issue 的标签和 assignee 等等，以了解除去通知文本之外的关键信息，确定通知所针对的目标是否是自己，以及是否需要处理。
2. **必须调用 `list_sessions`**——获取当前活跃 Session 列表，用于路由匹配和 PR 状态反查。
3. **分类并路由**——对每条通知按 AGENTS.md 分类表分类，然后：
   - `pr-review`：review request、新 review 提交、bot review；不要和 human mention/comment 混类
   - `comment`：trusted human mention/comment，以及活跃 review Session 上 PR 未 merged 的普通回复 / `author` 通知
   - `pr-merged`：通知流明确显示已 merged，或对 `author` / reply 类通知反查后确认已 merged
   - **匹配到活跃 Session** → 用 `session_message_send` 将通知内容作为 `inform` 发送到该 Session
   - **活跃 review Session 上的普通回复 / `author` 通知** → 即使没有 @，也要路由到对应 Session
   - **无匹配但需处理**（`pr-review` / `issue-assign` / `ci-failure` / trusted human `comment`） → 用 `session_message_send` 发送 `request` 到 Telegram channel session（即 `telegram_` 开头的活跃 session），附带分类和建议，让 nyako 决定下一步
   - **cherry-pick / ci-cancelled / dependency** → 按规则跳过或标记低优
4. **Session PR 状态反查**——对活跃 Session 关联的 PR，以及所有 `author` / reply 类通知，检查是否有 merged / new review / CI 状态变化；已 merged 时优先补发 `pr-merged inform`，未 merged 且处于活跃 review Session 时普通回复也要补路由。
5. **紧急信号**——@SigureMo 的 review 意见、连续 CI 失败、高优 issue 分配 → 用 `session_message_send` 发送 `priority: high` 的 request 到 Telegram channel session。
6. **交付语义**——凡是需要上游知晓的结果，必须已经通过 `session_message_send` 显式发送 `inform` / `reply`；凡是需要 nyako 决策或派发下一步的，必须显式发送 `request`；如果本轮还需要对 `from: main` 回报扫描结论，用 `reply`，不要拿最后的文本摘要代替。

**注意**：不要发送到 `nyako` session——该 session 不活跃。所有需要 nyako 处理的信号都发到 Telegram channel session。

## 无新通知时

如果 GitHub API 返回空且 Session 反查无变化，输出简短摘要后结束；但如果本轮被要求向 `from: main` 回报执行结果，则这个 no-op 结果也要显式 `reply`，不要只留文本输出。

## 输出

每轮结束时输出结构化摘要：notifications_fetched / classified / routed / unmatched / errors。
