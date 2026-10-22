#!/usr/bin/env bash
# Run one allowlisted toolchain command with the ESP-IDF v5.4.1 environment.
# Arguments are passed to exec. They are not interpolated into a shell string.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/idf_env.sh"

valid_port() {
  case "$1" in
    /dev/cu.usbmodem*|/dev/cu.usbserial*|/dev/cu.wchusbserial*|/dev/cu.SLAB_USBtoUART*)
      ;;
    *)
      echo "rejected serial port" >&2
      exit 2
      ;;
  esac
  case "$1" in
    *..*|*[!A-Za-z0-9._/-]*)
      echo "rejected serial port" >&2
      exit 2
      ;;
  esac
}

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
  chip-id)
    valid_port "${1:-}"
    exec python -m esptool --chip esp32h2 --port "$1" chip_id
    ;;
  write-flash)
    port=""
    prev=""
    saw_write=0
    for arg in "$@"; do
      case "$arg" in
        --erase-all|--erase-flash|erase_flash|erase_region|--force)
          echo "erase is not permitted" >&2
          exit 2
          ;;
        write_flash)
          saw_write=1
          ;;
      esac
      if [[ "$prev" == "--port" || "$prev" == "-p" ]]; then
        port="$arg"
      fi
      prev="$arg"
    done
    if [[ "$saw_write" -ne 1 ]]; then
      echo "only write_flash is permitted" >&2
      exit 2
    fi
    valid_port "$port"
    exec python -m esptool --chip esp32h2 "$@"
    ;;
  monitor)
    valid_port "${1:-}"
    if [[ "${2:-}" != "115200" ]]; then
      echo "unsupported baud" >&2
      exit 2
    fi
    exec python "$ROOT/scripts/serial_read.py" "$1" "$2"
    ;;
  *)
    echo "unsupported toolchain command" >&2
    exit 2
    ;;
esac
