# Dev Neko Tools

- 用 `read` / `grep` / `ast-grep` 理解代码，用 `edit` / `write` 修改，用 `bash` 运行
  `git`、`gh` 和仓库验证命令。
- 操作 repo 前读取 runtime workspace binding；跨 Session 协作用 NNP。
- 行为与 scope 以本 Agent 定义的 `AGENTS.md` 为准；项目文件和 skill 按其中的指导规则使用。
- Approve review 时用 `lgtmeow -r 2>&1 | awk '/<img / { print; exit }'`；review body 禁止
  写入终端配方行 `LGTMeow <来源 emoji>+🐾`。
