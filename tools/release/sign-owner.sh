#!/usr/bin/env bash
# The owner's half of a signed release. Run it on the machine that holds the Developer ID key,
# next to a Release run started with `sign: true` (or by a v* tag). See docs/RELEASING.md.
#
# The run builds Mori.app and waits. This script follows it and, as each small artifact appears:
#
#   sjs-app        joins the signing session of the app   (rcodesign remote-sign)
#   notarize-app   sends the signed app to Apple          (rcodesign notary-submit)
#   sjs-dmg        joins the signing session of the .dmg
#   notarize-dmg   sends the signed .dmg to Apple
#
# The private key and the App Store Connect key stay on this machine; the runner never sees them.
# Nothing secret is printed: not the join strings, not the keys, not the GitHub token.
#
#   MORI_SIGNING_DIR=<folder with the keys> tools/release/sign-owner.sh <run id>
#
# In that folder, unless the variable next to each says otherwise:
#   devid.key       MORI_DEVID_KEY     the Developer ID private key (PEM)
#   devid.pem       MORI_DEVID_CERT    its certificate (PEM)
#   asc-key.json    MORI_ASC_KEY       the App Store Connect API key, as rcodesign writes it
#   rcodesign       MORI_RCODESIGN     the rcodesign program (falls back to the one on PATH)
#
# Works under Git Bash on Windows, and on macOS and Linux. Needs curl, unzip and python.
set -euo pipefail

RUN="${1:?usage: MORI_SIGNING_DIR=<folder> tools/release/sign-owner.sh <run id>}"
DIR="${MORI_SIGNING_DIR:?set MORI_SIGNING_DIR to the folder that holds the signing keys}"
REPO="${MORI_REPO:-LorenzoAlejandroMontes/mori-app}"
API="https://api.github.com/repos/$REPO"
KEY="${MORI_DEVID_KEY:-$DIR/devid.key}"
CERT="${MORI_DEVID_CERT:-$DIR/devid.pem}"
ASC="${MORI_ASC_KEY:-$DIR/asc-key.json}"
POLL="${MORI_POLL_SECONDS:-10}"

say() { echo "[$(date +%T)] $*"; }
die() { echo "STOPPED: $*" >&2; exit 1; }

PYTHON=""
for c in python3 python py; do
    if "$c" -c "import json" > /dev/null 2>&1; then PYTHON="$c"; break; fi
done
[ -n "$PYTHON" ] || die "python is needed to read GitHub's answers"
command -v curl > /dev/null || die "curl is needed"
command -v unzip > /dev/null || die "unzip is needed"

rcodesign_path() {
    if [ -n "${MORI_RCODESIGN:-}" ]; then echo "$MORI_RCODESIGN"; return; fi
    local c
    for c in "$DIR/rcodesign.exe" "$DIR/rcodesign"; do [ -f "$c" ] && { echo "$c"; return; }; done
    command -v rcodesign 2>/dev/null || true
}
# a path the way a Windows program wants it; unchanged elsewhere
native() { if command -v cygpath > /dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }

# The GitHub token: from the environment, or from git's own credential store. Never printed, and
# handed to curl on its standard input so it is not in any command line.
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
    TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
fi
[ -n "$TOKEN" ] || die "no GitHub token: set GH_TOKEN, or sign in to github.com with git"
api() { printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -fsSL -H @- -H "Accept: application/vnd.github+json" "$@"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "run $RUN of $REPO"
for f in "$KEY" "$CERT" "$ASC"; do [ -f "$f" ] || say "note: $f is not there yet (needed later)"; done
[ -n "$(rcodesign_path)" ] || say "note: rcodesign is not in $DIR and not on PATH (needed later)"

# Wait for an artifact of this run and print its id. Stops if the run ends without it.
wait_artifact() {
    local name="$1" id status
    say "waiting for $name" >&2
    while :; do
        id="$(api "$API/actions/runs/$RUN/artifacts?per_page=100" | "$PYTHON" -c '
import json, sys
ids = [a["id"] for a in json.load(sys.stdin)["artifacts"] if a["name"] == sys.argv[1] and not a["expired"]]
print(max(ids) if ids else "")' "$name")" || id=""
        [ -n "$id" ] && { echo "$id"; return 0; }
        status="$(api "$API/actions/runs/$RUN" | "$PYTHON" -c '
import json, sys
r = json.load(sys.stdin); print(r["status"], r.get("conclusion") or "")')" || status=""
        case "$status" in completed*) die "the run ended ($status) before $name appeared" ;; esac
        sleep "$POLL"
    done
}

