#!/usr/bin/env bash
# Build the macOS system-audio helper. Needs only the Xcode command line tools.
#   bash native/mori-sysaudio/build.sh        -> native/mori-sysaudio/build/mori-sysaudio
# ARCH=x86_64 builds for an Intel Mac.
# It also leaves a copy named the way Tauri wants a bundled binary
# (mori-sysaudio-aarch64-apple-darwin): src-tauri/tauri.macos-app.conf.json puts it in Mori.app.
set -euo pipefail
cd "$(dirname "$0")"
ARCH="${ARCH:-$(uname -m)}"
mkdir -p build
xcrun swiftc -O -swift-version 5 -target "${ARCH}-apple-macos14.2" main.swift -o build/mori-sysaudio
codesign --force --sign - build/mori-sysaudio
cp build/mori-sysaudio "build/mori-sysaudio-${ARCH/arm64/aarch64}-apple-darwin"
echo "built $(pwd)/build/mori-sysaudio ($ARCH)"
