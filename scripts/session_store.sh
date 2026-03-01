#!/usr/bin/env bash
set -euo pipefail

NYAKO_DATA="${NYAKO_DATA:-$HOME/.nyako}"
SESSIONS_JSON="${NYAKO_DATA}/sessions.json"
SESSIONS_MD="${NYAKO_DATA}/sessions.md"
LOCK_DIR="${NYAKO_DATA}/.sessions.lock"

usage() {
  cat <<USAGE
Usage: $(basename "$0") <command> [options]

Commands:
  init
  list [--status <status>]
  create --id <id> --agent <agent> --title <title> [--repo <owner/repo>] [--pr <num>] [--issue <num>]
  set-status --id <id> --status <status>
  link --id <id> [--repo <owner/repo>] [--pr <num>] [--issue <num>]
  route --repo <owner/repo> [--pr <num>] [--issue <num>]
  touch --id <id>
  close --id <id>
  export-md
USAGE
}

ensure_dirs() {
  mkdir -p "$NYAKO_DATA"
}

ensure_store() {
  ensure_dirs
  if [[ ! -f "$SESSIONS_JSON" ]]; then
    cat > "$SESSIONS_JSON" <<JSON
{"version":1,"sessions":[]}
JSON
  fi
}

normalize_num() {
  local value="$1"
  echo "${value#\#}"
}

acquire_lock() {
  local retries=100
  local sleep_s=0.05
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    retries=$((retries - 1))
    if [[ "$retries" -le 0 ]]; then
      echo "Failed to acquire session lock: $LOCK_DIR" >&2
      exit 1
    fi
    sleep "$sleep_s"
  done
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
}

now_date() {
  date +%Y-%m-%d
}

json_write() {
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp"
  mv "$tmp" "$SESSIONS_JSON"
}

export_md() {
  ensure_store
  local tmp
  tmp="$(mktemp)"
  {
    echo "# Nyako Sessions"
    echo ""
    echo "| id | agent | title | repos | prs | issues | status | created_at | updated_at |"
    echo "|----|-------|-------|-------|-----|--------|--------|------------|------------|"
    jq -r '
      .sessions[]
      | [
          .id,
          .agent,
          .title,
          ((.repos // []) | join(",")),
          ((.prs // []) | map("#" + .) | join(",")),
          ((.issues // []) | map("#" + .) | join(",")),
          .status,
          .created_at,
          .updated_at
        ]
      | "| " + (join(" | ")) + " |"
    ' "$SESSIONS_JSON"
  } > "$tmp"
  mv "$tmp" "$SESSIONS_MD"
}

cmd_init() {
  ensure_store
  export_md
}

cmd_list() {
  ensure_store
  local status=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status)
        status="${2:-}"
        shift 2
        ;;
      *)
        echo "Unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  if [[ -n "$status" ]]; then
    jq --arg s "$status" '.sessions | map(select(.status == $s))' "$SESSIONS_JSON"
  else
    jq '.sessions' "$SESSIONS_JSON"
  fi
}

cmd_create() {
  ensure_store
  local id="" agent="" title="" repo="" pr="" issue="" status="active"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="${2:-}"; shift 2 ;;
      --agent) agent="${2:-}"; shift 2 ;;
      --title) title="${2:-}"; shift 2 ;;
      --repo) repo="${2:-}"; shift 2 ;;
      --pr) pr="$(normalize_num "${2:-}")"; shift 2 ;;
      --issue) issue="$(normalize_num "${2:-}")"; shift 2 ;;
      --status) status="${2:-}"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$id" || -z "$agent" || -z "$title" ]]; then
    echo "Missing required arguments: --id --agent --title" >&2
    exit 1
  fi

  acquire_lock
  local today
  today="$(now_date)"

  jq \
    --arg id "$id" \
    --arg agent "$agent" \
    --arg title "$title" \
    --arg repo "$repo" \
    --arg pr "$pr" \
    --arg issue "$issue" \
    --arg status "$status" \
    --arg today "$today" \
    '
    if any(.sessions[]; .id == $id) then
      error("session already exists: " + $id)
    else
      .sessions += [{
        id: $id,
        agent: $agent,
        title: $title,
        repos: (if $repo == "" then [] else [$repo] end),
        prs: (if $pr == "" then [] else [$pr] end),
        issues: (if $issue == "" then [] else [$issue] end),
        status: $status,
        created_at: $today,
        updated_at: $today
      }]
    end
    ' "$SESSIONS_JSON" | json_write

  export_md
}

