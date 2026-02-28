#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Nyako Team - 一键部署 / 更新脚本
# 赛博养猫计划：基于 OpenClaw 的多 Agent GitHub 辅助团队
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── 颜色定义 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── 默认路径 ──
NYAKO_HOME="${NYAKO_HOME:-$HOME/.openclaw}"
NYAKO_REPO="$(cd "$(dirname "$0")" && pwd)"
NYAKO_DATA="${HOME}/.nyako"

# ── 辅助函数 ──
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
ask()   { echo -en "${CYAN}[?]${NC} $* "; }

# ── 使用说明 ──
usage() {
   cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
   --install          首次安装（完整部署）
   --update           更新已有部署（同步文件 + 更新 cron）
   --register-crons   仅注册/更新 cron 任务
   --check            检查前置依赖
   --help             显示帮助信息

Environment:
   NYAKO_HOME    OpenClaw 主目录（默认: ~/.openclaw）
EOF
   exit 0
}

# ═══════════════════════════════════════════
# 依赖检查
# ═══════════════════════════════════════════
check_dependencies() {
   info "检查前置依赖..."

   local missing=0

   # Node.js 22+
   if command -v node &>/dev/null; then
      local node_version
      node_version=$(node -v | sed 's/v//' | cut -d. -f1)
      if [[ "$node_version" -ge 22 ]]; then
         ok "Node.js $(node -v)"
      else
         warn "Node.js $(node -v) — 需要 v22+"
         missing=1
      fi
   else
      warn "Node.js 未安装（需要 v22+）"
      missing=1
   fi

   # GitHub CLI
   if command -v gh &>/dev/null; then
      ok "GitHub CLI $(gh --version | head -1)"
      # 检查登录状态
      if gh auth status &>/dev/null; then
         ok "GitHub CLI 已登录"
      else
         warn "GitHub CLI 未登录，请运行 gh auth login"
         missing=1
      fi
   else
      warn "GitHub CLI 未安装"
      missing=1
   fi

   # OpenClaw
   if command -v openclaw &>/dev/null; then
      ok "OpenClaw $(openclaw --version 2>/dev/null || echo 'installed')"
   else
      warn "OpenClaw 未安装 — 运行 npm install -g openclaw@latest"
      missing=1
   fi

   # jq
   if command -v jq &>/dev/null; then
      ok "jq $(jq --version)"
   else
      warn "jq 未安装 — 运行 brew install jq"
      missing=1
   fi

   # gh-llm
   if gh llm --version &>/dev/null 2>&1 || command -v gh-llm &>/dev/null; then
      ok "gh-llm 已安装"
   else
      warn "gh-llm 未安装 — 运行 gh extension install ShigureLab/gh-llm"
      missing=1
   fi

   if [[ "$missing" -eq 1 ]]; then
      warn "部分依赖缺失，请先安装后再运行"
      return 1
   fi

   ok "所有依赖检查通过！"
   return 0
}

# ═══════════════════════════════════════════
# 交互式配置
# ═══════════════════════════════════════════
configure() {
   info "开始交互式配置..."
   echo ""

   # nyako 模型
   ask "nyako（主 Agent）模型 [默认: minimax-portal/MiniMax-M2.5]:"
   read -r NYAKO_MODEL
   NYAKO_MODEL="${NYAKO_MODEL:-minimax-portal/MiniMax-M2.5}"

   # monitor-neko 模型
   ask "monitor-neko（监控喵）模型 [默认: google/gemini-3-flash-preview]:"
   read -r MONITOR_MODEL
   MONITOR_MODEL="${MONITOR_MODEL:-google/gemini-3-flash-preview}"

   # dev-neko 模型
   ask "dev-neko（开发喵）模型 [默认: openai-codex/gpt-5.3-codex]:"
   read -r DEV_MODEL
   DEV_MODEL="${DEV_MODEL:-openai-codex/gpt-5.3-codex}"

   # research-neko 模型
   ask "research-neko（调研喵）模型 [默认: openai-codex/gpt-5.3-codex]:"
   read -r RESEARCH_MODEL
   RESEARCH_MODEL="${RESEARCH_MODEL:-openai-codex/gpt-5.3-codex}"

   # plan-neko 模型
   ask "plan-neko（规划喵）模型 [默认: openai-codex/gpt-5.3-codex]:"
   read -r PLAN_MODEL
   PLAN_MODEL="${PLAN_MODEL:-openai-codex/gpt-5.3-codex}"

   echo ""
   info "配置摘要："
   echo "   nyako:         $NYAKO_MODEL"
   echo "   monitor-neko:  $MONITOR_MODEL"
   echo "   dev-neko:      $DEV_MODEL"
   echo "   research-neko: $RESEARCH_MODEL"
   echo "   plan-neko:     $PLAN_MODEL"
   echo "   NYAKO_HOME:    $NYAKO_HOME"
   echo ""
}

