---
id: paddle-weekly-tooling-upgrade
kind: task.intake
cron: '0 4 * * 6'
timezone: Asia/Shanghai
owner: dev-neko
title: Weekly Paddle tooling minor upgrade sweep
repo: PaddlePaddle/Paddle
---

每周检查 `PaddlePaddle/Paddle` 中 `ast-grep`、`typos`、`ruff`、`yamlfmt` 是否出现新的 minor 版本；如果有，在修复升级带来的新问题后提交 PR。不要因为同一个 minor 内的 patch 漂移反复开 PR。

## 强制要求

1. 先在 repo workspace 中定位这四个工具当前的锁定版本、配置入口和实际调用位置，确认升级应该落在哪些文件。
2. 默认从官方 release / tag / registry 获取最新版本信息，不凭记忆判断版本。
3. 只处理 **新 minor**；同一依赖同一 `major.minor` 的更高 patch 版本不单独触发新的 PR。
4. 对每个候选升级项，必须先调用 `dependency_update_ledger` 的 `action="check"` 做防抖。
   - `repo` 固定为 `PaddlePaddle/Paddle`
   - `dependency` 使用稳定名称：`ast-grep` / `typos` / `ruff` / `yamlfmt`
   - `targetMinor` 使用 `major.minor`
   - `targetVersion` 使用当前准备升级到的精确版本
5. 如果 ledger 显示该 minor 已经处理过，或者 GitHub 上已经存在针对同一 dependency + targetMinor 的 open / merged PR，本轮跳过，不重复开 PR；明确跳过后用 `action="record"` 记录 `outcome="suppressed"`。
6. 如果存在可升级项，优先把本轮可控的 minor 升级合并成 **一个** PR；如合并后修复范围明显失控，只提交最小且能稳定通过验证的一组升级，但本轮最多提交 1 个 PR。
7. 升级后必须修复由版本变化带来的格式、lint、规则、配置或 CI 问题；不要只改版本号就结束。
8. 对 `PaddlePaddle/Paddle` 的贡献必须加载并遵循 `paddlepaddle-contribution-guidelines` skill，以及仓库自身的贡献说明。
9. 提交前必须运行该仓库所需的相关检查；能跑本地验证就先跑本地验证，PR 发出后继续关注 required CI，必要时继续修复直到稳定。
10.   只有在成功创建 PR 或明确决定抑制重复处理后，才调用 `dependency_update_ledger` 的 `action="record"`。
      - 创建 PR 时记录 `outcome="opened"` 和 `prNumber`
      - 因重复 minor / 已有 PR / 已合入而跳过时记录 `outcome="suppressed"`
11.   输出简短结构化摘要：`current_versions` / `discovered_updates` / `selected_updates` / `pr` / `verification` / `suppressed`

## 目标

- 对同一 dependency 的同一 `major.minor` 只处理一次；例如已经处理过 `ruff 0.13.x`，即使上游从 `0.13.0` 到 `0.13.5`，也不要再开第二个 PR。
- 没有新 minor 时，输出摘要后结束，不创建 PR。
