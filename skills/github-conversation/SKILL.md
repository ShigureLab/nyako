---
name: github-conversation
description: GitHub 对话与评审技能。凡是涉及 PR/Issue 的阅读、追溯、总结、评论、Review、线程回复、resolve/unresolve、checks 定位、关联引用（cross-reference）等任务，均应优先触发本技能。目标是让 LLM 像人类在 GitHub Web 中一样快速抓住关键上下文，并给出可执行的下一步命令与证据链。
---

# GitHub 对话技能

## Pre-requisites

在使用 GitHub 对话技能之前，请确保你已经具备以下条件：

1. 你已经拥有一个 GitHub 账户，并且已经通过 GitHub CLI（`gh`）进行了身份验证。
2. 通过 uv 安装好 `gh-llm` 插件。如未安装好可以通过 `uv tool install gh-llm` 来安装。

## 目标与核心原则

这个技能的首要目标不是“把 API 数据全吐出来”，而是让 LLM 能像人类看 GitHub Web 一样，快速抓住关键上下文，并在合适位置获得下一步可交互操作提示。

核心原则：

1. 先建立上下文，再下结论。
2. 默认展示高价值信息，缺失时再按需展开。
3. 所有建议动作尽量提供可直接执行的命令。
4. 不依赖脆弱的本地会话状态。
5. 任何结论都要有证据链，任何回复尽量关联相关 PR/Issue。

## 触发条件优化（必须理解）

当用户出现以下意图时，应优先触发本技能：

1. “看一下这个 PR/Issue 在讲什么、进展如何、谁阻塞了”
2. “帮我 review / 回复 review / resolve thread / 跟进 CI”
3. “这个改动和哪些 PR/Issue 有关系”
4. “帮我起草 comment/review，并给我可执行命令”
5. “为什么这个 PR 改了但还没过、还有哪些上下文没看”

触发关键词示例：

- `PR` / `Issue` / `review` / `thread` / `resolve`
- `timeline` / `comment` / `cross-reference`
- `checks` / `CI` / `logs`
- `引用` / `关联` / `佐证` / `证据`

不应触发场景：纯闲聊、非 GitHub 工作流问题。

## 推荐工具层级

1. `gh-llm`：优先用于“阅读 + 上下文构建 + 复杂交互提示”。
2. `gh`：优先用于简单直接动作（如 comment / label / assign 等）。
3. GraphQL 直调：仅在前两者无法覆盖时使用。

## 标准流程（什么都不懂的 LLM 也必须照做）

### 步骤 1：先看总览

PR：

```bash
gh-llm pr view <pr_number> --repo <owner/repo>
```

Issue：

```bash
gh-llm issue view <issue_number> --repo <owner/repo>
```

你应先读取：

- frontmatter 元信息（作者、状态、更新时间、页面信息）
- 描述正文
- 时间线第一页与最后一页
- 底部 action 提示

### 步骤 2：判断上下文是否不足

如果出现以下情况，必须继续拉取：

1. 时间线中间页未展示。
2. 某条事件显示为截断（truncated）。
3. review 只显示摘要，细节不足。
4. 你无法确定“该改什么、改哪里、为什么”。

对应命令：

```bash
gh-llm pr timeline-expand <page> --pr <pr_number> --repo <owner/repo>
gh-llm pr event <index> --pr <pr_number> --repo <owner/repo>
gh-llm pr review-expand <PRR_id[,PRR_id...]> --pr <pr_number> --repo <owner/repo>

gh-llm issue timeline-expand <page> --issue <issue_number> --repo <owner/repo>
gh-llm issue event <index> --issue <issue_number> --repo <owner/repo>
```

### 步骤 3：确认后再做交互动作

仅在上下文充分时执行：

- 回复/编辑 comment
- 回复 review thread
- resolve / unresolve thread
- review comment / suggestion / submit

## 证据与引用规则

### A. 结论必须可回溯

任何结论都应至少绑定一种证据：

1. 时间线事件（事件序号 + 时间 + actor）
2. review/thread（review id / thread id）
3. 代码位置（文件 + 行号）
4. checks 项（check 名称 + 状态）

### B. 尽可能给出关联引用

如果发现相关 PR / Issue，应主动引用并说明关系：

1. 当前 PR 被谁 cross-reference / reference。
2. 当前讨论依赖哪个历史 PR/Issue 决策。
3. 当前建议是否与既有线程意见冲突。

实践要求：

- 优先使用 `gh-llm` 输出里的可执行 `view` 命令定位关联项。
- 回答中至少给出一个“关联对象 + 关系解释”。

### C. 回复内容的最低证据标准

在发布 comment/review 前，自检是否满足：

1. 说明“我基于哪些信息得出该建议”。
2. 明确“建议修改位置或行为影响”。
3. 如存在不确定性，明确指出“缺失上下文”并给出补充命令。

不满足以上任意一项，不应直接给确定性结论。

## PR 阅读（重点）

PR 中包含诸多有效信息，这包含了 PR 标题、描述、提交记录、文件更改记录、CI 检查结果、审查意见等。仅阅读某一项无法全面理解 PR 内容，因此必须综合考虑。