# ═══════════════════════════════════════════
# 部署 Agent workspace
# ═══════════════════════════════════════════
deploy_workspaces() {
   info "部署 Agent workspaces..."

   local agents=("nyako" "monitor-neko" "dev-neko" "research-neko" "plan-neko")

   for agent in "${agents[@]}"; do
      local src="${NYAKO_REPO}/agents/${agent}"
      local dest="${NYAKO_HOME}/workspace-${agent}"

      if [[ ! -d "$src" ]]; then
         warn "Agent 定义目录不存在: $src"
         continue
      fi

      # 创建 workspace 目录
      mkdir -p "$dest"

      # 同步文件（使用 rsync 保持幂等性）
      if command -v rsync &>/dev/null; then
         rsync -av --delete "$src/" "$dest/"
      else
         # 回退到 cp
         cp -R "$src/"* "$dest/"
      fi

      ok "已部署 ${agent} → ${dest}"
   done
}

# ═══════════════════════════════════════════
# 部署共享 Skills
# ═══════════════════════════════════════════
deploy_skills() {
   info "部署共享 Skills..."

   local skills_src="${NYAKO_REPO}/skills"
   local skills_dest="${NYAKO_HOME}/skills"

   if [[ ! -d "$skills_src" ]]; then
      warn "Skills 目录不存在: $skills_src"
      return
   fi

   mkdir -p "$skills_dest"

   if command -v rsync &>/dev/null; then
      rsync -av --delete "$skills_src/" "$skills_dest/"
   else
      cp -R "$skills_src/"* "$skills_dest/"
   fi

   ok "已部署共享 Skills → ${skills_dest}"
}

# ═══════════════════════════════════════════
# 生成 OpenClaw 配置
# ═══════════════════════════════════════════
generate_config() {
   info "配置 OpenClaw..."

   local config_file="${NYAKO_HOME}/openclaw.json"

   if [[ -f "$config_file" ]]; then
      # ── 已有配置：备份 + 合并 ──
      local backup_file="${config_file}.$(date +%Y%m%d%H%M%S).bak"
      cp "$config_file" "$backup_file"
      ok "已备份已有配置 → ${backup_file}"

      merge_config "$config_file"
      ok "已合并 Nyako 团队配置（其他配置项保持不变）"
   else
      # ── 全新安装：从模板生成 ──
      fresh_config "$config_file"
      ok "已生成全新配置 → ${config_file}"
   fi
}

# 全新安装：从模板生成配置
fresh_config() {
   local config_file="$1"

   sed \
      -e "s|\${NYAKO_HOME}|${NYAKO_HOME}|g" \
      -e "s|\${NYAKO_REPO}|${NYAKO_REPO}|g" \
      -e "s|\${NYAKO_MODEL:-minimax-portal/MiniMax-M2.5}|${NYAKO_MODEL}|g" \
      -e "s|\${NYAKO_DEFAULT_MODEL:-minimax-portal/MiniMax-M2.5}|${NYAKO_MODEL}|g" \
      -e "s|\${MONITOR_MODEL:-google/gemini-3-flash-preview}|${MONITOR_MODEL}|g" \
      -e "s|\${DEV_MODEL:-openai-codex/gpt-5.3-codex}|${DEV_MODEL}|g" \
      -e "s|\${RESEARCH_MODEL:-openai-codex/gpt-5.3-codex}|${RESEARCH_MODEL}|g" \
      -e "s|\${PLAN_MODEL:-openai-codex/gpt-5.3-codex}|${PLAN_MODEL}|g" \
      "${NYAKO_REPO}/openclaw.template.json5" > "$config_file"
}

