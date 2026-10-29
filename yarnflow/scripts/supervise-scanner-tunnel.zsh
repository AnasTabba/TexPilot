#!/bin/zsh
# Installed by the operator into ~/Library/Application Support/Yarnflow with a pinned
# Wrangler installation there. launchd can read this location without Documents access.
# Only the scanner URL is changed; no model files, inventory rows or tracking credits.
set -u
runtime="${YARNFLOW_TUNNEL_RUNTIME:-${0:A:h}}"
node_bin=/opt/homebrew/bin/node
wrangler_cli="$runtime/node_modules/wrangler/bin/wrangler.js"
tunnel_pid=""
mkdir -p "$runtime"
chmod 700 "$runtime"
function stop_tunnel() {
  if [[ -n "$tunnel_pid" ]]; then
    kill "$tunnel_pid" 2>/dev/null || true
    sleep 2
    kill -9 "$tunnel_pid" 2>/dev/null || true
    wait "$tunnel_pid" 2>/dev/null || true
    tunnel_pid=""
  fi
}
trap 'stop_tunnel; exit 0' INT TERM
function ready() {
  /usr/bin/curl -fsS --max-time 15 "$1/api/v1/model" 2>/dev/null | /usr/bin/grep -Eq '"ready"[[:space:]]*:[[:space:]]*true'
}
if [[ ! -f "$wrangler_cli" ]]; then
  print 'Pinned Wrangler is missing from the scanner supervisor runtime.' >&2
  exit 1
fi
while true; do
  if ! ready http://127.0.0.1:8000; then
    print "$(date -u +%FT%TZ) Waiting for the local trained scanner."
    sleep 60
    continue
  fi
  tunnel_log="$runtime/current-tunnel.log"
  : > "$tunnel_log"
  chmod 600 "$tunnel_log"
  /opt/homebrew/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8000 > "$tunnel_log" 2>&1 &
  tunnel_pid=$!
  ready_url=""
  for attempt in {1..60}; do
    kill -0 "$tunnel_pid" 2>/dev/null || break
    candidate=$(/usr/bin/grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$tunnel_log" | /usr/bin/head -1)
    if [[ -n "$candidate" ]] && /usr/bin/grep -q 'Registered tunnel connection' "$tunnel_log" && ready "$candidate"; then
      ready_url="$candidate"
      break
    fi
    sleep 2
  done
  if [[ -z "$ready_url" ]]; then
    print "$(date -u +%FT%TZ) Tunnel startup failed; retrying in one minute."
    stop_tunnel
    sleep 60
    continue
  fi
  print -rn -- "$ready_url" > "$runtime/endpoint.txt"
  chmod 600 "$runtime/endpoint.txt"
  configured=0
  for attempt in {1..3}; do
    if "$node_bin" "$wrangler_cli" secret put TEXPILOT_API_URL --name yarnflow --cwd "$runtime" < "$runtime/endpoint.txt"; then
      configured=1
      break
    fi
    sleep 20
  done
  if [[ "$configured" != 1 ]]; then
    print "$(date -u +%FT%TZ) Worker endpoint update failed. Check Wrangler credentials; retrying in five minutes." >&2
    stop_tunnel
    sleep 300
    continue
  fi
  print "$(date -u +%FT%TZ) Scanner tunnel is connected and Worker endpoint updated."
  failure_count=0
  while kill -0 "$tunnel_pid" 2>/dev/null; do
    sleep 60
    if ready "$ready_url"; then
      failure_count=0
    else
      failure_count=$((failure_count+1))
    fi
    if [[ "$failure_count" -ge 2 ]]; then
      print "$(date -u +%FT%TZ) Tunnel failed two health checks; reconnecting."
      break
    fi
  done
  stop_tunnel
  sleep 10
done
