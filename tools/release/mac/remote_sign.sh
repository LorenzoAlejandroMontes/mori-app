#!/usr/bin/env bash
# Developer ID signing with the private key OFF the runner (rcodesign remote signing).
#
# The runner holds no secret. `rcodesign sign` opens a session on the relay and prints a session
# join string, encrypted to the public key of devid-cert.pem (next to this file): only the holder
# of the matching private key can join it. The owner joins from their own machine
# (tools/release/sign-owner.sh), which answers one signature request per Mach-O file; the files
# never leave the runner and the key never leaves the owner's machine. Notarization is submitted
# from that machine too; the runner only waits for Apple's ticket and staples it.
#
#   remote_sign.sh tool            download rcodesign (pinned version + sha256)
#   remote_sign.sh rehearse        sign a COPY of the app with a throwaway certificate made on the
#                                  spot, with the same settings as the real one, and check the result
#   remote_sign.sh start app|dmg   start signing in the background, write the join string to
#                                  $WORK/sjs-<what>.txt (the workflow uploads it)
#   remote_sign.sh wait app|dmg    wait for that signing to end, print its log, fail if it failed
#   remote_sign.sh staple <path>   wait for the notarization ticket and staple it
#   remote_sign.sh dmg             build the .dmg from the signed, stapled app (the app is not touched)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$ROOT/tools/release/mac"
BUNDLE="$ROOT/app/src-tauri/target/release/bundle"
WORK="${REMOTE_SIGN_WORK:-$ROOT/app/src-tauri/target/remote-sign}"
RC="$WORK/rcodesign"
CERT="$HERE/devid-cert.pem"
ENT="$ROOT/app/src-tauri/Entitlements.plist"
APP="$BUNDLE/macos/Mori.app"
BUNDLE_ID="com.mori.app"
RCODESIGN_VERSION="0.29.0"
RCODESIGN_SHA256="d1a532150adaf90048260d76359261aa716abafc45c53c5dc18845029184334a"
JOIN_WAIT="${REMOTE_JOIN_WAIT:-60}"          # seconds for the relay to hand out the join string
SIGN_WAIT="${REMOTE_SIGN_WAIT:-2400}"        # seconds for the owner to join and sign everything
STAPLE_WAIT="${REMOTE_STAPLE_WAIT:-2700}"    # seconds for Apple's ticket to exist
mkdir -p "$WORK"

# Every Mach-O in Contents/MacOS gets the hardened runtime. The entitlement (audio input) goes on
# the two that open an audio device: the app, which macOS holds responsible for the recorder it
# starts, and the helper that reads the system audio tap. uv gets none.
APP_ARGS=(
    --for-notarization
    --code-signature-flags runtime
    --entitlements-xml-file "$ENT"
    --entitlements-xml-file "Contents/MacOS/mori-sysaudio:$ENT"
)
BINARIES=(mori mori-sysaudio uv)
ENTITLED=(mori mori-sysaudio)

