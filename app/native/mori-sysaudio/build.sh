#!/usr/bin/env bash
# Build the macOS system-audio helper. Needs only the Xcode command line tools.
#   bash native/mori-sysaudio/build.sh        -> native/mori-sysaudio/build/mori-sysaudio
# ARCH=x86_64 builds for an Intel Mac.
set -euo pipefail
cd "$(dirname "$0")"
ARCH="${ARCH:-$(uname -m)}"
mkdir -p build
xcrun swiftc -O -swift-version 5 -target "${ARCH}-apple-macos14.2" main.swift -o build/mori-sysaudio
codesign --force --sign - build/mori-sysaudio
echo "built $(pwd)/build/mori-sysaudio ($ARCH)"
