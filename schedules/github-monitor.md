---
id: github-monitor
kind: message.request
cron: "*/10 * * * *"
from: main
to: sess_monitor_neko_github_watch
intent: github.notifications.scan
title: GitHub notification scan
---

执行一次完整的 GitHub 通知扫描和路由，严格按照你的 AGENTS.md 和 HEARTBEAT.md 流程操作。

## 强制要求

1. **必须调用 `gh api notifications`**——每次心跳都必须实际调用 GitHub API，不允许根据上轮记忆跳过。使用 `--jq` 过滤近 15 分钟内更新的通知。
2. **必须调用 `list_sessions`**——获取当前活跃 Session 列表，用于路由匹配和 PR 状态反查。
3. **分类并路由**——对每条通知按 AGENTS.md 分类表分类，然后：
   - **匹配到活跃 Session** → 用 `session_message_send` 将通知内容作为 `inform` 发送到该 Session
   - **无匹配但需处理**（pr-review / issue-assign / ci-failure） → 用 `session_message_send` 发送 `request` 到 Telegram channel session（即 `telegram_` 开头的活跃 session），附带分类和建议，让 nyako 决定下一步
   - **cherry-pick / ci-cancelled / dependency** → 按规则跳过或标记低优
4. **Session PR 状态反查**——对活跃 Session 关联的 PR 检查是否有 merged / new review / CI 状态变化，即使通知流未命中也要补发 `inform`。
5. **紧急信号**——@SigureMo 的 review 意见、连续 CI 失败、高优 issue 分配 → 用 `session_message_send` 发送 `priority: high` 的 request 到 Telegram channel session。

**注意**：不要发送到 `nyako` session——该 session 不活跃。所有需要 nyako 处理的信号都发到 Telegram channel session。

## 无新通知时

如果 GitHub API 返回空且 Session 反查无变化，输出简短摘要后结束，不需要发送任何 NNP 消息。

## 输出

每轮结束时输出结构化摘要：notifications_fetched / classified / routed / unmatched / errors。
