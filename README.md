# Nyako（喵子）

赛博养猫计划。

## 设计原则

- `nyakore` 负责 runtime、session、run、artifact、terminal host
- `nyako` 负责 agents、tools、skills、prompt definitions
- 本机 secrets 与 runtime state 放在 `~/.nyakore/`
- 仓库根目录下的定义文件可以放心用 git 管理并上传

## 🐱 团队成员

| Agent                | 角色       | 职责                            | 配置位置 |
| -------------------- | ---------- | ------------------------------- | -------- |
| 🐱 **nyako**         | 团队管理者 | 交互 · 调度 · Session 管理      | `agents/nyako/agent.toml` |
| 👀 **monitor-neko**  | 哨兵       | 高频轮询 GitHub 通知            | `agents/monitor-neko/agent.toml` |
| ⌨️ **dev-neko**      | 工程师     | 开发 · PR 处理 · 调用 coding agent | `agents/dev-neko/agent.toml` |
| 🔍 **research-neko** | 情报员     | 技术调研 · 方案分析             | `agents/research-neko/agent.toml` |
| 📋 **plan-neko**     | 策略师     | 任务拆解 · 优先级评估           | `agents/plan-neko/agent.toml` |

## 快速开始

### 前置依赖

- Node.js 22+
- [GitHub CLI](https://cli.github.com/) (`gh`)（已登录）
- `nyakore`

### 安装

```bash
git clone https://github.com/ShigureLab/nyako.git
cd nyako
mkdir -p ~/.nyakore/providers
cp providers.example/*.toml ~/.nyakore/providers/
```

然后按本机情况填写 `~/.nyakore/providers/*.toml`。

### 启动

在 `nyako` 仓库目录里启动 `nyakore`：

```bash
cd ~/Projects/nyako
nyakore tui
```

`nyakore` 会读取：

- repo 内 `runtime.toml`
- repo 内 `agents/*/agent.toml`
- repo 内 `tools/*/tool.toml`
- repo 内 `skills/skills.toml`
- repo 内 `memory/*.md`
- 用户目录 `~/.nyakore/providers/*.toml`

### 更新

当 repo 有更新时，只需要同步 repo 本身：

```bash
git pull
```

## 架构

```text
用户 ──TUI/未来网关──→ 🐱 nyako ──tools──→ Session / Team / Artifacts
                            │
                            ├──delegate──→ ⌨️ dev-neko
                            ├──delegate──→ 🔍 research-neko
                            ├──delegate──→ 📋 plan-neko
                            └──delegate──→ 👀 monitor-neko

repo root            定义层，可提交
~/.nyakore/          secrets + runtime state，本机私有
```

## 配置结构

```text
runtime.toml
agents/
├── nyako/
│   ├── AGENTS.md
│   ├── IDENTITY.md
│   ├── MEMORY.md
│   ├── agent.toml
│   └── ...
├── dev-neko/
├── research-neko/
├── plan-neko/
└── monitor-neko/

tools/
├── runtime-session/
│   └── tool.toml
├── runtime-team/
│   └── tool.toml
└── github/
    └── tool.toml

schedules/
└── github-monitor.md

skills/
├── github-contribution-guidelines/
├── github-conversation/
├── paddlepaddle-contribution-guidelines/
└── skills.toml

memory/
└── core.md
```

这里放的是定义，不是 secrets。

本机私有层：

```text
~/.nyakore/
├── providers/
│   ├── minimax-default.toml
│   └── openai-codex-default.toml
└── projects/
    └── <repo-slug>-<hash>/
```

## 当前状态

第一版已经把以下内容迁成新结构：

- 默认 runtime 索引：`runtime.toml`
- 5 个 agent 的独立目录式配置
- `AGENTS.md` 为主提示入口，`IDENTITY.md`、`MEMORY.md` 等文件按需注入
- repo 级共享长期记忆目录：`memory/`
- 可扩展的 tool definitions 目录
- skills registry

当前 prompt 组合顺序由 `nyakore` 负责固定为：

1. `AGENTS.md`
2. `IDENTITY.md`
3. `SOUL.md`
4. `TOOLS.md`
5. `USER.md`
6. repo 级 `memory/*.md`
7. agent 级 `MEMORY.md`
8. `~/.nyakore/projects/<project>/memory/summary.md`

## 特别感谢

- OpenAI 提供的 [Codex for Open Source](https://developers.openai.com/community/codex-for-oss) 计划，为喵子提供了强大的基座模型支持。
    - 目前喵子由两个该计划账号驱动（[@SigureMo](https://github.com/SigureMo) 及 [@swgu98](https://github.com/swgu98)），特别感谢 [@swgu98](https://github.com/swgu98) 的慷慨支持！
- 

## License

[MIT](LICENSE) &copy; [Nyakku Shigure](https://github.com/SigureMo)
