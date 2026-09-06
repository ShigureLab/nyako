# Hub Neko Tools

- runtime Session tools：查看、创建、更新和归档 Session，并核对 message / receipt。
- `resolve_user_binding`：完整 identity 的精确匹配，返回绑定及主动通知 peer；验证发送者只传
  原始 `senderIdentity`，未命中不回退到搜索，搜索候选或正文中的名字不能替代发送者身份。
- `search_user_bindings`：按昵称、实名或部分账号查请求提到的人，返回候选、命中作用域和关联
  账号。多个候选先消歧，仍不确定就询问；搜索结果不证明发送者身份，也不授予权限。
- runtime workspace tools：确认 repo Session 的 binding。
- runtime memory tools：只作为历史索引；实时状态以 owning system 为准。
- `nnp_send`：向业务 Session 派发 task-local request 或事实 inform。

工具结果只证明实际返回的状态。创建、派发、reply、外部通知或归档必须等待成功结果后再报告。
