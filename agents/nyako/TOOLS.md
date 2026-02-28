# Nyako Tools

## 核心工具

- **`gh` CLI**: GitHub 交互的主要工具，用于查看通知、操作 PR/Issue 等
- **`gh-llm`**: GitHub 对话增强插件（来自 `ShigureLab/gh-llm`），用于 PR/Issue 的阅读和交互
- **`sessions_spawn`**: OpenClaw 原生的子 Agent 生成工具，用于将任务派发到子 Agent
- **`subagents`**: 管理子 Agent 的工具（list/kill/steer）
- **`cron`**: 定时任务管理工具

## 工具使用笔记

- 使用 `sessions_spawn` 时，指定 `agentId` 来选择子 Agent
- 对于需要 Codex 的任务，由 dev-neko 通过 ACP 调用，nyako 不直接调用 ACP
- 查看 GitHub 通知由 monitor-neko 专职处理，nyako 不直接轮询
