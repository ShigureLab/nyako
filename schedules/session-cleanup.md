---
id: session-cleanup
cron: '0 5 * * *'
timezone: Asia/Shanghai
session: hub_neko
reset: false
task: scheduled.session_cleanup
---

执行一次每日 Session 清理。遵循当前 Hub Agent 定义的 `Session closeout` 规则；每日任务是
补查漏清，不替代日常交付后的及时归档。实际调用工具执行，不只回复“收到”或引用上轮摘要。

1. 先 `list_sessions` 获取当前非 archived 列表，对业务候选逐项 `get_session`。按 kind 和真实
   职责跳过 conversation、当前 Hub、长期系统/调度和由调用方清理的 task API 入口。
2. 核对当前 Hub 的 `nnp_list(direction="all",status="active")`，再按候选任务 correlationId
   用 `status="all"` 翻完原请求、全部补充、最终结果及向原请求方交付的历史。只看 active 页不能
   判断已完成任务；历史页有 nextBeforeSequence 就继续。工具输出截断或缺少原 owner 交付证据时，
   发关联原任务的核查 request，不读取其它 peer 的 inbox，不再以相同的“交付不明”结束一轮。
   核查回复回来后继续处理本轮候选；不得把这次核查算作原任务新待办。
3. 已完整交付且无具体剩余职责的一次性任务立即归档，包括诊断、负结果、顾问、全部补充已完成的
   复用任务。顾问不等下游 PR、用户 ACK、安装或部署；不得因为最近补查更新了 updatedAt 就重新
   等 7 天。PR owner 则须由 Monitor/Dev 新鲜核实 `MERGED` 或 `CLOSED`，并核销未交付事项；
   Hub 没有 GitHub 读取工具，缺证据时请求原 Dev 只读刷新。OPEN 保留唯一 canonical，职责与
   证据已移交的重复项归档，顾问不套用 PR owner 的保留条件。
4. 对尚无完成/承接证据的残留，7 天无活动、24 小时以上 timeout/failed/cancelled 或 smoke/test
   只能触发核查，不能代替完成判断。确认无具体可恢复工作、未交付结果和必要本地产物后归档；
   有真实待办则保留并说明动作、owner 和唤醒条件。证据不足须列缺口及核查 message id，继续追查。
5. 归档前保全必要工作树/证据，逐个调用 `archive_session` 传精确 sessionId，记录实际结果。
   单项失败记入 errors 并继续其余项，transient/busy 按 Hub 规则持久重试，不把失败冒充成功。
6. 最后重新 `list_sessions` 核对结果，输出 `checked` / `archived`（逐项 reason 与交付/终态证据）/
   `skipped_system` / `kept_canonical`（OPEN PR 等具体职责）/ `skipped_uncertain`（缺口、核查 id）/
   `errors`。有待核查项时摘要标明未完；后续回复继续收口，不能靠重复汇总把缺口拖到下一天。
