#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STATE_FILE=${ARKSPACE_USEGPT_PROBE_TASK_FILE:-"$ROOT_DIR/.scratch/usegpt-secure-mcp/task.json"}

: "${CONTROL_PLANE_API_KEY:?Set CONTROL_PLANE_API_KEY in this trusted terminal}"
: "${CONTROL_PLANE_TUNNEL_ID:?Set CONTROL_PLANE_TUNNEL_ID in this trusted terminal}"
command -v tunnel-client >/dev/null || { echo "tunnel-client is not installed; download it from the OpenAI Tunnel settings or the official release." >&2; exit 1; }
[[ -f "$ROOT_DIR/dist/usegpt/secure-mcp-probe.js" ]] || { echo "Build the experiment first: npm run build" >&2; exit 1; }

export ARKSPACE_USEGPT_PROBE_TASK_FILE="$STATE_FILE"
mkdir -p "$(dirname "$STATE_FILE")"
node "$ROOT_DIR/dist/usegpt/secure-mcp-probe.js" seed "${*:-Return the marker exactly and briefly explain the result.}"
echo "Keep this process running. In ChatGPT, call usegpt_probe_present on the connected UseGPT MCP app." >&2
exec tunnel-client run \
  --mcp.command "node $ROOT_DIR/dist/usegpt/secure-mcp-probe.js" \
  --log.level=info \
  --log.format=struct-text