# 已有配置：用 jq 只 patch nyako 团队相关字段，其他一概不动
merge_config() {
   local config_file="$1"

   # 构建 Agent 团队列表 JSON
   local agents_list
   agents_list=$(jq -n \
      --arg nyako_ws "${NYAKO_HOME}/workspace-nyako" \
      --arg monitor_ws "${NYAKO_HOME}/workspace-monitor-neko" \
      --arg dev_ws "${NYAKO_HOME}/workspace-dev-neko" \
      --arg research_ws "${NYAKO_HOME}/workspace-research-neko" \
      --arg plan_ws "${NYAKO_HOME}/workspace-plan-neko" \
      --arg nyako_model "$NYAKO_MODEL" \
      --arg monitor_model "$MONITOR_MODEL" \
      --arg dev_model "$DEV_MODEL" \
      --arg research_model "$RESEARCH_MODEL" \
      --arg plan_model "$PLAN_MODEL" \
      '[
         {
            id: "nyako", default: true,
            name: "Shigure Nyako",
            workspace: $nyako_ws,
            model: { primary: $nyako_model, fallbacks: ["google/gemini-3-flash-preview","zai/glm-4.7"] },
            identity: { name: "Shigure Nyako", theme: "cute team-leading cat", emoji: "🐱" },
            subagents: { allowAgents: ["monitor-neko","dev-neko","research-neko","plan-neko"] }
         },
         {
            id: "monitor-neko",
            name: "Monitor Neko",
            workspace: $monitor_ws,
            model: { primary: $monitor_model, fallbacks: ["minimax-portal/MiniMax-M2.1-lightning","zai/glm-4.7"] },
            identity: { name: "Monitor Neko", theme: "alert sentinel cat", emoji: "👀" },
            heartbeat: { every: "10m", target: "none" },
            subagents: { allowAgents: [] }
         },
         {
            id: "dev-neko",
            name: "Dev Neko",
            workspace: $dev_ws,
            model: { primary: $dev_model, fallbacks: ["github-copilot/gpt-5.3-codex","openai-codex/gpt-5.2-codex"] },
            identity: { name: "Dev Neko", theme: "focused engineer cat", emoji: "⌨️" },
            subagents: { allowAgents: ["research-neko","plan-neko"] }
         },
         {
            id: "research-neko",
            name: "Research Neko",
            workspace: $research_ws,
            model: { primary: $research_model, fallbacks: ["github-copilot/gpt-5.3-codex","github-copilot/claude-opus-4.6"] },
            identity: { name: "Research Neko", theme: "curious researcher cat", emoji: "🔍" },
            subagents: { allowAgents: [] }
         },
         {
            id: "plan-neko",
            name: "Plan Neko",
            workspace: $plan_ws,
            model: { primary: $plan_model, fallbacks: ["github-copilot/gpt-5.3-codex","github-copilot/claude-opus-4.6"] },
            identity: { name: "Plan Neko", theme: "organized strategist cat", emoji: "📋" },
            subagents: { allowAgents: ["research-neko"] }
         }
      ]'
   )

   # 用 jq patch 进已有配置——只动以下字段：
   #   agents.list              → 设置 5 个 Agent 定义
   #   agents.defaults.heartbeat.every → 默认关闭心跳（monitor-neko 在自身定义中覆盖）
   #   bindings                 → nyako 绑定 Telegram
   #   skills.load.extraDirs    → 确保包含 nyako skills 路径
   #
   # 不动的字段（举例）：
   #   meta, wizard, auth, models, channels, gateway, memory,
   #   hooks, plugins, session, commands, messages,
   #   agents.defaults.model, agents.defaults.models, agents.defaults.workspace,
   #   agents.defaults.memorySearch, agents.defaults.contextPruning, ...
   local tmp_file
   tmp_file=$(mktemp)

   jq --argjson agents_list "$agents_list" \
      --arg skills_dir "${NYAKO_REPO}/skills" \
      '
      # Agent 团队定义
      .agents.list = $agents_list |

      # 默认心跳关闭（仅 monitor-neko 在 list 中覆盖为 10m）
      .agents.defaults.heartbeat.every = "0m" |

      # Telegram 绑定
      .bindings = [{agentId: "nyako", match: {channel: "telegram"}}] |

      # 确保 skills 目录包含 nyako skills（去重）
      .skills.load.extraDirs = (
         (.skills.load.extraDirs // []) |
         if any(. == $skills_dir) then . else . + [$skills_dir] end
      )
      ' "$config_file" > "$tmp_file" && mv "$tmp_file" "$config_file"
}

