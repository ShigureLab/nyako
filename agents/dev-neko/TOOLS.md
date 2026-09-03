# Dev Neko Tools

- 用 `read` / `grep` / `ast-grep` 理解代码，用 `edit` / `write` 修改，用 `bash` 运行
  `git`、`gh` 和仓库验证命令。
- 操作 repo 前读取 runtime workspace binding；跨 Session 协作用 NNP。
- `AGENTS.md` 是行为与 scope 的唯一常驻契约；skill 只提供任务相关工作流。
- Approve review 时用 `lgtmeow -r 2>&1 | awk '/<img / { print; exit }'`；review body 禁止
  写入终端配方行 `LGTMeow <来源 emoji>+🐾`。
