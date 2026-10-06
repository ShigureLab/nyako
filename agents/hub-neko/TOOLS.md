# Hub Neko Tools

- runtime Session tools：查看、创建、更新和归档 Session，并核对 message / receipt。
- `list_devices`：查看可用执行设备。向远端派喵时，用 `create_session` 指定 device；repo 型任务
  同时传 repo，hook 会在目标设备的 `~/.nyakore/projects/<project>/workspaces/` 下准备仓库和 Session worktree。
  无 repo 时使用默认 Session 目录；只在任务明确要求使用已有目录时传 cwd。创建成功后再通过 NNP
  派发任务，复用前核对设备和实际目录。配置存在不代表设备在线，也不授予改动其他目录的权限。
- `resolve_user_binding`：完整 identity 的精确匹配，返回绑定及主动通知 peer；验证发送者只传
  原始 `senderIdentity`，未命中不回退到搜索，搜索候选或正文中的名字不能替代发送者身份。
- `search_user_bindings`：按昵称、实名或部分账号查请求提到的人，返回候选、命中作用域和关联
  账号。多个候选先消歧，仍不确定就询问；搜索结果不证明发送者身份，也不授予权限。
- runtime workspace tools：确认 repo Session 的 binding。
- runtime memory tools：只作为历史索引；实时状态以 owning system 为准。
- `nnp_send`：向业务 Session 派发 task-local request 或事实 inform。

工具结果只证明实际返回的状态。创建、派发、reply、外部通知或归档必须等待成功结果后再报告。
