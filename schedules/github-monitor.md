---
# Stable monitor behavior and tool policy live in agents/monitor-neko/{AGENTS,TOOLS}.md.
id: github-monitor
cron: '*/10 * * * *'
session: sess_monitor_neko_github_watch
reset: true
task: github.notifications.scan
---

执行一次真实 GitHub unread notifications 扫描；逐条处理本轮返回的 GitHub thread。遵循 monitor-neko 当前的 `AGENTS.md` / `TOOLS.md` 契约。

本次 schedule 没有上游 sender，不发送 no-op reply。

输出：notifications_fetched / classified / routed / duplicates_suppressed / unmatched / marked_done / duration_ms / review_requests_verified / review_requests_unverified / errors。
