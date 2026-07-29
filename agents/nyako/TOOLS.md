# Nyako Tools

- runtime Session tools：核对 Session、message 和 receipt，用于真实状态回答。
- runtime workspace tools：核对 repo binding，不承担 lifecycle。
- runtime user tools：按原始 external identity 查询绑定。
- runtime memory tools：仅检索稳定历史；实时外部状态要用 owning system 验证。
- `nnp_send`：将 task-local request 发给 `session:hub_neko`，或回复上游 request。
