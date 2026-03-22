---
id: github-monitor
kind: message.request
cron: "*/10 * * * *"
from: main
to: sess_monitor_neko_github_watch
intent: github.notifications.scan
title: GitHub notification scan
---

Scan GitHub for new notifications or mentions. If there is anything new since the previous check, send an explicit NNP reply to telegram channel with a concise summary and enough context to act. If there is nothing new, stay quiet. Do not repeat already-reported items.
