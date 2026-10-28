#!/bin/zsh
# Gives the TexPilot scanner on this Mac (port 8000) an HTTPS address and points the published
# Yarnflow site at it (the TEXPILOT_API_URL secret of the "yarnflow" Worker). Run it after the
# scanner is up and keep the window open while scanning; Ctrl-C closes the tunnel.
set -euo pipefail
cd "${0:A:h}/.."
curl -sf -m 5 http://127.0.0.1:8000/api/v1/model >/dev/null || { echo "Start the TexPilot scanner on port 8000 first."; exit 1; }
log=$(mktemp -t yarnflow-tunnel)
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8000 >"$log" 2>&1 &
tunnel=$!
trap 'kill $tunnel 2>/dev/null; rm -f "$log"' EXIT INT TERM
url=""
# A new tunnel answers only once it has registered and its address resolves: wait for both.
for _ in {1..90}; do
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)
  [[ -n $url ]] && grep -q "Registered tunnel connection" "$log" && curl -sf -m 10 "$url/api/v1/model" >/dev/null && break
  url=""
  sleep 2
done
[[ -n $url ]] || { echo "The tunnel did not come up:"; tail -20 "$log"; exit 1; }
echo "Scanner tunnel: $url"
npx wrangler secret put TEXPILOT_API_URL < <(print -rn -- "$url")
echo "The published Yarnflow now scans through this Mac. Leave this window open."
wait $tunnel
