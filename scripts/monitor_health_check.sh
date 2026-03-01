#!/usr/bin/env bash
set -euo pipefail

NYAKO_HOME="${NYAKO_HOME:-$HOME/.openclaw}"
NYAKO_DATA="${NYAKO_DATA:-$HOME/.nyako}"
ERR_LOG="${NYAKO_HOME}/logs/gateway.err.log"
OUT_DIR="${NYAKO_DATA}/health"
OUT_FILE="${OUT_DIR}/monitor-heartbeat.jsonl"
LAST_LINES=2000
JSON_MODE=0
ALERT=0
CONSECUTIVE_FAIL_THRESHOLD=3

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Options:
  --last-lines <n>   Parse last n lines from gateway.err.log (default: 2000)
  --json             Print JSON only
  --alert            Try sending alert to telegram when unhealthy (requires TELEGRAM_CHAT_ID)
  --help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --last-lines) LAST_LINES="${2:-}"; shift 2 ;;
    --json) JSON_MODE=1; shift ;;
    --alert) ALERT=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$ERR_LOG" ]]; then
  echo "gateway err log not found: $ERR_LOG" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

chunk="$(tail -n "$LAST_LINES" "$ERR_LOG" 2>/dev/null || true)"
monitor_diag_count="$(printf '%s\n' "$chunk" | grep -E -c 'lane=session:agent:monitor-neko:main' || true)"
rate_limit_count="$(printf '%s\n' "$chunk" | grep -E -c 'lane=session:agent:monitor-neko:main.*rate limit|All models failed .*rate_limit' || true)"
unsupported_count="$(printf '%s\n' "$chunk" | grep -E -c 'lane=session:agent:monitor-neko:main.*not support model|All models failed .*not support model' || true)"
auth_profile_count="$(printf '%s\n' "$chunk" | grep -E -c 'lane=session:agent:monitor-neko:main.*No available auth profile' || true)"

consecutive_failures=0
while IFS= read -r line; do
  if [[ "$line" == *"lane=session:agent:monitor-neko:main"* ]]; then
    consecutive_failures=$((consecutive_failures + 1))
  else
    break
  fi
done < <(printf '%s\n' "$chunk" | tail -r)

status="healthy"
if [[ "$monitor_diag_count" -eq 0 ]]; then
  status="unknown"
elif [[ "$consecutive_failures" -ge "$CONSECUTIVE_FAIL_THRESHOLD" ]]; then
  status="unhealthy"
elif [[ "$unsupported_count" -gt 0 ]]; then
  status="degraded"
elif [[ "$rate_limit_count" -gt 0 || "$auth_profile_count" -gt 0 ]]; then
  status="degraded"
fi

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

payload="$(jq -n \
  --arg ts "$timestamp" \
  --arg status "$status" \
  --argjson last_lines "$LAST_LINES" \
  --argjson monitor_diag_count "$monitor_diag_count" \
  --argjson rate_limit_count "$rate_limit_count" \
  --argjson unsupported_count "$unsupported_count" \
  --argjson auth_profile_count "$auth_profile_count" \
  --argjson consecutive_failures "$consecutive_failures" \
  '{
    timestamp: $ts,
    status: $status,
    source: "gateway.err.log",
    window: {last_lines: $last_lines},
    metrics: {
      monitor_diag_count: $monitor_diag_count,
      rate_limit_count: $rate_limit_count,
      unsupported_model_count: $unsupported_count,
      auth_profile_unavailable_count: $auth_profile_count,
      consecutive_failures: $consecutive_failures
    }
  }')"

echo "$payload" >> "$OUT_FILE"

if [[ "$JSON_MODE" -eq 1 ]]; then
  echo "$payload"
else
  echo "monitor health: $status"
  echo "  diag_count:            $monitor_diag_count"
  echo "  consecutive_failures:  $consecutive_failures"
  echo "  rate_limit_count:      $rate_limit_count"
  echo "  unsupported_model:     $unsupported_count"
  echo "  auth_profile_missing:  $auth_profile_count"
  echo "  metrics_log:           $OUT_FILE"
fi

if [[ "$ALERT" -eq 1 && "$status" != "healthy" ]]; then
  if [[ -z "${TELEGRAM_CHAT_ID:-}" ]]; then
    echo "alert skipped: TELEGRAM_CHAT_ID is not set" >&2
    exit 0
  fi

  if command -v openclaw >/dev/null 2>&1; then
    msg="[monitor-neko] health=$status consecutive_failures=$consecutive_failures rate_limit=$rate_limit_count unsupported_model=$unsupported_count"
    openclaw message send --channel telegram --target "$TELEGRAM_CHAT_ID" --message "$msg" >/dev/null 2>&1 || \
      echo "alert failed: unable to send telegram message" >&2
  fi
fi
