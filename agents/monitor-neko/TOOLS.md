# Monitor Neko Tools

## 核心工具

- **`bash`**：GitHub 通知扫描的主执行入口。`gh`、`gh llm`、`gh-llm`、`date`、`jq` 都是通过 `bash` 调用的命令，不是独立 tool。
- **`github_monitor_ledger`**：跨轮次判重和处理账本。先用 `action="check"` 判断同一事件/状态是否已经处理过，再在成功路由或明确抑制后用 `action="record"` 落账；不要靠会话记忆判断重复事件。
- **`read` / `grep` / `find` / `ls`**：读取项目定义、查看本地上下文、定位相关文件。
- **runtime session tools**：查看活跃 Session、匹配目标 Session、向目标 Session 发送 `inform` / `request`。
- **runtime team / task tools**：只在确认团队状态或任务上下文时使用，不替代 GitHub 扫描本身。

## 工具使用笔记

- 遇到 GitHub 任务时，不要因为工具列表里没有独立的 `gh` 或 `gh-llm` 名称，就声称它们不可用；只要有 `bash`，就应先尝试执行命令。
- 在使用 `gh llm` / `gh-llm` 之前，先用 `read` 打开当前可用 skills 列表里实际暴露出来的 `github-conversation` skill 文件，按其中的上下文展开和交互流程执行；不要跳过 skill 直接凭印象调用命令。
- 读取 GitHub 通知必须通过 `bash` 调 `gh api notifications`，不要凭记忆复述上轮结果。主扫描默认看当前 unread inbox，不要只截最近 `15m`，也不要用 `all=true` 作为心跳主输入。
- GitHub REST 不返回 `done` 状态；`all=true` 会返回已读 / 历史 thread，不能据此判断“未完成”或“需要路由”。只有在恢复“被其它客户端提前标已读”的通知或排查丢失时，才允许低频 / 显式调用 `gh api 'notifications?all=true&since=<last_successful_scan_at>'`。恢复扫描命中的 `unread=false` thread 默认保持静默，除非完整上下文证明出现未处理的真实可行动状态转变。
- 读取 PR / Issue 完整上下文时，优先通过 `bash` 调 `gh llm pr view ...` / `gh llm issue view ...`；如果 `gh llm` 不可用，再尝试 `gh-llm ...`。
- 使用 `gh llm` / `gh-llm` 前，可先用 `gh llm --version` 或 `gh-llm --version` 确认可用形式。
- `github_monitor_ledger` 是跨轮次真相来源：重复 / 已处理 / 自己触发的判断，优先基于 ledger 返回值和显式字段，不靠聊天上下文记忆。
- 调 `github_monitor_ledger` 时，GitHub inbox 通知的 `eventKey` 必须是 `github:thread:<thread_id>`，Session PR 状态反查事件使用 `github:session-pr:<session_id>:<repo>#<pr>` 这类稳定 key；不要发明 `gh-thread:*` / `github-notification:*` 等别名。`stateDigest` 只包含可行动状态：head sha、merged/closed、review decision、最新可行动 review/comment id、CI failed check name fingerprint；不要包含时间戳、轮询次数、临时 in-progress 细节、已失败检查数量这类会导致重复上报的噪声。
- CI failure 以 `repo + PR + head_sha + failed_check_names` 作为 fingerprint；同一 fingerprint 后续轮询必须由 ledger 抑制。匹配到活跃 dev Session 时只向该 Session 发一次 `inform`，无匹配时只向 Telegram 发一次 `request`。
- 对已经成功派发或明确决定忽略的事件，要立刻用 `action="record"` 记录 `outcome="routed"` 或 `outcome="suppressed"`；发送失败、工具不可用、目标 Session 未确认、或无法确认交付时不要记录。
- 对已经成功处理完的 GitHub inbox 通知，要用 `bash` 调 `gh api -X DELETE notifications/threads/<thread_id>` 标记为 `done`。不要只做 `PATCH .../threads/<thread_id>` 标记已读。
- Session 路由判断先查 runtime session tools，再决定发给哪个 Session；不要手工假设某个 Session 活跃。
- 你是监控和路由角色，不做深度开发；GitHub 上下文只读到足够完成分类和派发为止。
