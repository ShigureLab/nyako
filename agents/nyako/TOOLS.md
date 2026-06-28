# Nyako Tools

## 核心工具

- **runtime session tools**：查看 Session、核对状态、读取 message / waiter；业务 Session 创建和生命周期管理交给 `hub_neko`
- **runtime team tools**：管理团队成员状态与绑定关系
- **runtime memory tools**：查看运行时记忆、审查待沉淀 Session、显式 promote durable memory
- **project tools**：项目定义仓提供的专业工具，例如 GitHub 集成等
- **子 Agent 能力**：真正的专业执行主要由子 Agent 完成

## 工具使用笔记

- 需要确认已有工作、现有 Session、团队绑定时，先查工具
- 需要创建、复用、更新或归档业务 Session 时，向 `hub_neko` 发送 NNP request，不在聊天入口直接落地
- 需要委派专业任务时，把用户需求和相关 artifact 转交 `hub_neko`
- 需要做长期记忆沉淀时，先查 `memory_review_list` / `memory_list`，再显式 `memory_promote`
- 不把“未来会有的工具”当作当前已存在能力
