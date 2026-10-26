# Shared ESP-IDF v5.4.1 and esp-matter environment for firmware builds.
# Source this file. Paths come from the environment. Do not hard-code a home directory.

if [[ -z "${IDF_PATH:-}" ]]; then
  echo "IDF_PATH is not set" >&2
  return 2
fi
if [[ ! -f "$IDF_PATH/tools/idf.py" ]]; then
  echo "IDF_PATH does not contain tools/idf.py: $IDF_PATH" >&2
  return 2
fi
if [[ -n "${ESP_MATTER_PATH:-}" && ! -d "$ESP_MATTER_PATH/components" ]]; then
  echo "ESP_MATTER_PATH does not look like esp-matter: $ESP_MATTER_PATH" >&2
  return 2
fi

_iotedu_apply_eim_env() {
  local line key val orig_path="$PATH"
  while IFS= read -r line; do
    key="${line%%=*}"
    val="${line#*=}"
    case "$key" in
      PATH)
        export PATH="${val}:${orig_path}"
        ;;
      IDF_PATH|IDF_TOOLS_PATH|IDF_PYTHON_ENV_PATH|ESP_ROM_ELF_DIR|OPENOCD_SCRIPTS|ESP_IDF_VERSION|IDF_COMPONENT_LOCAL_STORAGE_URL)
        export "${key}=${val}"
        ;;
    esac
  done < <(bash "$IDF_ACTIVATE" -e)
  if [[ -z "${IDF_PYTHON_ENV_PATH:-}" || ! -x "$IDF_PYTHON_ENV_PATH/bin/python" ]]; then
    echo "IDF_ACTIVATE -e did not produce a usable IDF_PYTHON_ENV_PATH" >&2
    return 2
  fi
  # shellcheck disable=SC1091
  source "$IDF_PYTHON_ENV_PATH/bin/activate"
}

if [[ -n "${IDF_ACTIVATE:-}" ]]; then
  if [[ ! -f "$IDF_ACTIVATE" ]]; then
    echo "IDF_ACTIVATE is set but not a file: $IDF_ACTIVATE" >&2
    return 2
  fi
  _iotedu_apply_eim_env
elif [[ -f "$IDF_PATH/export.sh" ]]; then
  set +u
  # shellcheck disable=SC1091
  source "$IDF_PATH/export.sh"
  set -u
else
  echo "Neither IDF_ACTIVATE nor IDF_PATH/export.sh is usable" >&2
  return 2
fi

CHIP_ROOT="$ESP_MATTER_PATH/connectedhomeip/connectedhomeip"
CHIP_PIGWEED_BIN="$CHIP_ROOT/.environment/cipd/packages/pigweed"
export PW_PROJECT_ROOT="$CHIP_ROOT"
export _PW_ACTUAL_ENVIRONMENT_ROOT="$CHIP_ROOT/.environment"
if [[ -d "$CHIP_ROOT/third_party/pigweed/repo" ]]; then
  export PW_ROOT="$CHIP_ROOT/third_party/pigweed/repo"
fi
if [[ -x "$CHIP_PIGWEED_BIN/gn" ]]; then
  export PATH="$CHIP_PIGWEED_BIN:$PATH"
else
  echo "warning: gn not found under $CHIP_PIGWEED_BIN; CHIP CMake will fail unless gn is on PATH" >&2
fi
