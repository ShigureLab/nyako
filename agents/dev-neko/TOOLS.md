# Dev Neko Tools

## 核心工具

- **`dependency_update_ledger`**: 记录跨轮次依赖 minor 升级处理状态，避免同一个 minor 因 patch 漂移反复开 PR
- **`gh` CLI**: GitHub 交互主要工具
- **`acp_delegate`**: 通过 ACP 把具体编码、修改、验证任务委派给 `codex`
- **`acp_list_agents`**: 检查当前可用的 ACP agent 与权限配置
- **coding agent / Codex**: 具体编码与修改执行
- **`grep` / `ast-grep`**: 代码搜索和分析
- **项目 skill**: 用于贡献规范、GitHub 对话理解等

## 工具使用笔记

- 具体编码时先想清楚任务目标、文件范围、预期行为和约束，再调度 coding agent
- 调用 `acp_delegate` 时，明确 repo 路径、目标文件、预期验证命令和交付标准，避免给 Codex 模糊任务
- 真正需要改代码、跑命令时优先走 `codex`，不要把 ACP 只当成只读检索器
- 处理周期性依赖升级任务时，先用 `dependency_update_ledger` 的 `action="check"` 以 `repo + dependency + targetMinor` 判重；只有成功开 PR 或明确抑制重复处理后，才用 `action="record"` 落账
- 对同一依赖的同一 minor，ledger 的去重键必须稳定；`targetVersion` 可以是该 minor 下当前最新 patch，但不要把 patch 号本身当成新的去重粒度
- 对 coding agent 产出的代码，务必自己 review 一遍后再提交
- 使用 `gh` 阅读 issue / PR / review 时，优先关注历史上下文和 reviewer 反馈
- Approve PR 时，在 review comment 里使用 CLI 工具 `lgtmeow -r` 来生成 LGTM 文本，并跟随具体的 approve 反馈一起提交，保持清晰的审查记录，比如

   ```md
   LGTMeow <img src="https://www.gstatic.com/android/keyboard/emojikitchen/20230127/u1f381/u1f381_u1f43e.png" width="14" alt="🐾"/>

   {{ review_comment_detail }}
   ```
