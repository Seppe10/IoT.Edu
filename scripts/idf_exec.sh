#!/usr/bin/env bash
# Run one allowlisted toolchain command with the ESP-IDF v5.4.1 environment.
# Arguments are passed to exec. They are not interpolated into a shell string.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/idf_env.sh"

cmd="${1:-}"
shift || true

case "$cmd" in
  idf)
    exec python "$IDF_PATH/tools/idf.py" "$@"
    ;;
  ota-create)
    if [[ $# -ne 6 ]]; then
      echo "ota-create expects vendor product version version-string input output" >&2
      exit 2
    fi
    exec python "$ESP_MATTER_PATH/connectedhomeip/connectedhomeip/src/app/ota_image_tool.py" create \
      -v "$1" -p "$2" -vn "$3" -vs "$4" -da sha256 "$5" "$6"
    ;;
  ota-show)
    if [[ $# -ne 1 ]]; then
      echo "ota-show expects one image path" >&2
      exit 2
    fi
    exec python "$ESP_MATTER_PATH/connectedhomeip/connectedhomeip/src/app/ota_image_tool.py" show "$1"
    ;;
  merge-bin)
    exec python -m esptool --chip esp32h2 merge_bin "$@"
    ;;
  *)
    echo "unsupported toolchain command" >&2
    exit 2
    ;;
esac
