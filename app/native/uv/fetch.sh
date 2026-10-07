#!/usr/bin/env bash
# Fetch the uv binary a packaged Mori carries (docs/MACOS.md, M5): on first
# launch it makes Mori's Python environment, so nobody installs Python by hand
# (src-tauri/src/pyenv.rs). uv is Apache-2.0 or MIT (THIRD_PARTY.md).
#   bash native/uv/fetch.sh     -> native/uv/build/uv-<target triple>[.exe]
# The name is the one Tauri wants for a bundled binary. The download is the
# release archive from github.com/astral-sh/uv, checked against the SHA-256
# published next to it.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${UV_VERSION:-0.12.23}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TRIPLE=aarch64-apple-darwin; EXT=tar.gz; EXE="" ;;
  Darwin-x86_64) TRIPLE=x86_64-apple-darwin; EXT=tar.gz; EXE="" ;;
  MINGW*|MSYS*|CYGWIN*) TRIPLE=x86_64-pc-windows-msvc; EXT=zip; EXE=.exe ;;
  *) echo "no bundled uv for $(uname -s)-$(uname -m)"; exit 1 ;;
esac
BASE="https://github.com/astral-sh/uv/releases/download/$VERSION"
FILE="uv-$TRIPLE.$EXT"
mkdir -p build
cd build
curl -fsSL --retry 3 -o "$FILE" "$BASE/$FILE"
curl -fsSL --retry 3 -o "$FILE.sha256" "$BASE/$FILE.sha256"
WANT=$(cut -d' ' -f1 "$FILE.sha256")
if command -v sha256sum > /dev/null; then GOT=$(sha256sum "$FILE" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$FILE" | cut -d' ' -f1); fi
[ "$WANT" = "$GOT" ] || { echo "uv $VERSION: checksum mismatch ($GOT, expected $WANT)"; exit 1; }
if [ "$EXT" = zip ]; then
  unzip -oq "$FILE" uv.exe
  mv -f uv.exe "uv-$TRIPLE.exe"
else
  tar -xzf "$FILE" --strip-components=1 "uv-$TRIPLE/uv"
  mv -f uv "uv-$TRIPLE"
fi
rm -f "$FILE" "$FILE.sha256"
echo "fetched $(pwd)/uv-$TRIPLE$EXE (uv $VERSION, sha256 of the archive $GOT)"
