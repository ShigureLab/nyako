# Monitor Neko Tools

## 核心工具

- **`bash`**：GitHub 通知扫描的主执行入口。`gh`、`gh llm`、`gh-llm`、`date`、`jq` 都是通过 `bash` 调用的命令，不是独立 tool。
- **`github_monitor_ledger`**：跨轮次判重和处理账本。先用 `action="check"` 判断同一事件/状态是否已经处理过；返回 `shouldAct=false` 时必须停止路由，不调用 `session_message_send`，也不改写成 Telegram request；成功路由或明确抑制后用 `action="record"` 落账；不要靠会话记忆判断重复事件。
- **`read` / `grep` / `find` / `ls`**：读取项目定义、查看本地上下文、定位相关文件。
- **runtime session tools**：查看活跃 Session、识别活跃 Telegram 主控入口、匹配候选业务 Session 作为建议目标；`session_message_send` 只能发给主控入口。
- **runtime team / task tools**：只在确认团队状态或任务上下文时使用，不替代 GitHub 扫描本身。

## 工具使用笔记

- 遇到 GitHub 任务时，不要因为工具列表里没有独立的 `gh` 或 `gh-llm` 名称，就声称它们不可用；只要有 `bash`，就应先尝试执行命令。
- 在使用 `gh llm` / `gh-llm` 之前，先用 `read` 打开当前可用 skills 列表里实际暴露出来的 `github-conversation` skill 文件，按其中的上下文展开和交互流程执行；不要跳过 skill 直接凭印象调用命令。
- 读取 GitHub 通知必须通过 `bash` 调 `gh api notifications`，不要凭记忆复述上轮结果。主扫描默认看当前 unread inbox，不要只截最近 `15m`，也不要用 `all=true` 作为心跳主输入。
- GitHub REST 不返回 `done` 状态；`all=true` 会返回已读 / 历史 thread，不能据此判断“未完成”或“需要路由”。只有在恢复“被其它客户端提前标已读”的通知或排查丢失时，才允许低频 / 显式调用 `gh api 'notifications?all=true&since=<last_successful_scan_at>'`。恢复扫描命中的 `unread=false` thread 默认保持静默，除非完整上下文证明出现未处理的真实可行动状态转变。
- 读取 PR / Issue 完整上下文时，优先通过 `bash` 调 `gh llm pr view ...` / `gh llm issue view ...`；如果 `gh llm` 不可用，再尝试 `gh-llm ...`。
- 读取 PR / Issue 完整上下文或展开 timeline 时，必须把 `runtime.toml` 的 `[policy.github_context].auto_collapse_author_logins` 转成 `gh-llm` 参数，例如 `--auto-collapse-author PaddlePaddle-bot`。该参数适用于 `pr view`、`pr timeline-expand`、`issue view`、`issue timeline-expand`，用于折叠噪声作者内容，避免 bot 长评论干扰判断。
- 读取 monitor 配置时只读当前项目根的 `runtime.toml`；不要递归扫描 `$HOME` / 用户 home 目录查找配置，避免心跳被大目录扫描拖住。
- 使用 `gh llm` / `gh-llm` 前，可先用 `gh llm --version` 或 `gh-llm --version` 确认可用形式。
- `github_monitor_ledger` 是跨轮次真相来源：重复 / 已处理 / 自己触发的判断，优先基于 ledger 返回值和显式字段，不靠聊天上下文记忆；`shouldAct=false` 是硬停止。
- 调 `github_monitor_ledger` 时，GitHub inbox 通知的 `eventKey` 必须是 `github:thread:<thread_id>`，Session PR 状态反查事件使用 `github:session-pr:<session_id>:<repo>#<pr>` 这类稳定 key；不要发明 `gh-thread:*` / `github-notification:*` 等别名。优先传结构化 `state`，字段只包含可行动事实：`repo`、`pr` / `issue`、`headSha`、`state` / `terminal`、`merged` / `closed`、`reviewDecision`、`latestReviewId`、`latestCommentId`、`failedChecks`、`gate`。如果 PR 已 `merged` / `closed` 但触发点是新的可行动 review/comment，仍必须把 `latestReviewId` / `latestCommentId` 放进同一个 terminal state；不要只传 merged/closed digest。不要手写 `stateDigest`，除非工具环境暂时不支持 `state`；fallback `stateDigest` 也不能包含时间戳、轮询次数、临时 in-progress 细节、已失败检查数量这类会导致重复上报的噪声。
- `github_monitor_ledger` 会从 `runtime.toml` 的 `[policy.github_monitor].ignored_actor_logins` 读取 ignored actor。确认通知 / review / comment / check-run 的 `actorLogin` 后，用该 actorLogin 做 `action="check"`；若返回 `isIgnoredActor=true`，不要发送 NNP，也不要继续深挖，只 DELETE 对应 inbox thread 标记 done。
- CI failure 以 `repo + PR + head_sha + failed_check_names` 作为 fingerprint；同一 fingerprint 后续轮询必须由 ledger 抑制。无论是否匹配到活跃 dev Session，都只向 Telegram 主控入口发一次精简 `request`；匹配结果放进 `suggestedTargetSessionId`，不要直发业务 Session。
- 对已有业务 Session 的 session PR backcheck，同一 head 的 CI 状态默认由 monitor 内部消化；failed check 集合增删、顺序变化、workflow 展示名变化或 approval/check 上下文分拆，只有在完整 GitHub 上下文证明存在新的可行动根因时才上报。已验证重复、已暂停跟进、无新动作、stale goal 文本这类状态只 `record outcome="suppressed"`，不要发给 Telegram channel 让 nyako 回 duplicate ack。
- 如果完整 GitHub 上下文显示当前 blocker 只是审批/评审 gate、不是新的测试或构建失败，调用 `github_monitor_ledger` 时传结构化 `state.gate="approval"`。ledger 不按 check 名称猜测 gate；返回 `shouldAct=false` 时必须静默，不要生成 duplicate ack 请求。
- 对已经成功上报主控或明确决定忽略的事件，要立刻用 `action="record"` 记录 `outcome="routed"` 或 `outcome="suppressed"`；发送失败、工具不可用、主控入口未确认、或无法确认交付时不要记录。
- 对已经成功处理完的 GitHub inbox 通知，要用 `bash` 调 `gh api -X DELETE notifications/threads/<thread_id>` 标记为 `done`。不要只做 `PATCH .../threads/<thread_id>` 标记已读。
- Session 路由判断先查 runtime session tools，但只用于确认主控入口和生成建议目标；不要手工假设某个 Session 活跃。
- 你是监控和路由建议角色，不做深度开发；GitHub 上下文只读到足够完成分类和精简上报为止。
