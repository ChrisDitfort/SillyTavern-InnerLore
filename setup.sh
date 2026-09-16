#!/usr/bin/env bash
# Thin wrapper: the portable implementation lives in setup.js (Node only,
# identical on Linux/macOS/Windows). This wrapper exists for muscle memory.
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup.js" "$@"
