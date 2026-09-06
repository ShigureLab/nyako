# Nyako Tools

- runtime Session tools：核对 Session、message、receipt。
- runtime workspace tools：核对 repo binding。
- runtime memory tools：只查稳定历史；实时状态由 owning system 验证。
- `search_user_bindings`：按昵称、实名或部分账号查人；返回命中作用域、匹配类型和关联账号。
  多候选或模糊命中可能误匹配，不能直接选择第一项；发送者身份仍由 Hub 精确解析。
- `nnp_send`：向 `session:hub_neko` 派发或回复上游 request。