推荐起手命令：

```bash
gh-llm pr view <pr_number> --repo <owner/repo>
```

常用补充命令：

```bash
# 展开隐藏时间线页面
gh-llm pr timeline-expand <page> --pr <pr_number> --repo <owner/repo>

# 查看单条事件完整正文
gh-llm pr event <index> --pr <pr_number> --repo <owner/repo>

# 展开 resolved review 详情（支持批量）
gh-llm pr review-expand <PRR_id[,PRR_id...]> --pr <pr_number> --repo <owner/repo>

# 查看 checks（默认只看非通过项）
gh-llm pr checks --pr <pr_number> --repo <owner/repo>

# 查看全量 checks
gh-llm pr checks --pr <pr_number> --repo <owner/repo> --all
```

## Issue 阅读

Issue 的读取逻辑与 PR 相同：先看概要，再按需展开。

```bash
gh-llm issue view <issue_number> --repo <owner/repo>
gh-llm issue timeline-expand <page> --issue <issue_number> --repo <owner/repo>
gh-llm issue event <index> --issue <issue_number> --repo <owner/repo>
```

## Review 工作流（必须掌握）

### 1) 启动 review

```bash
gh-llm pr review-start --pr <pr_number> --repo <owner/repo>
```

该命令会输出：

- hunk 对应文件位置
- 建议锚点行号
- 可直接复制的 `review-comment` / `review-suggest` 命令

### 2) 添加行内评论

```bash
gh-llm pr review-comment \
  --path '<file_path>' \
  --line <line_number> \
  --side RIGHT \
  --body '<comment>' \
  --pr <pr_number> --repo <owner/repo>
```

### 3) 添加 suggestion

```bash
gh-llm pr review-suggest \
  --path '<file_path>' \
  --line <line_number> \
  --side RIGHT \
  --body '<reason>' \
  --suggestion '<replacement_content>' \
  --pr <pr_number> --repo <owner/repo>
```

### 4) 提交 review（收口）

```bash
gh-llm pr review-submit \
  --event COMMENT|APPROVE|REQUEST_CHANGES \
  --body '<summary>' \
  --pr <pr_number> --repo <owner/repo>
```

注意：一个 review 可以包含多条行内意见。常规流程是“先 comment/suggest 多条，再 submit 一次”。

## 对话交互命令模板

```bash
# 回复 thread
gh-llm pr thread-reply <thread_id> --body '<reply>' --pr <pr_number> --repo <owner/repo>

# 标记为已解决
gh-llm pr thread-resolve <thread_id> --pr <pr_number> --repo <owner/repo>

# 取消已解决
gh-llm pr thread-unresolve <thread_id> --pr <pr_number> --repo <owner/repo>

# 编辑评论（PR / Issue）
gh-llm pr comment-edit <comment_id> --body '<new_body>' --pr <pr_number> --repo <owner/repo>
gh-llm issue comment-edit <comment_id> --body '<new_body>' --issue <issue_number> --repo <owner/repo>
```

## 输出与汇报规范（给 LLM）

当你给用户回报时，建议固定为三段：

1. 结论（1-3 句）
2. 证据（对应事件编号、文件或线程）
3. 下一步命令（可直接复制执行）

如果是 review，再补：

- 风险等级（高 / 中 / 低）
- 必改项
- 建议项
- 相关引用（关联 PR/Issue）

## 常见错误（必须规避）

1. 只看第一页就开始改代码。
2. 把 Web 链接当成唯一操作指引，不给 CLI 命令。
3. 不展开 review 细节就给结论。
4. 误以为 `--json` 一次返回就代表上下文完整。
5. 多条 review 意见后忘记 `review-submit`。
6. shell 参数不用单引号，导致文本被提前展开。
7. 提了建议但没有任何证据引用。

## 评论正文格式规则（避免出现字面量 \n\n）

发布 PR/Issue 评论、review summary、thread reply 时，正文必须是真实换行，不是转义字符文本。

硬性要求：

1. 禁止在最终正文中出现字面量 \n 或 \n\n。
2. 需要分段时，直接写多行文本，或使用 heredoc 生成真实换行。
3. 若使用 gh api 的 JSON 参数，禁止手写带转义的 body 字符串；应通过文件输入。

推荐写法：

```bash
cat > /tmp/pr-comment.txt <<"EOF"
第一段

第二段
EOF

gh pr comment <pr_number> --repo <owner/repo> --body-file /tmp/pr-comment.txt
```

发布前自检：

1. 本地检查评论文件，确认段落是换行而不是反斜杠 n 文本。
2. 发布前后分别执行 `gh-llm pr view` 并通过 diff 确认评论内容正确显示为多段。

## 最后自检清单

在结束任务前逐项确认：

1. 是否已经跑过 `view`？
2. 是否补齐缺失上下文（expand/event/review-expand）？
3. 是否提供了可执行命令而不仅是链接？
4. 如果做了 review，是否已 submit？
5. 是否引用了至少一个相关 PR/Issue 或线程上下文？
6. 你的结论是否都能回溯到明确证据？

任一答案为“否”，不要结束任务。
