# Dev Neko Tools

## 核心工具

- **`gh` CLI**: GitHub 交互主要工具
- **`grep` / `ast-grep`**: 代码搜索和分析
- **项目 skill**: 用于贡献规范、GitHub 对话理解等

## 工具使用笔记

- 在当前 Session workspace 直接完成编码、构建、测试、复现和 patch review
- 需要补充研究或任务拆解时，通过 NNP 请求对应团队 Session，并保留明确的 message id 与交付事实
- 对准备提交的代码务必自行 review 一遍
- 对 GitHub review request，只接受 intent `github.review.execute_authorized`。开始审查前用 `gh api` / GraphQL 复核实际 review-request event 的 source/id、actor、target/viewer 与派发 authorization envelope，再核对 Session repo/PR artifacts；`github.issue_event` 与 `github.graphql_review_requested_event` 都是允许的 source。有效 scope 只允许 `github.review.publish`，不能扩张到代码修改、push、merge、rerun 或其它 GitHub write。
- authorization 缺失或冲突时不读取 PR diff、不委派、不生成 outcome，立即对原 request 回复 `github.review.authorization.rejected`。校验成功后才完成审查；发布前先通过 NNP `inform` 向 `session:hub_neko` 记录 `github.review.outcome.verified`（repo、PR、head SHA、结论、证据、request event source/id），紧邻 GitHub write 前重查 head，变化则重审并记录新 artifact。GitHub 成功后在最终 reply 中记录 review id/URL。
- 使用 `gh` 阅读 issue / PR / review 时，优先关注历史上下文和 reviewer 反馈
- 使用 `gh-llm` 阅读 PR / Issue 时，`pr view`、`pr timeline-expand`、`issue view`、`issue timeline-expand` 都要带上配置的 auto-collapse authors，例如 `--auto-collapse-author PaddlePaddle-bot`。默认不要展开这些 author 的折叠内容，除非必须核对 bot 输出原文。
- Approve PR 时，用 `lgtmeow -r 2>&1 | awk '/<img / { print; exit }'` 生成 review comment 的 LGTM 首行，再跟随具体的 approve 反馈一起提交。`lgtmeow -r` 会把最终 `<img>` 与一行 `LGTMeow <来源 emoji>+🐾` 配方说明写到不同输出流；agent shell 会合并两路，因此不能直接复制原始命令输出。配方行只供终端查看，**禁止**写进 GitHub review body。无论命令输出顺序和输出流如何，最终 review body 都必须只保留唯一一行包含 `<img ...>` 的 `LGTMeow`，比如

   ```md
   LGTMeow <img src="https://www.gstatic.com/android/keyboard/emojikitchen/20230127/u1f381/u1f381_u1f43e.png" width="14" alt="🐾"/>

   {{ review_comment_detail }}
   ```