target() {
    case "$1" in
        app) echo "$APP" ;;
        dmg) ls "$BUNDLE"/dmg/*.dmg | head -1 ;;
        *) echo "usage: remote_sign.sh start|wait app|dmg" >&2; exit 2 ;;
    esac
}

# What a signed Mori.app has to be, whoever signed it. $2 = how the Authority line must start;
# empty for the throwaway certificate, which codesign cannot trust either.
check_app() {
    local A="$1" AUTH="${2:-}" b out
    echo "## deep verification"
    if [ -n "$AUTH" ]; then
        codesign --verify --deep --strict --verbose=2 "$A"
    else
        codesign --verify --deep --strict --verbose=2 "$A" || echo "(codesign does not trust the throwaway certificate: expected)"
    fi
    for b in "${BINARIES[@]}"; do
        echo "## Contents/MacOS/$b"
        out="$(codesign -dv --verbose=2 "$A/Contents/MacOS/$b" 2>&1)"
        grep -E '^(Identifier|Format|CodeDirectory|Authority|TeamIdentifier|Timestamp|Signature|Runtime)' <<<"$out" || true
        grep -qE '^CodeDirectory.*flags=.*runtime' <<<"$out" || { echo "FAILED: $b is not signed with the hardened runtime"; return 1; }
        if grep -q '^Signature=adhoc' <<<"$out"; then echo "FAILED: $b is still signed ad hoc"; return 1; fi
        if [ -n "$AUTH" ]; then
            grep -q "^Authority=$AUTH" <<<"$out" || { echo "FAILED: $b is not signed by $AUTH"; return 1; }
        fi
    done
    for b in "${ENTITLED[@]}"; do
        echo "## entitlements of Contents/MacOS/$b"
        out="$(codesign -d --entitlements - "$A/Contents/MacOS/$b" 2>&1)"
        echo "$out"
        grep -q "com.apple.security.device.audio-input" <<<"$out" || { echo "FAILED: $b has no audio input entitlement"; return 1; }
    done
    echo "## entitlements of Contents/MacOS/uv (none expected)"
    codesign -d --entitlements - "$A/Contents/MacOS/uv" 2>&1 || true
}

case "${1:-}" in
tool)
    NAME="apple-codesign-$RCODESIGN_VERSION-aarch64-apple-darwin"
    curl -fsSL -o "$WORK/$NAME.tar.gz" \
        "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F$RCODESIGN_VERSION/$NAME.tar.gz"
    echo "$RCODESIGN_SHA256  $WORK/$NAME.tar.gz" | shasum -a 256 -c -
    tar -xzf "$WORK/$NAME.tar.gz" -C "$WORK"
    cp "$WORK/$NAME/rcodesign" "$RC"
    "$RC" --version
    ;;
rehearse)
    [ -d "$APP" ] || { echo "nothing to sign: $APP"; exit 1; }
    D="$WORK/rehearsal"; rm -rf "$D"; mkdir -p "$D"
    ditto "$APP" "$D/Mori.app"
    # A certificate nobody trusts, made here and thrown away with the runner. It only shows what
    # rcodesign writes with these settings: Gatekeeper would refuse it.
    "$RC" generate-self-signed-certificate --person-name "Mori signing rehearsal" \
        --profile developer-id-application --pem-unified-filename "$D/throwaway.pem" > /dev/null \
        || { "$RC" generate-self-signed-certificate --help; exit 1; }
    "$RC" sign --pem-file "$D/throwaway.pem" "${APP_ARGS[@]}" "$D/Mori.app"
    check_app "$D/Mori.app" ""
    rm -f "$D/throwaway.pem"
    echo "rehearsal passed: these settings sign every binary in Mori.app"
    ;;
start)
    WHAT="$2"; T="$(target "$WHAT")"
    [ -e "$T" ] || { echo "nothing to sign: $T"; exit 1; }
    LOG="$WORK/sign-$WHAT.log"; RCF="$WORK/sign-$WHAT.rc"; SJS="$WORK/sjs-$WHAT.txt"
    rm -f "$LOG" "$RCF" "$SJS"
    ARGS=(sign --remote-public-key-pem-file "$CERT")
    if [ "$WHAT" = app ]; then
        ARGS+=("${APP_ARGS[@]}")
    else
        ARGS+=(--binary-identifier "$BUNDLE_ID.dmg")
    fi
    # its own session, so it outlives this step; the exit code lands in a file for `wait`
    export LOG RCF
    nohup bash -c '"$0" "$@" > "$LOG" 2>&1; echo $? > "$RCF"' "$RC" "${ARGS[@]}" "$T" </dev/null >/dev/null 2>&1 &
    for _ in $(seq 1 "$JOIN_WAIT"); do
        sed -nE 's/^ *rcodesign remote-sign ([A-Za-z0-9+\/=_-]+) *$/\1/p' "$LOG" 2>/dev/null | head -1 > "$SJS" || true
        [ -s "$SJS" ] && break
        [ -f "$RCF" ] && break
        sleep 1
    done
    if [ ! -s "$SJS" ]; then echo "no session join string:"; cat "$LOG" 2>/dev/null || true; exit 1; fi
    echo "signing $T: session open, join string in $SJS ($(wc -c < "$SJS" | tr -d ' ') bytes)"
    ;;
wait)
    WHAT="$2"; T="$(target "$WHAT")"
    LOG="$WORK/sign-$WHAT.log"; RCF="$WORK/sign-$WHAT.rc"
    t0=$(date +%s)
    while [ ! -f "$RCF" ]; do
        if [ $(( $(date +%s) - t0 )) -ge "$SIGN_WAIT" ]; then
            echo "signing did not end in $SIGN_WAIT s (did the owner join the session?)"
            pkill -f "$RC sign" || true
            grep -vE '^[A-Za-z0-9+/=_-]{60,}$|rcodesign remote-sign ' "$LOG" | tail -40 || true
            exit 1
        fi
        sleep 5
    done
    # the join string lines are long and say nothing: keep them out of the log
    grep -vE '^[A-Za-z0-9+/=_-]{60,}$|rcodesign remote-sign ' "$LOG" | tail -400 || true
    rc="$(cat "$RCF")"
    echo "rcodesign exit code: $rc after $(( $(date +%s) - t0 )) s of waiting"
    [ "$rc" = 0 ] || exit 1
    if [ "$WHAT" = app ]; then
        check_app "$T" "Developer ID Application"
    else
        codesign --verify --verbose=2 "$T"
        out="$(codesign -dv --verbose=2 "$T" 2>&1)"
        grep -E '^(Identifier|Format|Authority|TeamIdentifier|Timestamp|Signature)' <<<"$out" || true
        grep -q "^Authority=Developer ID Application" <<<"$out" || { echo "FAILED: the .dmg is not signed by a Developer ID"; exit 1; }
    fi
    ;;
staple)
    T="$2"
    t0=$(date +%s)
    until xcrun stapler staple "$T" > "$WORK/staple.log" 2>&1; do
        if [ $(( $(date +%s) - t0 )) -ge "$STAPLE_WAIT" ]; then
            echo "no notarization ticket for $T after $STAPLE_WAIT s"; cat "$WORK/staple.log"; exit 1
        fi
        sleep 20
    done
    cat "$WORK/staple.log"
    xcrun stapler validate "$T"
    echo "stapled after $(( $(date +%s) - t0 )) s"
    ;;
dmg)
    # Same name as the one Tauri built, so everything after this step finds it. A plain image:
    # the app and a link to /Applications.
    OUT="$(target dmg)"
    STAGE="$WORK/dmg-stage"; rm -rf "$STAGE"; mkdir -p "$STAGE"
    ditto "$APP" "$STAGE/Mori.app"
    ln -s /Applications "$STAGE/Applications"
    rm -f "$OUT"
    hdiutil create -volname "Mori" -srcfolder "$STAGE" -ov -fs HFS+ -format UDZO "$OUT"
    ls -l "$OUT"
    ;;
*)
    echo "usage: remote_sign.sh tool | rehearse | start app|dmg | wait app|dmg | staple <path> | dmg"; exit 2 ;;
esac
