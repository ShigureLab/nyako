---
id: memory-review
kind: session.run
cron: '0 * * * *'
timezone: Asia/Shanghai
session: nyako
reset: false
task: scheduled.memory.review
---

请执行一次周期性的 runtime memory review，把需要长期保留的稳定事实显式沉淀进 runtime-managed memory。

## 强制要求

1. 必须先调用 `memory_review_list` 获取待审 Session；如果没有候选，输出简短摘要后结束。
2. 只 review 候选列表中的 Session，不要无边界全量扫描所有历史 Session。
3. 对每个候选至少调用一次 `get_session`；必要时再用 `memory_list` 检查该 Session / agent / runtime 作用域下是否已经存在等价 durable memory，避免重复写入。
4. 只 promote 稳定、可复用、会持续影响后续协作的事实。不要把一次性聊天、短期 next action、未验证猜测写入 durable memory。
5. scope 选择规则：
   - `session`：只对某个 Session 长期有效的约束、结论、决策
   - `agent`：某个 agent 在本机上的稳定操作偏好、重复有效的方法论
   - `runtime`：机器/环境特性、本机运维偏好、不可提交的宿主知识
6. 如果要替换旧结论，使用 `supersedes` 明确声明，而不是假设旧记忆会自动消失。
7. 每审完一个候选 Session，都必须调用 `memory_review_mark`；即使本轮没有 promote 新 memory，也要显式消账。
8. 默认跳过明显的系统 Session 和纯心跳 Session；只有确认其中确实包含稳定协作知识时才 promote。
9. 输出结构化摘要：`candidates` / `reviewed` / `promoted` / `marked` / `skipped`
