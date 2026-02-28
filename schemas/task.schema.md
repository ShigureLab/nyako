# Task Schema

任务是用户或系统下达的具体工作项，存储在文件系统中供 Agent 读取和更新。

## 任务存储路径

`~/.nyako/tasks/<task-id>.md`

## 格式

每个任务文件应通过 YAML front matter 定义元数据：

```markdown
---
title: 修复 Paddle docstring 格式
created_at: 2026-03-01
status: pending
priority: P1
agent: dev-neko
session: dev-docstring-001
repos:
   - PaddlePaddle/Paddle
related_issues:
   - '#12340'
---

# 任务描述

修复 PaddlePaddle/Paddle 仓库中 `paddle.nn` 模块下所有函数的 docstring 格式，使其符合 NumPy 风格。

## 具体要求

1. 统一使用 NumPy 风格的 docstring
2. 确保所有参数都有类型标注和描述
3. 确保所有返回值都有类型标注和描述

## 参考资料

- Issue: PaddlePaddle/Paddle#12340
- NumPy docstring 规范: https://numpydoc.readthedocs.io/
```

## 字段说明

| 字段             | 类型   | 必填 | 说明                                |
| ---------------- | ------ | ---- | ----------------------------------- |
| `title`          | string | ✅   | 任务标题                            |
| `created_at`     | date   | ✅   | 创建时间（`YYYY-MM-DD`）            |
| `status`         | enum   | ✅   | 任务状态                            |
| `priority`       | enum   |      | 优先级（`P0` / `P1` / `P2` / `P3`） |
| `agent`          | string |      | 分配给的 Agent                      |
| `session`        | string |      | 关联的 Session ID                   |
| `repos`          | list   |      | 关联仓库列表                        |
| `related_issues` | list   |      | 关联 issue 列表                     |
| `related_prs`    | list   |      | 关联 PR 列表                        |

## 状态流转

```
pending → in_progress → done
```

| 状态          | 含义                       |
| ------------- | -------------------------- |
| `pending`     | 待处理                     |
| `in_progress` | 进行中                     |
| `done`        | 已完成（所有要求均已满足） |

**注意**：部分完成不允许标记为 `done`。

## 完成要求

任务完成时，必须：

1. 将状态更新为 `done`
2. 在当日记忆文件中添加完成总结
3. 记录被 review 指出的问题，避免下次重复
4. 如涉及代码贡献，确保相关 PR 已提交并通过审查
