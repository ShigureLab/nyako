# Dev Neko Tools

## 核心工具

- **`gh` CLI**: GitHub 交互主要工具
- **`gh-llm`**: GitHub 对话增强插件（`ShigureLab/gh-llm`），用于 PR/Issue 的阅读和交互
- **ACP (Codex)**: 通过 `sessions_spawn` 以 `runtime: "acp"` 调度 Codex 进行编码
- **`grep` / `ast-grep`**: 代码搜索和分析

## ACP 使用

当需要具体编码时，通过 ACP 调度 Codex：

```json
{
   "task": "具体的编码任务描述，包含文件路径、预期行为、约束条件",
   "runtime": "acp",
   "agentId": "codex",
   "mode": "session"
}
```

- **`mode: "session"`**: 持久化 Session，适合需要多轮交互的编码任务
- **`mode: "run"`**: 一次性执行，适合简单的编码任务

## 工具使用笔记

- 使用 `gh` 命令时，字符串参数用单引号包裹，避免 backtick 被误解析
- 使用 `gh-llm` 前，确保通过 `github-conversation` skill 了解完整用法
- 对 Codex 产出的代码，务必自己 review 一遍后再提交
