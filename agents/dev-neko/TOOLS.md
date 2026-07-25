# Dev Neko Tools

## 核心工具

- **`dependency_update_ledger`**: 记录跨轮次依赖 minor 升级处理状态，避免同一个 minor 因 patch 漂移反复开 PR
- **`gh` CLI**: GitHub 交互主要工具
- **`grep` / `ast-grep`**: 代码搜索和分析
- **项目 skill**: 用于贡献规范、GitHub 对话理解等

## 工具使用笔记

- 在当前 Session workspace 直接完成编码、构建、测试、复现和 patch review
- 需要补充研究或任务拆解时，通过 NNP 请求对应团队 Session，并保留明确的 message id 与交付事实
- 处理周期性依赖升级任务时，先用 `dependency_update_ledger` 的 `action="check"` 以 `repo + dependency + targetMinor` 判重；只有成功开 PR 或明确抑制重复处理后，才用 `action="record"` 落账
- 对同一依赖的同一 minor，ledger 的去重键必须稳定；`targetVersion` 可以是该 minor 下当前最新 patch，但不要把 patch 号本身当成新的去重粒度
- 对准备提交的代码务必自行 review 一遍
- 使用 `gh` 阅读 issue / PR / review 时，优先关注历史上下文和 reviewer 反馈
- 使用 `gh-llm` 阅读 PR / Issue 时，`pr view`、`pr timeline-expand`、`issue view`、`issue timeline-expand` 都要带上配置的 auto-collapse authors，例如 `--auto-collapse-author PaddlePaddle-bot`。默认不要展开这些 author 的折叠内容，除非必须核对 bot 输出原文。
- Approve PR 时，用 `lgtmeow -r 2>&1 | awk '/<img / { print; exit }'` 生成 review comment 的 LGTM 首行，再跟随具体的 approve 反馈一起提交。`lgtmeow -r` 会把最终 `<img>` 与一行 `LGTMeow <来源 emoji>+🐾` 配方说明写到不同输出流；agent shell 会合并两路，因此不能直接复制原始命令输出。配方行只供终端查看，**禁止**写进 GitHub review body。无论命令输出顺序和输出流如何，最终 review body 都必须只保留唯一一行包含 `<img ...>` 的 `LGTMeow`，比如

   ```md
   LGTMeow <img src="https://www.gstatic.com/android/keyboard/emojikitchen/20230127/u1f381/u1f381_u1f43e.png" width="14" alt="🐾"/>

   {{ review_comment_detail }}
   ```
