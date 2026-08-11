---
name: github-contribution-guidelines
description: 定义了 GitHub 贡献指南的相关规则和行为模式。当需要在 GitHub 上进行贡献时，此技能将被启用。
---

# GitHub 贡献指南技能

本 skill 定义了在 GitHub 上进行贡献的一般最佳实践和行为模式。请根据以下指南进行操作，以确保高效且有条理的贡献。

为了方便描述，后续内容中假设你已经具备一个 GitHub 账户，并且已经配置好了本地的 Git 环境，并通过 GitHub CLI（gh）进行身份验证。

如果上述条件尚未满足，请先提醒用户完成这些准备工作。

你可以通过以下命令检查 GitHub CLI 是否已配置：

```bash
❯ gh auth status
github.com
  ✓ Logged in to github.com account ShigureNyako (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
```

当出现类似上述输出时，表示 GitHub CLI 已正确配置。

为了方便后续描述，假设你的 GitHub 用户名为 `ShigureNyako`，请根据实际情况替换为你的用户名；同时假设贡献的上游仓库为 `ShigureLab/python-lib-starter`。

## 仓库管理（Repository Management）

当你在 GitHub 上进行贡献时，请确保先将仓库从上游（upstream）仓库 fork 到你的个人账户，然后克隆到本地工作区。

```bash
cd /path/to/your/workspace/
gh repo list ShigureNyako  # Check existing repositories under your account
# If the repository does not exist, fork it from upstream
gh repo fork ShigureLab/python-lib-starter
# Clone the forked repository to your local workspace
gh repo clone ShigureNyako/python-lib-starter ShigureLab/python-lib-starter
# Navigate to the cloned repository
cd ShigureLab/python-lib-starter
```

## 远程仓库配置（Remote Repository Configuration）

请确保你的本地仓库配置了正确的远程仓库（remotes），包括 `origin` 指向你的个人 fork 仓库，`upstream` 指向上游仓库。 你可以通过以下命令检查和配置远程仓库：

```bash
❯ git remote -v
origin	https://github.com/ShigureNyako/python-lib-starter.git (fetch)
origin	https://github.com/ShigureNyako/python-lib-starter.git (push)
upstream	https://github.com/ShigureLab/python-lib-starter.git (fetch)
upstream	https://github.com/ShigureLab/python-lib-starter.git (push)
```

如果你是通过 `gh` 克隆的仓库，`origin` 和 `upstream` 通常会自动配置好。如果没有，请手动添加：

```bash
# Add upstream remote if not present
git remote add upstream https://github.com/ShigureLab/python-lib-starter.git
# Set origin remote to your fork if not correct
git remote set-url origin https://github.com/ShigureNyako/python-lib-starter.git
```

请根据情况替换上述 URL，一般情况下我们只需维护 `origin` 和 `upstream` 两个远程仓库，以保持与上游仓库的同步和贡献。

## 开发工作流（Development Workflow）

### 同步默认分支（Syncing the Default Branch）

在每次开始新的工作之前，请确保将默认开发分支（通常为 `main`，视仓库而定）更新到上游的最新状态：

```bash
# Ensure you are on the main branch
git switch main
# Fetch the latest changes from upstream
git fetch upstream main
# Merge the changes into your local main branch
git merge upstream/main
# Push the updated main branch to your fork
git push origin main
```

请确保默认分支保持最新，以避免合并冲突，且**该分支仅用于同步上游仓库，不进行任何开发工作**。

### 创建功能分支（Creating Feature Branches）

此时，你可以基于最新的开发分支创建新的功能分支（feature branch）来进行开发工作：

```bash
# Create and switch to a new feature branch
git switch -c feature/your-feature-name
```

后续开发工作均在该功能分支上进行。

### 提交与拉取请求（Commits & Pull Requests）

在完成后，直接提交并推送到你的 fork：

```bash
# After making changes, stage and commit them
# Then push to your fork
gh pr create --base main --head feature/your-feature-name --title 'Your PR Title' --body 'Description of your changes'
```

