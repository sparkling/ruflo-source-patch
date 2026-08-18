#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "${RSP_NODE_BIN:-node}" "$SCRIPT_DIR/codex-switch.mjs" "$@"