# ═══════════════════════════════════════════
# 初始化运行时目录
# ═══════════════════════════════════════════
init_runtime() {
   info "初始化运行时目录..."

   # 任务目录
   mkdir -p "${NYAKO_DATA}/tasks"
   ok "任务目录: ${NYAKO_DATA}/tasks/"

   # 工作区目录
   mkdir -p "${NYAKO_DATA}/workspace"
   ok "工作区目录: ${NYAKO_DATA}/workspace/"

   # 记忆目录
   mkdir -p "${NYAKO_HOME}/memory"
   ok "记忆目录: ${NYAKO_HOME}/memory/"

   # Session 列表（如不存在则创建）
   local sessions_file="${NYAKO_DATA}/sessions.md"
   if [[ ! -f "$sessions_file" ]]; then
      cat > "$sessions_file" <<'EOF'
# Nyako Sessions

| id | agent | title | repos | prs | issues | status | created_at | updated_at |
|----|-------|-------|-------|-----|--------|--------|------------|------------|
EOF
      ok "已创建 Session 列表: ${sessions_file}"
   else
      ok "Session 列表已存在: ${sessions_file}"
   fi
}

# ═══════════════════════════════════════════
# 安装 gh-llm
# ═══════════════════════════════════════════
install_gh_llm() {
   if gh llm --version &>/dev/null 2>&1 || command -v gh-llm &>/dev/null; then
      ok "gh-llm 已安装，跳过"
      return
   fi

   info "安装 gh-llm..."
   if command -v gh &>/dev/null; then
      gh extension install ShigureLab/gh-llm
      ok "gh-llm 安装完成"
   else
      warn "gh 未安装，无法安装 gh-llm"
   fi
}

# ═══════════════════════════════════════════
# 注册 / 更新 Cron 任务
# ═══════════════════════════════════════════

# upsert 单个 cron job：存在则 edit，不存在则 add
_cron_upsert() {
   local name="$1" agent="$2" cron_expr="$3" tz="$4" message="$5" label="$6"
   shift 6

   # 检查是否已存在（通过 list --json 查找 name）
   local existing_id
   existing_id=$(openclaw cron list --json 2>/dev/null \
      | jq -r --arg n "$name" '.jobs[] | select(.name == $n) | .id // empty' 2>/dev/null \
      | head -1 || true)

   if [[ -n "$existing_id" && "$existing_id" != "null" ]]; then
      # 已存在 → edit
      openclaw cron edit "$existing_id" \
         --agent "$agent" \
         --name "$name" \
         --cron "$cron_expr" \
         --tz "$tz" \
         --message "$message" \
         --session isolated \
         --no-deliver \
         "$@" \
         2>&1 && ok "已更新 ${label}" || warn "${label} 更新失败"
   else
      # 不存在 → add
      openclaw cron add \
         --agent "$agent" \
         --name "$name" \
         --cron "$cron_expr" \
         --tz "$tz" \
         --message "$message" \
         --session isolated \
         --no-deliver \
         "$@" \
         2>&1 && ok "已注册 ${label}" || warn "${label} 注册失败（Gateway 可能未运行）"
   fi
}

