---
id: session-cleanup
kind: session.run
cron: '0 5 * * *'
timezone: Asia/Shanghai
session: hub_neko
reset: false
task: scheduled.session_cleanup
---

请执行一次每日 session 清理。目标是归档已经完成、失效或已被其它 session 承接的旧 session，保持活跃 session 列表干净。

## 强制要求

1. 由当前中枢喵 session 负责执行清理；不要只回复“收到”，要实际检查并归档符合条件的 session。
2. 必须先调用 `list_sessions` 获取当前非 archived session 列表；对候选项调用 `get_session` 查看详情，并用 `session_message_list` 排除仍有 pending / running 请求或有效 waiter 的 session。
3. 必须跳过以下 session，不要归档：
   - 当前 session `hub_neko`
   - 平台 channel / bridge session，例如 `telegram_*`、`infoflow_*`、`bridge_*`
   - 长期系统/调度 session，例如 `sess_monitor_neko_github_watch`
   - 你核实后确认仍在进行中、仍有未交付结果或仍需等待外部信号的 session
4. 先为相似任务选出唯一的 canonical session，再处理旧重复项：
   - 同 repo 且同 PR / issue，或 title/topic/goal 明显属于同一工作流时，优先保留最新、有真实进展、持有 pending/running 请求或明确被继续使用的 session。
   - 其它更旧且已被 canonical session 承接的重复 session 应归档；“存在相似活跃任务”是归档旧重复项的证据，不是保留全部重复项的理由。
   - 如果无法判断哪一个是 canonical session，保留相关项并记入 `skipped_uncertain`。
5. 归档条件满足其一即可：
   - `PR 已终态`：session 明确关联某个 PR，使用 `gh pr view` / GitHub API 核实当前 `merged` 或 `closed`；没有 live 证据时不要把 monitor 文本或旧摘要单独当作终态证据。
   - `长期不活跃`：`updatedAt` 距现在已满 7 天，且没有 pending/running 请求、有效 waiter 或仍需交付的具体动作。
   - `旧 timeout / 失败残留`：最后执行已 timeout / failed / cancelled，距今已满 24 小时，且任务已被其它 session 承接、重复创建，或没有可恢复的具体产物与待交付动作。
   - `测试 / smoke 残留`：title/topic/goal 明确是 smoke、e2e、临时验证或重复测试，距今已满 24 小时且没有 pending/running 请求。
6. `Continue this session now.`、`Inspect the failed detached message and resume the session after fixing it.` 等运行时自动生成的泛化 next action，不构成单独保留理由。只有包含具体对象、外部等待条件或未交付结果的 next action 才按进行中处理。
7. 归档前逐项记录原因；实际归档时必须调用 `archive_session`，逐个传精确 `sessionId`。单个 session 因 workspace 清理等原因失败时，记录到 `errors` 并继续检查其它候选，不要让一次失败中断整轮清理。
8. 清理结束后输出结构化摘要：`checked` / `archived`（含 reason）/ `skipped_system` / `kept_canonical` / `skipped_uncertain` / `errors`

## 目标

- 归档 live 核实已 merged / closed 且没有未交付动作的 PR session
- 归档 7 天及以上无活动、旧 timeout / 失败残留和测试残留
- 相似任务只保留唯一 canonical session，清掉被承接的旧重复项
- 对无法确认 canonical 归属或仍有真实待办的 session 采取保守策略
