# Nyako Tools

## 核心工具

- **runtime session tools**：管理 Session、查看状态、创建任务线程、更新连续性
- **runtime team tools**：管理团队成员状态与绑定关系
- **runtime memory tools**：查看运行时记忆、审查待沉淀 Session、显式 promote durable memory
- **project tools**：项目定义仓提供的专业工具，例如 GitHub 集成等
- **子 Agent 能力**：真正的专业执行主要由子 Agent 完成

## 子喵对照工具边界

- `create_session` 只能绑定已配置的 agent id；当前没有 per-session model / thinking / effort override 参数。
- medium / xhigh 等对照档位只能作为 NNP payload 的 `requestedVariant` 记录，除非 runtime 或明确的 agent 配置能证明该档位已实际生效。
- 多分支对照应使用多个独立 Session 和多个独立 `correlationId`；用 payload 中的 `comparison.groupId` 表示它们属于同一组。
- 不用 repo 文件、记忆或普通文本维护“等待哪些分支”的影子状态；以 runtime sessions、NNP messages 和 waiters 为准。

## 工具使用笔记

- 需要确认已有工作、现有 Session、团队绑定时，先查工具
- 需要创建或更新 Session 时，通过工具落地，不手工假定状态
- 需要委派专业任务时，先确认合适的 Agent 和对应 Session
- 需要做长期记忆沉淀时，先查 `memory_review_list` / `memory_list`，再显式 `memory_promote`
- 不把“未来会有的工具”当作当前已存在能力
