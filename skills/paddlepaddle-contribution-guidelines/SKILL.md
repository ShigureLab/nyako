---
name: paddlepaddle-contribution-guidelines
description: 定义了 GitHub PaddlePaddle 系列 repo 贡献指南的相关规则和行为模式。当需要在 GitHub 上向 PaddlePaddle 相关 repo 进行贡献时，此技能将被启用。
---

# PaddlePaddle 贡献指南技能

本 skill 定义了在 GitHub 上向 PaddlePaddle 相关 repo 进行贡献的一般最佳实践和行为模式。请根据以下指南进行操作，以确保高效且有条理的贡献。

在开始之前，请确保你已经阅读了 `github-contribution-guidelines` skill 中的内容，因为本 skill 是基于该技能的扩展，专门针对 PaddlePaddle 相关的贡献流程进行了补充和修改。

## CI rerun

在 PaddlePaddle 相关的 repo 中，当你遇到 CI 失败时，如果确定该失败并非由你的代码更改引起的（例如环境问题、临时网络故障等），你可以通过在相应的 PR 或 commit 的评论区输入以下命令来重新触发 CI 流水线：

```
/re-run all-failed
```

你只需要关注 required CI，其他无需关注。
