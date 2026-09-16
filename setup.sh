#!/usr/bin/env bash
# InnerLore one-step server-plugin setup.
#
# Run from anywhere after installing the InnerLore extension:
#   bash setup.sh [path-to-sillytavern]
#
# What it does:
#   1. Locates your SillyTavern root (argument, $ST_ROOT, or auto-detect).
#   2. Links this repository's bundled SQLite plugin into plugins/.
#   3. Enables enableServerPlugins in config.yaml if needed.
#   4. Prints the one remaining step: restart SillyTavern.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$REPO_ROOT/server/innerlore-storage"
PLUGIN_NAME="innerlore-storage"

say() { printf '\033[1;34m[InnerLore]\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m[InnerLore]\033[0m %s\n' "$1" >&2; exit 1; }

# ---- 1. Locate the SillyTavern root -------------------------------------
CANDIDATES=()
[ "${1:-}" ] && CANDIDATES+=("$1")
[ "${ST_ROOT:-}" ] && CANDIDATES+=("$ST_ROOT")
# ST installs extensions at data/<user>/extensions/third-party/<name>:
# the ST root is four levels above the checkout.
CANDIDATES+=("$REPO_ROOT/../../../../.." "$REPO_ROOT/../../../.." "$REPO_ROOT/../../.." "$REPO_ROOT/../.." "$REPO_ROOT/.." "$(pwd)")

ST_ROOT=""
for c in "${CANDIDATES[@]}"; do
    resolved="$(cd "$c" 2>/dev/null && pwd)" || continue
    if [ -f "$resolved/server.js" ] && [ -d "$resolved/src" ]; then
        ST_ROOT="$resolved"
        break
    fi
    # Common layouts: extension checked out inside ST, or ST under a parent
    for guess in "$resolved/SillyTavern" "$resolved/sillytavern"; do
        if [ -f "$guess/server.js" ] && [ -d "$guess/src" ]; then
            ST_ROOT="$(cd "$guess" && pwd)"
            break
        fi
    done
    [ "$ST_ROOT" ] && break
done

[ "$ST_ROOT" ] || die "Could not find your SillyTavern folder. Run: bash setup.sh /path/to/SillyTavern"
say "SillyTavern root: $ST_ROOT"

# ---- 2. Link the bundled plugin ------------------------------------------
PLUGINS_DIR="$ST_ROOT/plugins"
mkdir -p "$PLUGINS_DIR"
PLUGIN_DST="$PLUGINS_DIR/$PLUGIN_NAME"

if [ -L "$PLUGIN_DST" ] || [ -e "$PLUGIN_DST" ]; then
    say "Plugin already present at $PLUGIN_DST (leaving untouched)."
else
    # Symlink keeps the extension and plugin in sync from one checkout;
    # fall back to a copy when symlinks are unavailable (some Windows setups).
    if ln -s "$PLUGIN_SRC" "$PLUGIN_DST" 2>/dev/null; then
        say "Linked plugin: $PLUGIN_DST -> $PLUGIN_SRC"
    else
        cp -r "$PLUGIN_SRC" "$PLUGIN_DST"
        say "Copied plugin to $PLUGIN_DST"
    fi
fi

# ---- 3. Enable server plugins in config.yaml -----------------------------
CONFIG="$ST_ROOT/config.yaml"
if [ ! -f "$CONFIG" ]; then
    say "No config.yaml found at $CONFIG — it is created on first launch."
    say "After it exists, ensure: enableServerPlugins: true"
elif grep -Eq '^\s*enableServerPlugins:\s*true\b' "$CONFIG"; then
    say "Server plugins already enabled in config.yaml."
else
    if grep -Eq '^\s*#\s*enableServerPlugins:' "$CONFIG"; then
        sed -i.bak -E 's|^\s*#\s*(enableServerPlugins:.*)|\1|' "$CONFIG"
        sed -i.bak -E 's|^(\s*enableServerPlugins:)\s*\S+.*|\1 true|' "$CONFIG"
    elif grep -Eq '^\s*enableServerPlugins:' "$CONFIG"; then
        sed -i.bak -E 's|^(\s*enableServerPlugins:)\s*\S+.*|\1 true|' "$CONFIG"
    else
        printf '\nenableServerPlugins: true\n' >> "$CONFIG"
    fi
    say "Enabled enableServerPlugins in config.yaml (backup: config.yaml.bak)."
fi

# ---- 4. Done -------------------------------------------------------------
say "Setup complete. Restart SillyTavern, then verify:"
echo "    curl http://127.0.0.1:8000/api/plugins/$PLUGIN_NAME/v1/health"
