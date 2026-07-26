---
# Stable monitor behavior and tool policy live in agents/monitor-neko/{AGENTS,TOOLS}.md.
id: github-monitor
kind: session.run
cron: '*/10 * * * *'
session: sess_monitor_neko_github_watch
reset: true
task: github.notifications.scan
---

执行一次真实 GitHub unread inbox 扫描和活跃 Session PR 状态反查；遵循 monitor-neko 当前的 `AGENTS.md` / `TOOLS.md` 契约。

本次 schedule 没有上游 sender，不发送 no-op reply。

输出：notifications_fetched / classified / routed / duplicates_suppressed / unmatched / marked_done / duration_ms / review_authorization_candidates / review_authorization_confirmation_required / errors。