register_cron_jobs() {
   info "注册 Cron 任务..."

   local crons_dir="${NYAKO_REPO}/crons"

   if [[ ! -d "$crons_dir" ]]; then
      warn "Crons 目录不存在: $crons_dir"
      return
   fi

   # 中频：推进已有 PR（每 1h）
   _cron_upsert \
      "dev-pr-review" "dev-neko" "0 * * * *" "Asia/Shanghai" \
      "$(cat "$crons_dir/dev-pr-review.md")" \
      "dev-pr-review（每 1h）"

   # 低频：处理开发任务（每 4h）
   _cron_upsert \
      "dev-new-task" "dev-neko" "0 */4 * * *" "Asia/Shanghai" \
      "$(cat "$crons_dir/dev-new-task.md")" \
      "dev-new-task（每 4h）"

   # 周频：低优维护（每周一 UTC+8 10:00）
   _cron_upsert \
      "dev-maintenance" "dev-neko" "0 10 * * 1" "Asia/Shanghai" \
      "$(cat "$crons_dir/dev-maintenance.md")" \
      "dev-maintenance（每周一）"

   echo ""
   info "Cron 调度总表："
   echo "   dev-pr-review     每 1 小时   推进已有 PR           crons/dev-pr-review.md"
   echo "   dev-new-task      每 4 小时   处理开发任务          crons/dev-new-task.md"
   echo "   dev-maintenance   每周一      低优维护              crons/dev-maintenance.md"
   echo ""
   info "monitor-neko 通过心跳（每 10min）驱动，配置在 openclaw.json 中"
   echo ""
   info "需要 Gateway 运行中才能注册 cron 任务"
   info "启动 Gateway 后运行: ./setup.sh --register-crons"
}

# ═══════════════════════════════════════════
# 完整安装
# ═══════════════════════════════════════════
install() {
   echo ""
   echo -e "${CYAN}🐱 Nyako Team - 赛博养猫计划${NC}"
   echo -e "${CYAN}═══════════════════════════════════════════${NC}"
   echo ""

   check_dependencies || error "依赖检查未通过，请先安装缺失的依赖"
   echo ""

   configure
   echo ""

   deploy_workspaces
   deploy_skills
   generate_config
   init_runtime
   install_gh_llm
   echo ""

   register_cron_jobs
   echo ""

   echo -e "${GREEN}═══════════════════════════════════════════${NC}"
   echo -e "${GREEN}🎉 部署完成！${NC}"
   echo ""
   echo "启动 OpenClaw Gateway："
   echo "   openclaw gateway --port 18789"
   echo ""
   echo "配置文件位置："
   echo "   ${NYAKO_HOME}/openclaw.json"
   echo ""
   echo "更新部署（保留配置）："
   echo "   ./setup.sh --update"
   echo ""
}

# ═══════════════════════════════════════════
# 更新部署（仅同步文件，不重置配置）
# ═══════════════════════════════════════════
update() {
   echo ""
   echo -e "${CYAN}🐱 Nyako Team - 更新部署${NC}"
   echo -e "${CYAN}═══════════════════════════════════════════${NC}"
   echo ""

   deploy_workspaces
   deploy_skills
   echo ""

   register_cron_jobs
   echo ""

   echo -e "${GREEN}═══════════════════════════════════════════${NC}"
   echo -e "${GREEN}🎉 更新完成！${NC}"
   echo ""
   echo "注意：配置文件未更新。如需更新配置，请运行 --install"
   echo ""
}

# ═══════════════════════════════════════════
# 入口
# ═══════════════════════════════════════════
main() {
   local action="${1:-}"

   case "$action" in
      --install)  install ;;
      --update)   update ;;
      --register-crons) register_cron_jobs ;;
      --check)    check_dependencies ;;
      --help|-h)  usage ;;
      "")
         echo "请指定操作：--install / --update / --register-crons / --check"
         echo "运行 --help 查看帮助"
         exit 1
         ;;
      *)
         error "未知选项: $action"
         ;;
   esac
}

main "$@"
