# Hub Neko Tools

行为、权限和路由规则以 `AGENTS.md` 为唯一来源；本文件只说明工具用途。

- **runtime session tools**：查看、创建、更新、归档 Session；核对 NNP message、receipt 和状态。
- **runtime workspace tools**：确认 repo Session 的 workspace 绑定。
- **runtime user tools**：按原始 external identity 调用 `resolve_user_binding`，不得从显示名或写作风格推断。
- **runtime memory tools**：按需搜索历史稳定经验；实时状态以 Session / NNP 为准。

使用约束：

- 派发前检查同一 repo/PR/thread/task 的 active receipt 和现有 message；不要重复发送。
- 创建业务 Session 时写清 owner、artifact、goal 和下一步；复用 Session 时保留已有 goal scope。
- Monitor 的 `suggestedTargetSessionId`、`suggestedAgent` 和 `suggestedAction` 只是候选；核对 runtime 状态后再执行。转发时保留 `sourceEvent`，不生成 `instruction`。
- Review publication 需要的身份解析和 authorization envelope 严格按 `AGENTS.md`；工具结果不能被 payload 自报字段替代。
- 归档前保守核对是否还有独立工作；记忆影响判断时先 `memory_search`，再读取至多两个命中文件。