# Download an artifact, unzip it into its own folder, print the path of the one file inside.
fetch() {
    local name="$1" id="$2" d="$TMP/$1"
    rm -rf "$d"; mkdir -p "$d"
    api -o "$TMP/$name.zip" "$API/actions/artifacts/$id/zip"
    unzip -q -o "$TMP/$name.zip" -d "$d"
    rm -f "$TMP/$name.zip"
    find "$d" -type f | head -1
}

sign() {
    local name="$1" id f sjs rc
    id="$(wait_artifact "$name")"
    f="$(fetch "$name" "$id")"
    [ -s "$f" ] || die "$name is empty"
    sjs="$(tr -d '\r\n ' < "$f")"
    say "$name downloaded (artifact $id, join string of ${#sjs} characters)"
    [ -f "$KEY" ] || die "the private key is not at $KEY: nothing was signed. Set MORI_SIGNING_DIR (or MORI_DEVID_KEY) and run this again while the run is still waiting."
    [ -f "$CERT" ] || die "the certificate is not at $CERT: nothing was signed."
    rc="$(rcodesign_path)"
    [ -n "$rc" ] || die "rcodesign is not in $DIR and not on PATH: nothing was signed."
    say "joining the signing session"
    # the join string is the only secret-like thing rcodesign could echo: lines with it are dropped
    local code=0
    set +e
    MSYS_NO_PATHCONV=1 "$rc" remote-sign --pem-file "$(native "$KEY")" --pem-file "$(native "$CERT")" "$sjs" 2>&1 \
        | grep -vF -- "$sjs"
    code="${PIPESTATUS[0]}"
    set -e
    [ "$code" = 0 ] || die "rcodesign remote-sign failed for $name (exit code $code)"
    say "$name: signed"
}

notarize() {
    local name="$1" id f rc
    id="$(wait_artifact "$name")"
    f="$(fetch "$name" "$id")"
    [ -s "$f" ] || die "$name is empty"
    say "$name downloaded (artifact $id, $(basename "$f"), $(wc -c < "$f" | tr -d ' ') bytes)"
    [ -f "$ASC" ] || die "the App Store Connect key is not at $ASC: nothing was sent to Apple."
    rc="$(rcodesign_path)"
    [ -n "$rc" ] || die "rcodesign is not in $DIR and not on PATH: nothing was sent to Apple."
    say "sending it to Apple and waiting for the answer"
    if MSYS_NO_PATHCONV=1 "$rc" notary-submit --api-key-file "$(native "$ASC")" --wait "$(native "$f")" 2>&1; then
        say "$name: accepted by Apple"
    else
        # Apple may simply still be working: the runner keeps asking for the ticket by itself and
        # fails on its own if it never comes.
        say "$name: rcodesign did not report an accepted notarization (see above). Going on: the run decides."
    fi
    rm -rf "$TMP/$name"
}

# With only the run id, the four steps in order. With step names after it, only those: for
# example `sign-owner.sh <run id> notarize-dmg` after a network drop in the last step.
if [ "$#" -gt 1 ]; then
    shift
    for step in "$@"; do
        case "$step" in
            sjs-app|sjs-dmg) sign "$step" ;;
            notarize-app|notarize-dmg) notarize "$step" ;;
            *) die "unknown step: $step (sjs-app, notarize-app, sjs-dmg, notarize-dmg)" ;;
        esac
    done
else
    sign sjs-app
    notarize notarize-app
    sign sjs-dmg
    notarize notarize-dmg
fi
say "done here. The run now staples the .dmg and proves the app: https://github.com/$REPO/actions/runs/$RUN"
