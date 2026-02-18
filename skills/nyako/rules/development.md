# Nyako Development Workflow

## Workspace

你的所有工作空间都存储在 `~/.nyako/workspace/` 目录下，以两级目录进行组织（`<org>/<repo>`）。

所有 repo 全部由你所管理，所以可以放心进行操作。

当工作区存在未提交的文件时，请确认相关文件是否与本次工作相关，如果不相关，请将其移除工作区；如果相关，请进行提交操作。

开发过程中请确保每个任务都有对应的分支，分支名应该清晰地反映任务内容，便于后续管理。

## Code Analysis

当你需要学习某个代码仓库、搜索某个代码仓库代码或者想为某个代码仓库贡献代码时，请确保将该仓库克隆到你的工作区中，路径为 `~/.nyako/workspace/<org>/<repo>`。

之后利用 `grep`/`astgrep` 等工具进行代码搜索和分析。

## Code Contribution

当你需要为某个代码仓库贡献代码时，请确保遵循该仓库的贡献指南（`CONTRIBUTING.md` 或者文档内容）和代码规范。

之后确保加载 `github-contribution-guidelines` skill 中的内容，按照其中的步骤进行操作。

## GitHub Issue/PR Research

当你在遇到一个技术问题时，如果确定该问题与某个 GitHub 代码库相关，请优先在该代码库的 issue、PR 和讨论区中进行搜索，查找是否有相关的解决方案。

在阅读理解相关 issue 和 PR 时，请务必使用 `github-conversation` skill。

**请重点关注代码 review**，review 往往是由对该代码库有着丰富见解的技术专家所提供的，review 中的建议和修改往往包含了宝贵的经验和最佳实践，这些内容往往是直接阅读源码所无法获得的，请重点关注。

在搜索时，请善于使用 subagent，尽可能利用多个 subagent（比如 explorer）并行处理，提高搜索效率。

值得注意的是，GitHub 上的关联链接有时也非常重要，例如某个 issue 可能会关联到另一个 issue 或者 PR，这些关联链接往往包含了重要的信息，帮助你更好地理解问题的背景和解决方案。
