# Session Schema

Session 是连续上下文的载体。一个 Agent 可以同时拥有多个 Session，每个 Session 处理一个独立的工作流。

## Session 列表文件

文件路径：`~/.nyako/sessions.md`

## 格式

```markdown
# Nyako Sessions

| id                | agent         | title               | repos               | prs    | issues | status | created_at | updated_at |
| ----------------- | ------------- | ------------------- | ------------------- | ------ | ------ | ------ | ---------- | ---------- |
| dev-docstring-001 | dev-neko      | 修复 docstring 格式 | PaddlePaddle/Paddle | #12345 | #12340 | active | 2026-03-01 | 2026-03-01 |
| dev-unittest-002  | dev-neko      | 补充单元测试        | ShigureLab/grepa    | #67    |        | active | 2026-03-01 | 2026-03-01 |
| research-acp-003  | research-neko | ACP 协议调研        |                     |        |        | done   | 2026-02-28 | 2026-03-01 |
```

## 字段说明

| 字段         | 类型   | 必填 | 说明                                                                      |
| ------------ | ------ | ---- | ------------------------------------------------------------------------- |
| `id`         | string | ✅   | 唯一标识，格式：`<agent>-<topic>-<序号>`                                  |
| `agent`      | string | ✅   | 所属 Agent（`dev-neko` / `research-neko` / `plan-neko` / `monitor-neko`） |
| `title`      | string | ✅   | 简短描述（一句话）                                                        |
| `repos`      | string |      | 关联仓库（`owner/repo`），多个用 `,` 分隔                                 |
| `prs`        | string |      | 关联 PR 编号（`#123`），多个用 `,` 分隔                                   |
| `issues`     | string |      | 关联 issue 编号（`#123`），多个用 `,` 分隔                                |
| `status`     | enum   | ✅   | Session 状态                                                              |
| `created_at` | date   | ✅   | 创建时间（`YYYY-MM-DD`）                                                  |
| `updated_at` | date   | ✅   | 最后更新时间（`YYYY-MM-DD`）                                              |

## 状态流转

```
active → blocked → active   （被阻塞后解除阻塞）
active → done                （任务完成）
active → stale               （长时间无进展）
done → archived              （完成后 7 天自动归档）
stale → active               （恢复推进）
stale → done                 （确认放弃）
```

| 状态       | 含义                                                    |
| ---------- | ------------------------------------------------------- |
| `active`   | 正在进行中                                              |
| `blocked`  | 被阻塞，等待外部条件（如等待 review、等待依赖 PR 合入） |
| `done`     | 任务完成                                                |
| `stale`    | 超过 3 天无更新，需要检查                               |
| `archived` | 已归档                                                  |

## Session 命名规范

格式：`<agent-prefix>-<topic>-<三位序号>`

- agent prefix: `dev` / `research` / `plan` / `monitor`
- topic: 简短的英文关键词（如 `docstring`、`unittest`、`acp-research`）
- 序号: 三位数字，递增（`001`、`002`、...）

示例：

- `dev-docstring-001`：开发喵的 docstring 修复 Session
- `dev-unittest-002`：开发喵的单元测试 Session
- `research-acp-003`：调研喵的 ACP 调研 Session
- `plan-refactor-004`：规划喵的重构规划 Session

## 路由规则

当 monitor-neko 收到新通知时，按以下规则匹配 Session：

1. 检查通知的 `repo`（owner/repo）是否与某个活跃 Session 的 `repos` 匹配
2. 检查通知的 PR/issue 编号是否与某个活跃 Session 的 `prs`/`issues` 匹配
3. 精确匹配（PR/issue 编号）优先于模糊匹配（repo）
4. 无匹配 → 向 nyako 报告，建议创建新 Session

## 关键规则

1. **一个任务线对应一个 Session**——不要将无关任务混在同一个 Session 中
2. **Session 由 nyako 创建**——子 Agent 只能建议创建，最终由 nyako 决定
3. **及时更新状态**——状态变化时立即更新 `sessions.md`
4. **及时关联**——当 Session 产生新的 PR/issue 时，及时添加到对应字段
