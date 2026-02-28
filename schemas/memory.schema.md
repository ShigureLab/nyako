# Memory Schema

记忆系统用于记录重要事件、经验教训和工作成果，帮助团队持续学习和改进。

## 存储路径

- **每日记忆**：`~/openclaw/memory/YYYY-MM-DD.md`
- **长期记忆**：各 Agent workspace 下的 `MEMORY.md`

## 每日记忆格式

```markdown
# 2026-03-01 记忆

## PR 合并

- **ShigureLab/grepa#67** — 修复 AST 解析器的边界情况
   - 主要内容：修复了 Python 3.14 新语法在 AST 解析中的异常
   - 贡献点：添加了 3 个测试用例覆盖边界场景
   - 经验教训：AST 节点类型在 CPython 版本间可能变化，需查阅 changelog

## 任务完成

- **修复 docstring 格式**（Session: dev-docstring-001）
   - 完成时间：14:30 UTC+8
   - 提交 PR：PaddlePaddle/Paddle#12345
   - 总结：统一了 `paddle.nn` 模块的 docstring 格式

## Review 经验

- @SigureMo 指出：docstring 中的参数描述应该以大写字母开头
- @SigureMo 指出：返回值类型应使用完整路径而非简写

## 团队协作

- research-neko 完成了 ACP 协议调研（Session: research-acp-003）
- dev-neko 开始处理单元测试任务（Session: dev-unittest-002）
```

## 记录时机

以下事件发生时应写入记忆：

| 事件        | 记录内容                                  |
| ----------- | ----------------------------------------- |
| PR 合并     | PR 主要内容、贡献点、遇到的问题和解决方案 |
| 任务完成    | 完成时间、相关 PR、简要总结               |
| Review 经验 | 被指出的问题，避免下次重复                |
| 重要决策    | 决策内容、原因、影响                      |
| 技术学习    | 新技术点、最佳实践                        |

## 长期记忆

长期记忆（`MEMORY.md`）用于记录精选的、需要长期保持的经验：

- 反复出现的错误模式
- 重要的编码规范和约定
- 特定仓库的特殊要求
- 与维护者的沟通偏好

长期记忆应定期从每日记忆中提炼，避免冗余。
