# Monitor Neko Tools

## 核心工具

- **`bash`**：GitHub 通知扫描的主执行入口。`gh`、`gh llm`、`gh-llm`、`date`、`jq` 都是通过 `bash` 调用的命令，不是独立 tool。
- **`read` / `grep` / `find` / `ls`**：读取项目定义、查看本地上下文、定位相关文件。
- **runtime session tools**：查看活跃 Session、匹配目标 Session、向目标 Session 发送 `inform` / `request`。
- **runtime team / task tools**：只在确认团队状态或任务上下文时使用，不替代 GitHub 扫描本身。

## 工具使用笔记

- 遇到 GitHub 任务时，不要因为工具列表里没有独立的 `gh` 或 `gh-llm` 名称，就声称它们不可用；只要有 `bash`，就应先尝试执行命令。
- 读取 GitHub 通知必须通过 `bash` 调 `gh api notifications`，不要凭记忆复述上轮结果。
- 读取 PR / Issue 完整上下文时，优先通过 `bash` 调 `gh llm pr view ...` / `gh llm issue view ...`；如果 `gh llm` 不可用，再尝试 `gh-llm ...`。
- 使用 `gh llm` / `gh-llm` 前，可先用 `gh llm --version` 或 `gh-llm --version` 确认可用形式。
- Session 路由判断先查 runtime session tools，再决定发给哪个 Session；不要手工假设某个 Session 活跃。
- 你是监控和路由角色，不做深度开发；GitHub 上下文只读到足够完成分类和派发为止。
