---
name: cro-api-async-development
description: cro/api 的异步 HTTP、数据库会话、事务与外部存储开发和 review 指南；修改 controller/service/repository、AsyncSession、Milvus/Redis/MQ 或后台任务时按需加载。
---

# cro/api 异步开发

## 适用范围

用于 `cro/api` 的新 HTTP 数据库路径、同步路径异步化、事务边界调整，以及相关测试和 review。先读目标分支的实际实现；仓库仍有同步遗留路径，本 skill 不表示所有代码都已异步化。

## 已核实的仓库契约

- `core/async_db.py`：`get_async_session_factory()` 创建 `AsyncSession` factory；`async_session_scope()` 在异常时 `rollback()`、在 `finally` 中 `close()`；`get_async_db_session()` 将该 scope 暴露给 FastAPI。成功路径不会自动 `commit()`。
- `controllers/api/deps.py`：`AsyncDbSession = Annotated[AsyncSession, Depends(get_async_db_session)]`。`BoxUser = Annotated[Account, Depends(box_user_required)]`，其中 `box_user_required` 来自 `require_roles(RolePermissions.BOX_USER)`。
- `controllers/api/wording/wording.py`、`services/wording/wording_service.py` 和 `services/keyword_matching/kwm.py` 是当前异步化工作可核对的实际路径；但目标分支仍有 `get_sync_scoped_session()` 与同步 `MilvusClient` 路径，不能把 WIP 分支实现当成已合并基线。

开始修改前重新核对这些路径和符号；若目标分支已经变化，以代码和测试为准，并在 review 中说明差异。

## HTTP 调用链

1. 新增或改造数据库型 HTTP handler 时采用 async-first：controller、service、repository/数据访问函数均保持 `async`，数据库调用使用 `await`。
2. controller 参数直接声明 `session: AsyncDbSession`。该 alias 已携带 `Depends(get_async_db_session)`，不要再写 `= Depends()`、不要再调用 `get_async_db_session()`，也不要在 handler 内另建 session。
3. 将同一个对象显式传完整调用链：

   ```python
   async def endpoint(session: AsyncDbSession, _current_user: BoxUser):
       return await Service.run(session=session)

   class Service:
       @staticmethod
       async def run(session: AsyncSession):
           return await Repository.load(session=session)
   ```

4. service/repository 接收 session，但不创建、替换或关闭 HTTP request 的 session。需要让有状态 service 持有 session 时，在构造函数显式注入，并继续复用同一实例。
5. `BoxUser` 等参数即使函数体未读取，也会执行认证与角色检查。不要按“未使用参数”删除；只有迁移为等价的 route/router dependency 时才能移除参数。它同样已携带 `Depends`，不要重复写 `= Depends()`。

## 事务所有权

- dependency 只负责异常 rollback 和最终 close，不替成功请求自动提交。写路径必须明确事务所有者和提交时点。
- 按 SQLAlchemy 语义选操作：`flush()` 让待写数据在当前事务内可查询/取得数据库生成值；需要服务端生成字段时再 `refresh()`；只有业务操作完成后才 `commit()`。
- 捕获异常后如还要复用、转换或退出当前写事务，显式 `await session.rollback()`，再抛出或映射异常；不要吞掉失败继续提交。
- 避免在低层 helper 中随意 commit，尤其不要逐条 commit 破坏上层原子性。若现有业务契约确实要求分段提交，应写明部分成功语义并测试失败点。
- 不要依赖“请求正常返回就会自动保存”：`core/async_db.py` 当前没有成功路径 auto-commit。

## 非 HTTP 与阻塞边界

- background task、schedule、worker、CLI 等没有 FastAPI dependency 生命周期。入口应使用 `async with async_session_scope() as session:` 建立受控异步 scope，并在该 scope 内显式提交；不要把 request session 留给响应后执行的任务。
- 若调用链仍是同步 ORM，保持它在明确的同步 worker/scope 中；不要从 async event loop 直接执行同步 SQLAlchemy、同步 `MilvusClient`、同步 Redis/MQ 客户端或其它阻塞 I/O。
- 优先使用依赖库已验证的原生 async API。没有 async API 时，隔离到线程/worker，并先核实线程安全、连接/session 归属和取消行为。`services/keyword_matching/kwm.py` 的异步化分支使用 `AsyncMilvusClient`，并通过 `asyncio.to_thread()` 隔离同步 Redis lock 操作，可作为核查点而不是无条件复制的模板。
- 不把同步 session 跨线程传递，也不让多个并发协程共享一个可变 `AsyncSession`；并发子任务需要各自受控 scope，或在同一 session 上串行执行。

## 数据库与外部系统一致性

PostgreSQL transaction 不能回滚已经生效的 Milvus、Redis 或 MQ 操作。修改跨系统流程前写清：

1. 数据库何时 `flush` / `commit`；外部写何时发生。
2. 外部写失败时数据库是未提交、已提交还是部分提交。
3. 数据库 commit 失败时如何处理已完成的外部写。
4. 是否使用 outbox、幂等键、重试、补偿、对账或“可接受最终一致性”的明确契约。

“外部写放在 commit 前”只允许数据库失败时 rollback，不能自动撤销外部写；“commit 后再外部写”也不能靠 rollback 撤销数据库。不要用单库 rollback 描述跨系统原子性。`services/wording/wording_service.py` 的 wording/Milvus 更新顺序是 review 这类风险的实际检查点。

## 测试与 review checklist

### 生命周期与事务

- [ ] controller → service → repository 收到的是同一个 session 对象（可用 spy/fake 断言 identity）。
- [ ] dependency 异常路径发生 rollback，成功/失败都 close；成功路径未被 dependency 隐式 commit。
- [ ] 每个写操作的 `flush` / `refresh` / `commit` 时点与业务可见性一致；异常分支 rollback 后不再提交。
- [ ] service 没有另建/关闭 request session，响应后任务也没有继续使用它。
- [ ] 并发、取消和异常测试未出现 session 跨协程/线程共享、连接泄漏或未关闭资源。

### 鉴权、阻塞与一致性

- [ ] 未读取的 `BoxUser` 等副作用依赖仍保留等价鉴权，Annotated alias 未重复声明 `Depends()`。
- [ ] async 路径没有直接调用同步 ORM 或阻塞 Milvus/Redis/MQ/I/O；遗留同步代码有明确隔离边界。
- [ ] 外部系统失败、数据库 commit 失败、重试与重复投递均有可验证的幂等/补偿预期。

### 验证证据

- [ ] 静态检查分别覆盖类型、lint、搜索调用链和禁止模式。
- [ ] 集成验证使用真实或等价数据库/外部依赖，覆盖事务可见性、rollback、连接释放和失败注入。
- [ ] 不把“静态 API 存在/代码可导入”写成“数据库、Milvus、Redis 或 MQ 集成已通过”；分别报告执行过的命令、环境、结果和未验证项。
