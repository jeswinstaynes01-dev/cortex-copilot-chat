#!/usr/bin/env bash
# Builds Cortex (React UI + Spring Boot backend) and runs it as one app on http://localhost:8080.
#
#   ./start.sh                  build, then run
#   ./start.sh --skip-build     run the existing jar (builds anyway when there is none)
#   ./start.sh --port 9090
#   ./start.sh --copilot.provider.type=openai \
#              --copilot.provider.base-url=http://localhost:11434/v1 \
#              '--copilot.provider.models[0]=llama3.2'    # a local model through Ollama
#
# Arguments the script doesn't recognise go straight to Spring Boot.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
jar="$root/copilot-dashboard/backend/target/copilot-dashboard-backend-0.0.1-SNAPSHOT.jar"
skip_build=false
port=8080
app_args=()

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) skip_build=true ;;
    --port) port="${2:?--port needs a value}"; shift ;;
    *) app_args+=("$1") ;;
  esac
  shift
done

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "'$1' was not found on PATH. $2" >&2; exit 1; }
}

need java "Install a JDK 17 or newer."
[ -n "${COPILOT_CLI_PATH:-}" ] ||
  need copilot "Install the GitHub Copilot CLI (npm install -g @github/copilot) or set COPILOT_CLI_PATH."

if [ "$skip_build" = false ] || [ ! -f "$jar" ]; then
  need node "Install Node.js 22 LTS (Vite needs 20.19+ or 22.12+)."
  need mvn "Install Maven 3.9 or newer."
  echo "==> Building the UI"
  (cd "$root/cortex-chat" && { [ -d node_modules ] || npm ci; } && npm run build)
  echo "==> Packaging the backend"
  (cd "$root/copilot-dashboard/backend" && mvn -q -DskipTests package)
fi

echo "==> Starting Cortex on http://localhost:$port (Ctrl+C to stop)"
# The ${a[@]+...} form keeps an empty array safe under `set -u` on bash 3.2 (macOS).
exec java -jar "$jar" "--server.port=$port" ${app_args[@]+"${app_args[@]}"}
