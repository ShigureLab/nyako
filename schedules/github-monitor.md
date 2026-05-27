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

1. **必须调用 `gh api notifications`**——每次心跳都必须实际调用 GitHub API，不允许根据上轮记忆跳过。主输入只扫描当前 unread inbox；不要用 `all=true` 作为心跳主输入，也不要只截最近 `15m` 时间窗口。必须拿到每条通知的 thread id，后续在成功处理后标记 `done`。GitHub REST 不返回 `done` 状态；`all=true` 会返回已读 / 历史 thread，不能据此判断“未完成”或“需要路由”。参考命令：
   ```bash
   gh api notifications --paginate --jq '.[] | {id, reason, unread, title: .subject.title, repo: .repository.full_name, updated: .updated_at, url: .subject.url}'
   ```
2. **`all=true` 只能做恢复扫描**——只有在需要恢复“被其它客户端提前标已读”的通知、或排查丢失时，才允许低频 / 显式调用 `gh api 'notifications?all=true&since=<last_successful_scan_at>'`。恢复扫描命中的 `unread=false` thread 默认视为历史/已读候选，必须先做 ledger 判重并获取完整上下文；只有确认出现未处理的真实可行动状态转变（新 human review/comment、新 head、merged/closed、approval gate 变化、CI failure fingerprint 变化）时才允许路由。否则记录 `suppressed`，必要时 DELETE 消费，但禁止向 Telegram 发送“旧 CI / 已路由 / 无新动作”的 request。
3. **必须先做 ledger 判重和本轮合并**——对每条通知或补生成状态事件，先构建本轮 canonical event map，再调用 `github_monitor_ledger` 的 `action="check"`。map key 必须是 `eventKey + stateDigest`；同一个 GitHub thread 的最新可行动 comment/review、或同一个 session-pr fingerprint 在本轮出现多次时，只允许保留一个候选进入路由，其余候选在摘要中列为 `duplicates_suppressed`。GitHub inbox 通知的 `eventKey` 必须使用规范格式 `github:thread:<thread_id>`，不要发明 `gh-thread:*` / `github-notification:*` 等别名。Session PR 状态反查事件使用 `github:session-pr:<session_id>:<repo>#<pr>` 这类稳定 key。`stateDigest` 只包含可行动状态：head sha、merged/closed、review decision、最新可行动 review/comment id、CI failed check name fingerprint；不要包含时间戳、轮询次数、临时 in-progress 细节、已失败检查数量这类会导致重复上报的噪声。不要靠会话记忆判断重复或是否已处理。
4. **ignored actor 硬忽略**——如果通知、review、comment 或状态上下文的作者 / 触发者 login 命中 `runtime.toml` 的 `[policy.github_monitor].ignored_actor_logins`，必须把 `actorLogin` 设为该 login 调用 `github_monitor_ledger action="check"`；ledger 会返回 `isIgnoredActor=true`、`shouldAct=false` 并自动 suppressed。此类事件不获取更多深度上下文、不调用 `session_message_send`、不发 Telegram request；只在最后 DELETE 对应 inbox thread 标记 done。
5. **non-trusted comment 只抑制 comment 维度**——如果 thread 最新 human comment / mention 来自非 trusted 用户，只能抑制该 comment 本身；DELETE thread 前仍必须检查完整上下文中是否存在新 review request、非 ignored review、活跃 session 普通回复、CI/merged 状态变化等其它可行动事件。存在则按对应分类路由，不能因为最新 comment 非 trusted 就吞掉整条 thread。
6. **必须获取完整上下文并折叠噪声作者**——对于非 ignored actor 的每条通知，必须通过 `gh llm pr view` 或 `gh llm issue view` 获取完整的上下文信息（使用方式参考 github-conversation skill）；如果 `gh llm` 不可用，再尝试 `gh-llm ...`。调用 `pr view` / `issue view` / timeline expand 时，必须把 `runtime.toml` 的 `[policy.github_context].auto_collapse_author_logins` 转成 `--auto-collapse-author <login>` 参数，例如 `--auto-collapse-author PaddlePaddle-bot`，让 gh-llm 自动折叠这些作者的 timeline comment/review。上下文至少要覆盖 PR 的 review 状态、CI 状态、是否 merged，以及 issue 的标签和 assignee 等，以了解除去通知文本之外的关键信息，确定通知所针对的目标是否是自己，以及是否需要处理。
7. **必须调用 `list_sessions`**——获取当前活跃 Session 列表，用于路由匹配和 PR 状态反查。
8. **分类并路由**——对每条非 ignored-bot 通知按 AGENTS.md 分类表分类，然后：
   - `pr-review`：review request、新 review 提交、非 ignored bot review；不要和 human mention/comment 混类
   - `comment`：trusted human mention/comment，以及活跃 review Session 上 PR 未 merged 的普通回复 / `author` 通知
   - `pr-merged`：通知流明确显示已 merged，或对 `author` / reply 类通知反查后确认已 merged
   - **匹配到活跃 Session** → 用 `session_message_send` 将通知内容作为 `inform` 发送到该 Session
   - **活跃 review Session 上的普通回复 / `author` 通知** → 即使没有 @，也要路由到对应 Session
   - **无匹配但需处理**（`pr-review` / `issue-assign` / `ci-failure` / trusted human `comment`） → 用 `session_message_send` 发送 `request` 到 Telegram channel session（即 `telegram_` 开头的活跃 session），附带分类和建议，让 nyako 决定下一步
   - **cherry-pick / ci-cancelled / dependency** → 按规则跳过或标记低优
