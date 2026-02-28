# Nyako（喵子）

赛博养猫计划 —— 基于 [OpenClaw](https://github.com/openclaw/openclaw) 的多 Agent GitHub 辅助团队。

## 🐱 团队成员

| Agent                | 角色       | 职责                            | 模型                          |
| -------------------- | ---------- | ------------------------------- | ----------------------------- |
| 🐱 **nyako**         | 团队管理者 | 交互 · 调度 · Session 管理      | minimax-portal/MiniMax-M2.5   |
| 👀 **monitor-neko**  | 哨兵       | 高频轮询 GitHub 通知            | google/gemini-3-flash-preview |
| ⌨️ **dev-neko**      | 工程师     | 开发 · PR 处理 · ACP 调度 Codex | openai-codex/gpt-5.3-codex    |
| 🔍 **research-neko** | 情报员     | 技术调研 · 方案分析             | openai-codex/gpt-5.3-codex    |
| 📋 **plan-neko**     | 策略师     | 任务拆解 · 优先级评估           | openai-codex/gpt-5.3-codex    |

## 快速开始

### 前置依赖

- Node.js 22+
- [GitHub CLI](https://cli.github.com/) (`gh`)（已登录）
- [OpenClaw](https://github.com/openclaw/openclaw)（`npm install -g openclaw@latest`）

### 安装

```bash
git clone https://github.com/ShigureLab/nyako.git
cd nyako
./setup.sh --install
```

安装脚本将：

1. 检查前置依赖（`gh`、`openclaw`、`jq`）
2. 交互式配置各 Agent 的模型
3. 部署 Agent workspace 和共享 Skills
4. 生成 OpenClaw 配置
5. 注册 cron 定时任务
6. 初始化运行时目录
7. 安装 `gh-llm` 插件

### 启动

```bash
openclaw gateway --port 18789
```

### 更新

当 repo 有更新时，拉取后运行：

```bash
git pull
./setup.sh --update
```

这将仅同步 Agent workspace 和 Skills 文件，不会重置配置。

## 架构

```
用户 ──Telegram──→ 🐱 nyako ──spawn──→ ⌨️ dev-neko ──ACP──→ Codex
                       │                    │
                       │                    └──spawn──→ 🔍 research-neko
                       │
                       ├──spawn──→ 📋 plan-neko
                       │
GitHub ──notify──→ 👀 monitor-neko ──route──→ Session
```

详见 [docs/architecture.md](docs/architecture.md)。

## 仓库结构

```
nyako/
├── agents/                  # Agent workspace 定义
│   ├── nyako/               # 🐱 主 Agent
│   ├── monitor-neko/        # 👀 监控喵
│   ├── dev-neko/            # ⌨️ 开发喵
│   ├── research-neko/       # 🔍 调研喵
│   └── plan-neko/           # 📋 规划喵
├── skills/                  # 共享 Skills
│   ├── github-contribution-guidelines/
│   ├── github-conversation/
│   └── paddlepaddle-contribution-guidelines/
├── crons/                   # cron 任务 prompt 文件
│   ├── dev-pr-review.md     # 每 1h：推进已有 PR
│   ├── dev-new-task.md      # 每 4h：处理开发任务
│   └── dev-maintenance.md   # 每周一：低优维护
├── schemas/                 # 运行时数据 schema
│   ├── session.schema.md
│   ├── task.schema.md
│   └── memory.schema.md
├── docs/                    # 架构文档
│   └── architecture.md
├── openclaw.template.json5  # OpenClaw 配置模板（JSON5）
└── setup.sh                 # 一键部署脚本
```

## License

[MIT](LICENSE) &copy; [Nyakku Shigure](https://github.com/SigureMo)
