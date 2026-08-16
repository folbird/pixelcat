#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="com.pixcat.app"

cd "$ROOT_DIR/src-tauri"
cargo build --no-default-features
codesign --force --sign - --identifier "$APP_ID" target/debug/pixcat
exec target/debug/pixcat