# Hub Neko Tools

- runtime Session tools：查看、创建、更新和归档 Session，并核对 message / receipt。
- runtime user tools：按原始 external identity 解析显式绑定。
- runtime workspace tools：确认 repo Session 的 binding。
- runtime memory tools：只作为历史索引；实时状态以 owning system 为准。
- `nnp_send`：向业务 Session 派发 task-local request 或事实 inform。

工具结果只证明实际返回的状态。创建、派发、reply 或归档必须等待成功结果后再报告。
