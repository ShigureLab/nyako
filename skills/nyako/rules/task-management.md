# Nyako Task Management Rules

## 任务存储（Task Storage）

所有待办任务必须存储在 `~/.nyako/tasks/` 目录下，文件格式为 Markdown (`.md`)。

每个任务文件应通过 front matter 定义任务的元数据，包括但不限于：

- `title`: 任务标题
- `created_at`: 任务创建时间
- `status`: 任务状态（如 `pending`、`in_progress`、`done`）

## 任务处理流程（Task Handling Workflow）

当你被分配一个新任务时，请按照以下步骤进行处理：

1. **任务接收（Task Reception）**：
   - 确认任务已存储在 `~/.nyako/tasks/` 目录下，刚刚创建的任务状态应为 `pending`。
   - 读取任务文件，理解任务的具体要求和背景信息。
2. **任务执行（Task Execution）**：
   - 将任务标记为 `in_progress`。
   - 阅读任务描述，理解任务要求。
   - 制定任务执行计划。
   - 开始执行任务，确保在执行过程中遵循最佳实践。
   - 如果任务涉及代码贡献，请参考 [Nyako Development Workflow](development.md) 中的相关规则进行操作。
3. **任务完成（Task Completion）**：
   - 完成任务后，将任务状态更新为 `done`（只有所有任务要求均已满足时才可标记为完成，部分完成不允许标记为 `done`）。
   - 在当日的记忆文件中添加完成时间和简要总结，以及任何相关的链接（如 PR 链接），特别是被 review 所指出的问题，需要重点总结，避免下次重复犯错。
   - 如果任务涉及代码贡献，请确保相关的 PR 已提交并通过审查。

## PR 管理（PR Management）

- 高优关注 PR review，特别是 Nyakku（@SigureMo）的，需要第一时间解决，完成后需要在 GitHub 上礼貌回复
- 每个 PR 应当独立且聚焦于单一任务或问题，当一个任务过大时，应拆分为多个小任务，每个小任务对应一个 PR
- 在开始任务前，务必先搜索 GitHub，确保没有现有的 PR 已经解决了该问题，避免相互冲突的工作
- **同时最多有 10 个活跃的 PR，每次被唤醒最多提交一个 PR**
- 只要之前的 PR 不阻塞后续任务，且活跃数 < 10，就可以继续提交新 PR，不必等待全绿
- 如果一个 PR 被拆分成多个小任务，务必在新的 PR 中引用之前的 PR 编号，确保关联清晰，同时务必参考之前 PR 的 review 意见，避免重复错误
- 提交 PR 后，**必须先自己 review 一遍**，确保没有明显问题后 `@SigureMo` 进行最终 review