> [!NOTE]
>
> 值得注意的是，当命令中使用字符串时，如非需要执行命令，请使用单引号 `'` 包裹字符串内容，以避免将 <code>`</code> 误认为是命令执行符号。

**每个功能分支应对应一个独立的 PR**，以便于代码审查和合并。

后续如需更新该功能分支对应的 PR，直接在该分支上 commit 并 push 即可。

### 自我审查（Self-Review）

在提交 PR 之后，**请务必立刻进行自我审查**，确保所有更改符合项目的代码规范和质量标准。你可以通过以下步骤进行自我审查：

- 根据 PR diff，逐行检查代码更改，确保符合任务描述和项目规范。
- 根据项目的代码风格指南，检查代码格式、命名规范和注释质量。
- 根据 CI/CD 流水线的检查结果，修复任何出现的问题。如果你确定某个 CI 问题与你的更改无关，请尝试 rerun CI 流水线。

### CI/CD 检查（CI/CD Checks）

当 PR 创建后，请密切关注 CI/CD 流水线的检查结果。如果检查失败，请根据错误信息进行修复，并将更改推送到同一功能分支，CI/CD 检查会自动重新运行。

如果你不确定如何修复某个 CI/CD 错误，请优先阅读相关文档，或者向项目维护者寻求帮助。

### 审查与合并（Review & Merge）

在 PR 描述中，请提及相关的开发者或维护者，以便他们能够及时审查你的贡献。例如：

```
@SigureMo Please review this PR when you have time. Thanks!
```

如果一个 PR 长时间（超过 3 天）没有得到审查，请在 PR 下方留言提醒相关维护者，或者在项目的讨论区寻求帮助。

### 处理合并冲突（Handling Merge Conflicts）

如果在合并上游分支时遇到冲突，请按照以下步骤解决：

```bash
# Switch back to default branch
git switch main
# Fetch latest changes from upstream
git fetch upstream main
# Merge upstream changes
git merge upstream/main
# Push updated main branch to your fork
git push origin main
# Switch back to your feature branch
git switch feature/your-feature-name
# Merge updated main into your feature branch
git merge main
# Resolve any merge conflicts manually
# After resolving conflicts, stage the changes and commit
# ... add / commit commands ...
# Push the updated feature branch to your fork
git push origin feature/your-feature-name
```

### 合并与删除分支（Merging & Deleting Branches）

当 PR 被合并后，请删除本地和远程的功能分支，以保持仓库整洁：

```bash
# Delete local feature branch
git branch -d feature/your-feature-name
# Delete remote feature branch
git push origin --delete feature/your-feature-name
```

## 命名约定（Naming Conventions）

为方便管理和识别，请遵循以下命名约定：

### 分支命名（Branch Naming）

分支命名应遵循以下格式：

```
<type>/<short-description>
```

比如：

- `feature/add-login-functionality`
- `bugfix/fix-null-pointer-exception`
- `docs/add-contribution-guidelines`

一般是 PR 标题的简短版本，使用小写字母和连字符 `-` 分隔单词。

### Commit Message 命名

视具体项目而定，但一般建议遵循以下格式：

```
<type>(<scope>): <short description>
# For example:
feat(auth): add OAuth2 login support
fix: resolve data serialization bug
```

部分项目可能会使用如下格式（如 PaddlePaddle、TVM、PyTorch 等）：

```
# If only one type is used
[<type>] <Short description>
# If multiple types are used
[<type1>][<type2>][<type3>] <Short description>
# For example:
[Dynamo][3.14] Add bytecode `BUILD_TEMPLATE` and `BUILD_INTERPOLATION` support for `torch.compile`
```

其中 `<short description>` 应简洁明了地概括所做的更改，但不要过于笼统或模糊。

错误示例：

- `Update code to fix bugs and improve performance`
- `Various fixes and improvements`
- `Fix`
- `Update`

正确示例：

- `Fix null pointer exception in user login flow`
- `Add unit tests for payment processing module`
- `Improve performance of data serialization`

具体项目可以参考其贡献指南中的要求，如无特别要求，请分析该项目中已有的 commit message 风格并保持一致。

### PR 标题（PR Title）

PR 标题同样遵循 commit message 的命名规范，因为 PR 标题通常会被用作合并时的 commit message。

PR 标题应简洁明了，概括所做的更改。请确保所有修改都包含在标题中，**当 PR 发生改动时，务必更新标题以反映最新内容**。

PR 标题应当描述你在**当前仓库所做的更改以及要解决的问题**，例如：

- `Add user authentication module to handle login and registration`
- `Fix memory leak in data processing pipeline`
- `Update documentation for API endpoints and usage examples`
- `Fix double free bug in resource cleanup logic`

而不是在标题中直接说明解决的具体业务问题，例如：

- `Fix login issue`
- `Fix model loading error in Swin Transformer`（比如当前仓库是底层核心代码库 PaddlePaddle/PyTorch，而不是上层模型库，那么标题应聚焦于底层代码的更改，而不是上层模型的问题，上层模型问题应该在 PR 描述中说明）
- `Fix documentation typos`（这种过于笼统的标题应具体说明修正了哪些文档中的错误）

### PR 描述（PR Description）

PR 描述应详细说明所做的更改、解决的问题以及任何相关背景信息。请确保描述清晰且易于理解，便于审查者快速了解 PR 的内容和目的。

当上游仓库有 PR 模板（`.github/PULL_REQUEST_TEMPLATE.md`）时，请务必遵循模板中的要求填写 PR 描述。

当 PR 解决了特定 issue 时，请在描述中引用相关 issue，issue 中包含了最丰富的上下文信息，可以帮助审查者理解问题背景。例如：

```
This PR fixes #123 by implementing the following changes...
```
