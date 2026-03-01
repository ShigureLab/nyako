#!/usr/bin/env bash
set -euo pipefail

NYAKO_HOME="${NYAKO_HOME:-$HOME/.openclaw}"
NYAKO_DATA="${NYAKO_DATA:-$HOME/.nyako}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

ok() { echo "[OK] $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*"; FAIL=1; }

check_file() {
  local path="$1" label="$2"
  if [[ -f "$path" ]]; then
    ok "$label: $path"
  else
    fail "$label missing: $path"
  fi
}

check_dir() {
  local path="$1" label="$2"
  if [[ -d "$path" ]]; then
    ok "$label: $path"
  else
    fail "$label missing: $path"
  fi
}

check_file "$NYAKO_HOME/openclaw.json" "OpenClaw config"
check_dir "$NYAKO_HOME/workspace-monitor-neko" "monitor workspace"
check_dir "$NYAKO_HOME/workspace-dev-neko" "dev workspace"

check_file "$NYAKO_DATA/sessions.json" "Session store"
check_file "$NYAKO_DATA/sessions.md" "Session markdown"

if command -v jq >/dev/null 2>&1 && [[ -f "$NYAKO_HOME/openclaw.json" ]]; then
  hb_default="$(jq -r '.agents.defaults.heartbeat.every // "<missing>"' "$NYAKO_HOME/openclaw.json" 2>/dev/null || echo "<error>")"
  hb_monitor="$(jq -r '.agents.list[] | select(.id=="monitor-neko") | .heartbeat.every // "<missing>"' "$NYAKO_HOME/openclaw.json" 2>/dev/null || echo "<error>")"
  monitor_fallbacks="$(jq -r '.agents.list[] | select(.id=="monitor-neko") | .model.fallbacks[]?' "$NYAKO_HOME/openclaw.json" 2>/dev/null || true)"

  echo "[INFO] heartbeat default: $hb_default"
  echo "[INFO] heartbeat monitor-neko: $hb_monitor"

  if printf '%s\n' "$monitor_fallbacks" | grep -q 'MiniMax-M2.1-lightning'; then
    fail "monitor fallback still includes MiniMax-M2.1-lightning"
  else
    ok "monitor fallback does not include MiniMax-M2.1-lightning"
  fi

  tg_bot="$(jq -r '.channels.telegram.botToken // empty' "$NYAKO_HOME/openclaw.json" 2>/dev/null || true)"
  if [[ -n "$tg_bot" ]]; then
    ok "telegram botToken is configured"
  else
    warn "telegram botToken is empty (set TELEGRAM_BOT_TOKEN and run setup)"
  fi
fi

if command -v openclaw >/dev/null 2>&1; then
  if openclaw health >/dev/null 2>&1; then
    ok "openclaw gateway health check passed"
  else
    warn "openclaw gateway health check failed"
  fi
else
  warn "openclaw command not found"
fi

if [[ -x "$REPO_ROOT/scripts/monitor_health_check.sh" ]]; then
  "$REPO_ROOT/scripts/monitor_health_check.sh" --last-lines 1500 || warn "monitor health script failed"
fi

if [[ "$FAIL" -eq 1 ]]; then
  exit 1
fi
