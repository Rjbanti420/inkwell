#!/usr/bin/env bash
# Install Inkwell for the current user, no root required.
set -euo pipefail

APP_ID="dev.inkwell.editor"
APP_NAME="inkwell"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BIN_SOURCE="$ROOT/src-tauri/target/release/inkwell"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ICON_DIR="$DATA_HOME/icons/hicolor"
APPS_DIR="$DATA_HOME/applications"

usage() {
  cat <<EOF
Usage: $0 [install|uninstall]

  install    Build output must exist first: npm run build
  uninstall  Remove the binary, desktop entry, and icons. App data is kept.
EOF
}

refresh_caches() {
  if command -v update-desktop-database >/dev/null; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  fi
  if command -v gtk-update-icon-cache >/dev/null; then
    gtk-update-icon-cache -f -t "$ICON_DIR" >/dev/null 2>&1 || true
  fi
}

register_markdown() {
  if command -v xdg-mime >/dev/null; then
    xdg-mime default "$APP_ID.desktop" text/markdown text/x-markdown
  fi
}

install_app() {
  if [[ ! -x "$BIN_SOURCE" ]]; then
    echo "Missing $BIN_SOURCE" >&2
    echo "Run 'npm run build' first." >&2
    exit 1
  fi

  install -Dm755 "$BIN_SOURCE" "$BIN_DIR/$APP_NAME"
  install -Dm644 "$ROOT/src-tauri/icons/32x32.png" "$ICON_DIR/32x32/apps/$APP_ID.png"
  install -Dm644 "$ROOT/src-tauri/icons/128x128.png" "$ICON_DIR/128x128/apps/$APP_ID.png"
  install -Dm644 "$ROOT/src-tauri/icons/128x128@2x.png" "$ICON_DIR/256x256/apps/$APP_ID.png"
  install -Dm644 "$ROOT/packaging/dev.inkwell.editor.desktop" "$APPS_DIR/$APP_ID.desktop"

  if command -v desktop-file-validate >/dev/null; then
    desktop-file-validate "$APPS_DIR/$APP_ID.desktop"
  fi
  refresh_caches
  register_markdown

  echo "Installed Inkwell:"
  echo "  $BIN_DIR/$APP_NAME"
  echo "  $APPS_DIR/$APP_ID.desktop"
  echo "It is now available in the app launcher and as a .md handler."
}

uninstall_app() {
  rm -f "$BIN_DIR/$APP_NAME"
  rm -f "$APPS_DIR/$APP_ID.desktop"
  rm -f "$ICON_DIR/32x32/apps/$APP_ID.png"
  rm -f "$ICON_DIR/128x128/apps/$APP_ID.png"
  rm -f "$ICON_DIR/256x256/apps/$APP_ID.png"
  refresh_caches
  echo "Removed Inkwell. Your documents and app data were left untouched."
}

case "${1:-install}" in
  install) install_app ;;
  uninstall) uninstall_app ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
