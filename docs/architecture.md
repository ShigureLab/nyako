# Nyako Team 架构

## 总览

Nyako Team 是一个基于 [OpenClaw](https://github.com/openclaw/openclaw) 的多 Agent GitHub 辅助团队。不同于单一 Agent 包揽一切的模式，团队采用"专人专事"的分工架构——每个 Agent 有明确的职责边界和专业能力。

```
┌─────────────────────────────────────────────────────────┐
│                    用户（@SigureMo）                      │
│                       Telegram                          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              🐱 nyako（时雨喵子）                         │
│              主 Agent / 团队管理者                        │
│              MiniMax M2.5                               │
│                                                         │
│  职责：交互 · 调度 · Session 管理 · 汇报                   │
└───┬──────────┬──────────┬──────────┬────────────────────┘
    │          │          │          │
    ▼          ▼          ▼          ▼
┌────────┐┌────────┐┌────────┐┌────────┐
│👀      ││⌨️      ││🔍      ││📋      │
│监控喵  ││开发喵  ││调研喵  ││规划喵   │
│monitor ││dev     ││research││plan    │
│-neko   ││-neko   ││-neko   ││-neko   │
│        ││        ││        ││        │
│Gemini 3││Codex   ││Codex   ││Codex   │
│Flash   ││        ││        ││        │
└────────┘└───┬────┘└────────┘└────────┘
              │
              ▼ ACP
        ┌──────────┐
        │  Codex   │
        │(外部编码) │
        └──────────┘
```

## Agent 职责

### 🐱 nyako（时雨喵子）— 主 Agent

- **模型**：MiniMax M2.5（可配置）
- **驱动方式**：消息触发（来自用户或子 Agent 上报）
- **职责**：
   - 与用户交互，理解需求
   - 将任务调度给合适的子 Agent
   - 管理 Session 列表
   - 汇总子 Agent 的工作成果
- **不做**：任何专业性任务

### 👀 monitor-neko（监控喵）— 哨兵

- **模型**：MiniMax M2.5
- **心跳**：每 20 分钟
- **职责**：
   - 轮询 GitHub 通知
   - 对通知进行分类
   - 将通知路由到对应的 Session
- **不做**：深度分析、编码、与用户交互

### ⌨️ dev-neko（开发喵）— 工程师

- **模型**：openai-codex/gpt-5.3-codex（可配置）
- **驱动方式**：cron 定时任务 + session spawn（按需）
- **职责**：
   - 通过 ACP 调度 Codex 进行编码
   - 分析和 review 代码
   - 处理 PR（推进合并、响应 review、修复 CI）
- **cron 任务**（独立 prompt 文件，见 `crons/`）：
   - `dev-pr-review.md` — 每 1h：推进已有 PR
   - `dev-new-task.md` — 每 4h：处理开发任务，提交新 PR
   - `dev-maintenance.md` — 每周一：低优维护（renovate PR 等）

### 🔍 research-neko（调研喵）— 情报员

- **模型**：openai-codex/gpt-5.3-codex（可配置）
- **驱动方式**：session spawn（按需）
- **职责**：
   - 技术方案调研与对比
   - GitHub issue/PR/discussion 信息检索
   - 输出结构化调研报告

### 📋 plan-neko（规划喵）— 策略师

- **模型**：openai-codex/gpt-5.3-codex（可配置）
- **驱动方式**：session spawn（按需）
- **职责**：
   - 将大任务拆解为可执行的子任务
   - 评估优先级和依赖关系
   - 制定执行计划

## 团队协作

子 Agent 之间可以自由交互，不必所有请求都经过 nyako：

```
nyako ──spawn──→ dev-neko ──spawn──→ research-neko
                     │
                     └──spawn──→ plan-neko ──spawn──→ research-neko
```

- **dev-neko** 可以请求 **research-neko** 进行编码前调研
- **dev-neko** 可以请求 **plan-neko** 拆解复杂任务
- **plan-neko** 可以请求 **research-neko** 进行可行性调研
- 任何子 Agent 遇到无法处理的问题，应上报给 **nyako**

## Session 机制

Session 是连续上下文的载体，解决了"一个 Agent 同时处理多个独立任务"的问题。

### 核心概念

- **Agent** = 专业能力的体现（开发、调研、规划）
- **Session** = 连续上下文的体现（一个具体任务线）
- 一个 Agent 可以有多个 Session

### 示例

```
用户："帮我修一下 Paddle 的 docstring"
  └→ nyako 创建 Session: dev-docstring-001 (dev-neko)

用户："顺便修一下 grepa 的单测"
  └→ nyako 创建 Session: dev-unittest-002 (dev-neko)

[20min 后] monitor-neko 发现 Paddle#12345 有新 review
  └→ 匹配 Session dev-docstring-001 → 派发到该 Session

[20min 后] monitor-neko 发现 grepa#67 CI 失败
  └→ 匹配 Session dev-unittest-002 → 派发到该 Session
```

### 生命周期

```
active → blocked → active → done → archived
```

详见 `schemas/session.schema.md`。

Session 的读写统一通过 `~/.nyako/bin/session_store.sh` 完成，避免并发修改 Markdown 造成冲突。

## 调度机制

| 调度方式 | Agent        | 频率       | 内容                                  | prompt 文件                |
| -------- | ------------ | ---------- | ------------------------------------- | -------------------------- |
| 心跳     | monitor-neko | 每 20 分钟 | 轮询 GitHub 通知，分类并路由          | —                          |
| cron     | dev-neko     | 每 1 小时  | 推进已有 PR（review 响应、CI 修复等） | `crons/dev-pr-review.md`   |
| cron     | dev-neko     | 每 4 小时  | 处理开发任务，提交新 PR               | `crons/dev-new-task.md`    |
| cron     | dev-neko     | 每周一     | 低优维护（renovate PR 等）            | `crons/dev-maintenance.md` |

- **心跳 vs cron**：心跳由 OpenClaw 内置调度，使用 HEARTBEAT.md 作为系统提示；cron 由 `openclaw cron upsert` 注册，每个任务使用独立的 prompt 文件。
- 活跃时间窗口（UTC+8 14:00 到次日 08:00）当前由 Agent 提示词约束，不是强制调度门控。
- nyako、research-neko、plan-neko 无定时调度，纯粹按需驱动（消息触发 / session spawn）。

## 消息流

### 用户交互流

```
用户 ──Telegram──→ nyako ──spawn──→ 子 Agent ──report──→ nyako ──Telegram──→ 用户
```

### 通知处理流

```
GitHub ──notification──→ monitor-neko ──route──→ 对应 Session (dev-neko)
                              │
                              └──report──→ nyako (如需新 Session)
```

### 开发工作流

```
dev-neko ──ACP spawn──→ Codex ──result──→ dev-neko ──gh pr create──→ GitHub
```

## 数据存储

| 路径                              | 内容                                  |
| --------------------------------- | ------------------------------------- |
| `~/.openclaw/workspace-<agent>/`  | 各 Agent 的 workspace（AGENTS.md 等） |
| `~/.openclaw/openclaw.json`       | OpenClaw 主配置                       |
| `~/.openclaw/workspace-<agent>/memory/` | 每日记忆 Markdown 日志               |
| `~/.openclaw/memory/`             | 记忆索引与运行时状态（OpenClaw 管理） |
| `~/.nyako/sessions.json`          | Session 主存储（机器读写）            |
| `~/.nyako/sessions.md`            | Session 人读视图（由脚本导出）        |
| `~/.nyako/tasks/`                 | 任务文件                              |
| `~/.nyako/workspace/<org>/<repo>` | 代码工作区                            |
