#!/usr/bin/env bash
# First launch of the release .dmg the way a person gets it: a quarantined download, the app
# copied to /Applications, opened, and Gatekeeper's question answered with "Open".
#
#   first-launch.sh <dmg> <results folder> open      signed and notarized: Gatekeeper has to accept
#                                                    the app and its window has to be on screen
#   first-launch.sh <dmg> <results folder> blocked   ad hoc dry run: Gatekeeper refuses it. This
#                                                    records what a person would see, and checks
#                                                    that the window check tells the two apart:
#                                                    no window while refused, a window once the
#                                                    quarantine is taken off the same copy
#
# The verdict looks for a window, never for the process: macOS starts the process and holds it
# while "Not Opened" is on screen.
#
# Screenshots: gatekeeper_1_after_open.png, gatekeeper_2_after_click.png, gatekeeper_3_app.png,
# and in a dry run gatekeeper_4_without_quarantine.png.
set -uo pipefail

DMG="$1"; R="$2"; MODE="${3:-open}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$R"
INSTALLED=/Applications/Mori.app
MNT="$(mktemp -d)/mori-dmg"

# one command with a deadline, its exit code printed
t() { local s="$1"; shift; echo "== [$(date +%T)] $*"; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; local rc=$?; echo "== rc=$rc"; return $rc; }

sw_vers
pkill -x mori 2>/dev/null; sleep 1

echo "## the driver that clicks (Quartz, accessibility)"
DRV="$(mktemp -d)/drv"
python3 -m venv "$DRV" && "$DRV/bin/python" -m pip install -q pyobjc-framework-Quartz pyobjc-framework-ApplicationServices \
    || echo "== the driver could not be installed: the question will not be clicked"

echo "## a quarantined download"
Q="0083;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)"
mkdir -p "$HOME/Downloads"; DL="$HOME/Downloads/$(basename "$DMG")"
cp "$DMG" "$DL"; xattr -w com.apple.quarantine "$Q" "$DL"
shasum -a 256 "$DL"
sudo rm -rf "$INSTALLED"
MOUNTED=0
t 120 hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DL" && MOUNTED=1 || echo "== the quarantined dmg did NOT mount"
ls -la "$MNT"
t 120 ditto "$MNT/Mori.app" "$INSTALLED"
t 30 hdiutil detach "$MNT"
xattr -r -w com.apple.quarantine "$Q" "$INSTALLED"
echo "== quarantine: $(xattr -p com.apple.quarantine "$INSTALLED")"

echo "## what Gatekeeper says before anyone opens it"
t 60 spctl -a -vv "$INSTALLED"; SPCTL=$?
t 120 syspolicy_check distribution "$INSTALLED" || true
echo "$SPCTL" > "$R/gatekeeper_spctl.exit"

echo "## open"
# in the background: `open` may not return until the question is answered
( perl -e 'alarm shift; exec @ARGV' 180 open "$INSTALLED" > "$R/gatekeeper_open.txt" 2>&1; echo "rc=$?" >> "$R/gatekeeper_open.txt" ) &
sleep 12
screencapture -x "$R/gatekeeper_1_after_open.png"
echo "== process before the click"; pgrep -lx mori || echo "Mori is not running yet"
CLICK=skipped
if [ "$MODE" = open ] && [ -x "$DRV/bin/python" ]; then
    t 90 "$DRV/bin/python" "$HERE/gatekeeper_click.py"; CLICK=$?
fi
echo "$CLICK" > "$R/gatekeeper_click.exit"
sleep 5
screencapture -x "$R/gatekeeper_2_after_click.png"
sleep 25
screencapture -x "$R/gatekeeper_3_app.png"
echo "== open said: $(cat "$R/gatekeeper_open.txt" 2>/dev/null)"
echo "== process"; ps -axo pid,command | grep -i "[M]ori.app/Contents/MacOS" || echo "Mori is NOT running"
pgrep -x mori > /dev/null; RUNNING=$?
echo "$RUNNING" > "$R/gatekeeper_running.exit"
WINDOW=unknown
if [ -x "$DRV/bin/python" ]; then t 60 "$DRV/bin/python" "$HERE/gatekeeper_click.py" --state; WINDOW=$?; fi
echo "$WINDOW" > "$R/gatekeeper_window.exit"
pkill -x mori 2>/dev/null

SELFTEST=skipped
if [ "$MODE" != open ]; then
    echo "## the same copy without the quarantine: the window check has to see it open"
    sleep 2
    xattr -dr com.apple.quarantine "$INSTALLED"
    ( perl -e 'alarm shift; exec @ARGV' 60 open "$INSTALLED" > /dev/null 2>&1 ) &
    sleep 15
    screencapture -x "$R/gatekeeper_4_without_quarantine.png"
    SELFTEST=unknown
    if [ -x "$DRV/bin/python" ]; then t 60 "$DRV/bin/python" "$HERE/gatekeeper_click.py" --state; SELFTEST=$?; fi
    echo "$SELFTEST" > "$R/gatekeeper_selftest.exit"
    pkill -x mori 2>/dev/null
fi

echo "## verdict"
echo "mounted: $MOUNTED   spctl (0 = accepted): $SPCTL   click (0 = answered, 2 = no question, skipped): $CLICK   process (0 = there, proves nothing): $RUNNING   window (0 = Mori open, 1 = no window, 3 = window and a question): $WINDOW"
if [ "$MODE" = open ]; then
    [ "$MOUNTED" = 1 ] || { echo "FAILED: the quarantined .dmg did not mount"; exit 1; }
    [ "$SPCTL" = 0 ] || { echo "FAILED: Gatekeeper does not accept the app"; exit 1; }
    [ "$WINDOW" = 0 ] || { echo "FAILED: no window of Mori on screen after the first launch (or a question still open)"; exit 1; }
    echo "PROVED: the quarantined download opens"
else
    echo "window check without the quarantine (0 or 3 = it sees Mori): $SELFTEST"
    [ "$WINDOW" = 1 ] || { echo "FAILED: the window check saw Mori open while Gatekeeper was refusing it"; exit 1; }
    case "$SELFTEST" in 0|3) ;; *) echo "FAILED: the window check does not see Mori when it is open"; exit 1 ;; esac
    echo "dry run: the ad hoc app is refused as expected, and the window check tells refused from open"
fi
