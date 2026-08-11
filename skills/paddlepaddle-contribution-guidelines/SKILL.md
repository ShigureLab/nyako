---
name: paddlepaddle-contribution-guidelines
description: 定义了 GitHub PaddlePaddle 系列 repo 贡献指南的相关规则和行为模式。当需要在 GitHub 上向 PaddlePaddle 相关 repo 进行贡献时，此技能将被启用。
---

# PaddlePaddle 贡献指南技能

本 skill 定义了在 GitHub 上向 PaddlePaddle 相关 repo 进行贡献的一般最佳实践和行为模式。请根据以下指南进行操作，以确保高效且有条理的贡献。

在开始之前，请确保你已经阅读了 `github-contribution-guidelines` skill 中的内容，因为本 skill 是基于该技能的扩展，专门针对 PaddlePaddle 相关的贡献流程进行了补充和修改。

## CI 处理方式

你只需要关注 PaddlePaddle 相关 repo 中的 required CI 流水线，其他非 required 的流水线可以忽略不处理。

以下是一些常见的非 required CI 流水线及其处理方式：

- Approval 流水线：如非错误的代码更改引起的失败，请直接忽略该流水线，等待后续的 Approval 即可。
- CodeStyle 流水线：**必须处理**，确保代码符合 PaddlePaddle 的代码规范。如果该流水线失败，请使用 `pre-commit`/`prek` 工具进行代码格式化和检查，直到通过为止。
- Static-Check 流水线：如果是示例代码报错或者类型提示错误，**必须处理**。如果是触发其他开发者 approval 的检查失败，可以选择忽略该流水线。
- 其它测试流水线：如果判断与当前 PR 的代码更改无关，可以考虑 rerun 该流水线，如果判断与当前 PR 的代码更改相关，则**必须处理**。

## CI rerun

在 PaddlePaddle 相关的 repo 中，当你遇到 CI 失败时，如果确定该失败并非由你的代码更改引起的（例如环境问题、临时网络故障等），你可以通过在相应的 PR 或 commit 的评论区输入以下命令来重新触发 CI 流水线：

```
/re-run all-failed
```

你只需要关注 required CI，其他无需关注。
