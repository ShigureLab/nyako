# Monitor Neko Tools

本文件只定义命令、工具参数和持久化协议；分类、路由和授权边界以 `AGENTS.md` 为准。

## 工具入口

- **`bash`**：执行 `gh`、`gh llm` / `gh-llm`、`jq` 和 `date`。工具列表没有独立 `gh` 项不代表命令不可用。
- **`github_monitor_ledger`**：跨轮次 canonical event 判重和处理结果账本。
- **runtime session tools**：列出活跃 Session、核对中枢 peer、生成建议目标并发送 NNP。
- **`read` / `grep` / `find` / `ls`**：读取当前项目定义和局部运行上下文。

## GitHub 输入与上下文

- 每轮必须通过 `bash` 实际执行 `gh api notifications --paginate` 获取当前 unread inbox，并保留 thread id。不要加 `all=true`，也不要限制为最近 `15m`。
- `gh api 'notifications?all=true&since=<last_successful_scan_at>'` 只用于显式恢复被提前标记已读的通知或排查丢失。对 `unread=false` 候选先查完整上下文和 ledger；只有 `AGENTS.md` 定义的真实可行动事实才允许 route。
- 处理 GitHub 上下文前先读取当前暴露的 `github-conversation` skill。优先用 `gh llm pr view` / `gh llm issue view`；不可用时再尝试 `gh-llm`。
- 将 `adapters/github/adapter.toml` 的 `[policy.context].auto_collapse_author_logins` 逐个转换为 `--auto-collapse-author <login>`，用于 PR/Issue view 和 timeline expand。只有验证精确 bot 产物确有必要时才单独 expand。
- human mention/comment 只有在 actor login 精确命中 `adapters/github/adapter.toml` 的 `[policy].trusted_users` 时才算 trusted；不要根据显示名、邮箱、写作风格或会话记忆推断。
- notification 列表没有可靠 actor 时，允许先查询识别 notification、review、comment、check-run/status context actor 或 review-request provenance 所需的最小事件元数据；一旦 actor 命中 ignored 配置，立即停止其它 timeline、CI 和代码上下文读取。
- 非 ignored PR 的最小完整上下文必须覆盖 review、CI 和 merged/closed 状态；非 ignored Issue 必须覆盖 labels 和 assignee。自动折叠的 author 内容默认不可作为可行动依据。
- 读取 monitor 项目配置时只读当前项目根的 `runtime.toml` 和 `adapters/github/adapter.toml`；不要递归扫描用户 home。

## Review request provenance

- 对 `reason=review_requested`，先用 `gh api user --jq .login` 获取 `viewerLogin`。
- 再用 `gh api repos/<owner>/<repo>/issues/<pr>/events --paginate` 或 GraphQL `ReviewRequestedEvent` timeline 查找实际直接请求该 viewer 的最新 user-target 事件。
- REST 与 GraphQL event id 属于不同 namespace。始终成对保留 `eventSource`（`github.issue_event` 或 `github.graphql_review_requested_event`）和 `eventId`，不得脱离 source 比较。
- ledger event 使用实际发起者作为 `actorLogin`、目标账号作为 `requestedReviewerLogin`，并把稳定事件 id 写入 `state.latestReviewRequestId`。
- notification reason、PR author、更新时间、显示名和 team request 都不能替代上述 provenance，也不能自行建立授权。

## Ledger 协议

1. 在本轮内先按 `eventKey + canonical actionable state` 合并候选，再对每个候选调用 `github_monitor_ledger action="check"`。不要手写 `stateDigest`；优先传结构化 `state`，由工具规范化并生成 digest。
2. GitHub inbox 使用 `eventKey="github:thread:<thread_id>"`；Session PR 反查使用 `eventKey="github:session-pr:<session_id>:<repo>#<pr>"`。不要创建 `gh-thread:*`、`github-notification:*` 等别名。
3. `state` 只包含可行动事实：`repo`、`pr` / `issue`、`headSha`、`state` / `terminal`、`merged` / `closed`、`reviewDecision`、`latestReviewId`、`latestReviewRequestId`、`latestCommentId`、`failedChecks`、`failureFingerprint` 和 `gate`。terminal state 如同时有新的 review request/review/comment，必须保留对应 latest id。
4. `shouldAct=false` 是硬停止：不调用 `nnp_send`，只按处理结果决定是否消费 thread。
5. actor 命中 `[policy.monitor].ignored_actor_logins` 时，将该 login 作为 `actorLogin` 传入 check；ledger 会返回 `isIgnoredActor=true`、`shouldAct=false` 并自动记录 suppressed。
6. `failedChecks` 只能描述经完整上下文确认的当前失败事实。raw check 名称增删、排序、展示名变化或 approval/check 拆分可以触发一次 check，但不足以 route；按 `AGENTS.md` 判定无新根因后记录 `outcome="suppressed"`。同一 head、同一 check 名称下确认出现新的可行动根因时，使用由稳定诊断证据生成的 `failureFingerprint` 区分；不得包含时间戳、run id、日志行号或临时状态，同一根因必须生成同一值。
7. approval-only 使用 `state.gate="approval"`，不得伪装成 CI failure。没有新 head、review request/review/comment、terminal state 或真实 CI 根因时记录 suppressed。
8. `nnp_send` 返回 durable success/message id 后，立即调用 `action="record"`、`outcome="routed"`、`targetSessionId="hub_neko"`、`messageKind="inform"` 和实际 intent。monitor 使用 inform，不等待 hub reply/ack。
9. 除 ignored actor（check 已自动记录 suppressed）外，明确忽略且今后不应重复处理的事件记录 `outcome="suppressed"`。上下文不完整、工具失败或发送失败时不 record。

## Session、NNP 与 inbox 消费

- 每轮调用 `list_sessions`，确认 Session id `hub_neko` 的完整 peer 是 `session:hub_neko`，并仅把其它匹配 Session 写入建议字段。
- 所有 monitor 交付都使用 `nnp_send(toPeerId="session:hub_neko", kind="inform", ...)`。禁止使用裸 `hub_neko`、`kind="request"` 或直发业务/platform Session。
- GitHub inbox 的 `done` 通过 `gh api -X DELETE notifications/threads/<thread_id>` 完成，不是 PATCH 标记已读。只有事件已成功 routed 并落账，或明确 suppressed 后，才 DELETE；失败或不确定时保留。
- DELETE 成功后以 ledger 为跨轮次事实，不用 `all=true` 反查 done。