cmd_set_status() {
  ensure_store
  local id="" status=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="${2:-}"; shift 2 ;;
      --status) status="${2:-}"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$id" || -z "$status" ]]; then
    echo "Missing required arguments: --id --status" >&2
    exit 1
  fi

  acquire_lock
  local today
  today="$(now_date)"
  jq --arg id "$id" --arg status "$status" --arg today "$today" '
    .sessions |= map(if .id == $id then .status = $status | .updated_at = $today else . end)
  ' "$SESSIONS_JSON" | json_write

  export_md
}

cmd_link() {
  ensure_store
  local id="" repo="" pr="" issue=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="${2:-}"; shift 2 ;;
      --repo) repo="${2:-}"; shift 2 ;;
      --pr) pr="$(normalize_num "${2:-}")"; shift 2 ;;
      --issue) issue="$(normalize_num "${2:-}")"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$id" ]]; then
    echo "Missing required argument: --id" >&2
    exit 1
  fi

  acquire_lock
  local today
  today="$(now_date)"
  jq --arg id "$id" --arg repo "$repo" --arg pr "$pr" --arg issue "$issue" --arg today "$today" '
    .sessions |= map(
      if .id == $id then
        .repos = ((.repos // []) + (if $repo == "" then [] else [$repo] end) | unique) |
        .prs = ((.prs // []) + (if $pr == "" then [] else [$pr] end) | unique) |
        .issues = ((.issues // []) + (if $issue == "" then [] else [$issue] end) | unique) |
        .updated_at = $today
      else
        .
      end
    )
  ' "$SESSIONS_JSON" | json_write

  export_md
}

cmd_route() {
  ensure_store
  local repo="" pr="" issue=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo) repo="${2:-}"; shift 2 ;;
      --pr) pr="$(normalize_num "${2:-}")"; shift 2 ;;
      --issue) issue="$(normalize_num "${2:-}")"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$repo" ]]; then
    echo "Missing required argument: --repo" >&2
    exit 1
  fi

  jq -r --arg repo "$repo" --arg pr "$pr" --arg issue "$issue" '
    .sessions
    | map(select(.status == "active"))
    | map(
        . + {
          _score:
            (if ($pr != "" and ((.prs // []) | index($pr) != null)) or ($issue != "" and ((.issues // []) | index($issue) != null)) then 2
             elif ((.repos // []) | index($repo) != null) then 1
             else 0 end)
        }
      )
    | map(select(._score > 0))
    | sort_by([._score, .updated_at])
    | reverse
    | .[0] // empty
  ' "$SESSIONS_JSON"
}

cmd_touch() {
  ensure_store
  local id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="${2:-}"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$id" ]]; then
    echo "Missing required argument: --id" >&2
    exit 1
  fi

  acquire_lock
  local today
  today="$(now_date)"
  jq --arg id "$id" --arg today "$today" '
    .sessions |= map(if .id == $id then .updated_at = $today else . end)
  ' "$SESSIONS_JSON" | json_write

  export_md
}

cmd_close() {
  cmd_set_status --id "$1" --status done
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    init) cmd_init "$@" ;;
    list) cmd_list "$@" ;;
    create) cmd_create "$@" ;;
    set-status) cmd_set_status "$@" ;;
    link) cmd_link "$@" ;;
    route) cmd_route "$@" ;;
    touch) cmd_touch "$@" ;;
    close)
      if [[ "${1:-}" == "--id" ]]; then
        cmd_set_status --id "${2:-}" --status done
      else
        echo "Usage: $(basename "$0") close --id <id>" >&2
        exit 1
      fi
      ;;
    export-md) ensure_store; export_md ;;
    -h|--help|"") usage ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