9. **Session PR 状态反查**——对活跃 Session 关联的 PR，以及所有 `author` / reply 类通知，检查是否有 merged / new review / CI 状态变化；已 merged 时优先补发 `pr-merged inform`，未 merged 且处于活跃 review Session 时普通回复也要补路由。没有真实可行动状态转变时必须保持静默，不要向 Telegram 发送“仍在失败 / 已经路由 / 等待 approval”的状态复读。本轮已经为同一 `repo#PR` 新路由 review/comment request 时，不要再向该 Session 追加 approval-only 或 unchanged-CI `inform`；把这些状态并入原始 request payload。
10.   **CI 失败聚合**——CI failure 以 `repo + PR + head_sha + failed_check_names` 作为 fingerprint。匹配到活跃 dev Session 时只向该 Session 发一次 `inform`；无匹配时只向 Telegram 发一次 `request`。同一 fingerprint 后续轮询命中必须由 ledger 抑制，除非 head sha 或 failed check set 发生变化。连续 CI 失败只在首次确认连续失败时作为 high priority，不要每轮重复升级。
11.   **紧急信号**——@SigureMo 的 review 意见、高优 issue 分配、首次确认的连续 CI 失败 → 用 `session_message_send` 发送 `priority: high` 的 request 到 Telegram channel session。已经发给活跃 dev Session 且无新决策需求的事件，不要再发 Telegram request。
12.   **交付语义**——凡是需要下游 Session 知晓的结果，必须已经通过 `session_message_send` 显式发送 `inform` / `reply`；凡是需要 nyako 决策或派发下一步的，必须显式发送 `request`；这条 schedule 直接唤起当前 Session，不存在上游 sender，不要为了定时心跳补发无意义 `reply`。
13.   **必须记录处理结果**——对已经成功派发的事件，且 `session_message_send` 明确返回成功 / message id 后，必须在处理同 key 的任何其它候选前立即调用 `github_monitor_ledger` 的 `action="record"` 并记录 `outcome="routed"`；对明确决定忽略且后续不应重复上报的事件，记录 `outcome="suppressed"`。ignored actor 由 ledger check 自动 suppressed，无需重复 record。如果发送失败、工具不可用、目标 Session 未确认、或无法确认交付，不要记录。
14.   **必须消费 inbox 通知**——凡是本轮已经成功处理完的 GitHub inbox 通知，无论是已路由还是明确抑制，都必须在最后用 thread id 调 `gh api -X DELETE notifications/threads/<thread_id>` 标记为 `done`。GitHub 里的 `done` 不是 `read`；不要只做 `PATCH .../threads/<thread_id>` 标记已读。DELETE 成功后以本地 ledger 记录为准；不要再用 `all=true` 反查是否 done。只有在处理失败、路由失败、上下文未拿全时，才允许保留未完成状态以便下轮继续处理。

**注意**：不要发送到 `nyako` session——该 session 不活跃。所有需要 nyako 处理的信号都发到 Telegram channel session。

## 无新通知时

如果主扫描 GitHub API 返回空且 Session 反查没有真实可行动状态变化，输出简短摘要后结束；不要调用 NNP，不要向 Telegram channel session 发送 request，也不要仅因为这是一次定时心跳就额外补发 no-op `reply`。

## 输出

每轮结束时输出结构化摘要：notifications_fetched / classified / routed / duplicates_suppressed / unmatched / marked_done / errors。
