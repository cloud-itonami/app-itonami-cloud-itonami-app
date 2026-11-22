#!/usr/bin/env bash
# Verify a Tauri macOS .app bundle and its .dmg independently.
#
# The .app and the .dmg are signed separately (Tauri signs the .dmg file
# itself, and notarization stapling applies to the .app contents and to the
# .dmg file), so neither artifact's checks may substitute for the other's.
# Each artifact's signature status is always reported explicitly; an
# unsigned artifact never passes silently.
#
# Signature modes:
#   Default (CI / local): an unsigned or ad-hoc artifact is a WARNING, so
#     CI can verify structure on machines without a signing identity.
#     A signature that EXISTS but fails codesign --verify is always a
#     FAILURE (a broken signature is never OK).
#   --require-signature (or CLOUD_ITONAMI_REQUIRE_SIGNATURE=1): release
#     judgment mode. Unsigned or ad-hoc (non-Developer-ID) artifacts, a
#     failed spctl assessment, and a missing staple are FAILUREs.
#   --strict: implies --require-signature, and additionally requires a
#     universal (arm64 + x86_64) .app executable.
#
# Usage:
#   scripts/verify-macos-bundle.sh [--require-signature] [--strict]
#                                  [--app <path>] [--dmg <path>]
#
# Without --app/--dmg, the newest matching artifact under
# tauri/src-tauri/target/*/release/bundle/macos is used.
# Exit code: 0 when every required check passes, 1 otherwise.
set -euo pipefail

strict=0
require_signature="${CLOUD_ITONAMI_REQUIRE_SIGNATURE:-0}"
app_path=""
dmg_path=""

usage() {
  cat >&2 <<'EOF'
usage: verify-macos-bundle.sh [--require-signature] [--strict] [--app <path>] [--dmg <path>]

Modes (see header comment and docs/macos-distribution.md):
  default              CI mode: unsigned/ad-hoc artifacts warn, exit 0 if
                       structure is valid. A broken (but present) signature
                       still fails.
  --require-signature  Release mode: unsigned/ad-hoc, failed spctl, and
                       missing staple all fail. Also enabled by
                       CLOUD_ITONAMI_REQUIRE_SIGNATURE=1.
  --strict             --require-signature plus universal (arm64+x86_64).

.app and .dmg are judged separately; each artifact's signature status
(signed / ad-hoc / unsigned) is always printed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --require-signature)
      require_signature=1
      shift
      ;;
    --strict)
      strict=1
      require_signature=1
      shift
      ;;
    --app)
      app_path="${2:?--app needs a path}"
      shift 2
      ;;
    --dmg)
      dmg_path="${2:?--dmg needs a path}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

case "$require_signature" in
  1|true|yes) require_signature=1 ;;
  *) require_signature=0 ;;
esac

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
bundle_root="$repo_root/tauri/src-tauri/target"

find_latest() {
  # $1 = glob pattern relative to bundle_root; prints the newest match.
  local pattern="$1"
  local candidate=""
  # shellcheck disable=SC2206 -- word splitting is intentional for the glob.
  local matches=( $bundle_root/$pattern )
  if [[ ! -e "${matches[0]:-}" ]]; then
    return 0
  fi
  for candidate in "${matches[@]}"; do
    printf '%s\n' "$candidate"
  done | sort | tail -n 1
}

if [[ -z "$app_path" ]]; then
  app_path="$(find_latest '*/release/bundle/macos/*.app')"
fi
if [[ -z "$dmg_path" ]]; then
  dmg_path="$(find_latest '*/release/bundle/macos/*.dmg')"
fi

failures=0

note() {
  printf '== %s\n' "$*"
}

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  failures=$((failures + 1))
}

# Mode-dependent outcome for signature-related findings: failure in
# --require-signature / --strict mode, warning in default (CI) mode.
warn_or_fail_signature() {
  if [[ "$require_signature" -eq 1 ]]; then
    fail "$1"
  else
    printf 'WARN: %s\n' "$1" >&2
  fi
}

# Mode-dependent outcome for architecture findings: failure only in
# --strict mode (universal is required for release, not for CI).
warn_or_fail_arch() {
  if [[ "$strict" -eq 1 ]]; then
    fail "$1"
  else
    printf 'WARN: %s\n' "$1" >&2
  fi
}

# signature_status <path>: prints one of signed|adhoc|unsigned.
signature_status() {
  local target="$1"
  local dv
  dv="$(/usr/bin/codesign -dv --verbose=4 "$target" 2>&1 || true)"
  if [[ "$dv" == *"Signature=adhoc"* ]]; then
    printf 'adhoc'
  elif [[ "$dv" == *"Authority="* && "$dv" == *"Identifier="* ]]; then
    printf 'signed'
  else
    printf 'unsigned'
  fi
}

# check_signature <label> <path> <codesign --verify args...>: reports the
# artifact's signature status explicitly, then enforces it per mode.
# A present-but-broken signature fails in every mode; a missing or ad-hoc
# signature follows --require-signature.
check_signature() {
  local label="$1"
  local target="$2"
  shift 2

  local status
  status="$(signature_status "$target")"
  /usr/bin/codesign -dv --verbose=4 "$target" 2>&1 | \
    /usr/bin/sed -n '/^Identifier=/p;/^Authority=/p;/^TeamIdentifier=/p' || true
  printf 'INFO: signature (%s): %s\n' "$label" "$status"

  case "$status" in
    signed)
      if /usr/bin/codesign --verify "$@" "$target" 2>&1; then
        printf 'OK: codesign verify (%s)\n' "$label"
      else
        fail "codesign --verify ($label): signature present but invalid"
      fi
      ;;
    adhoc)
      warn_or_fail_signature "($label) ad-hoc signature only, not Developer ID: $target"
      ;;
    *)
      warn_or_fail_signature "($label) unsigned: $target (run the signing build, or keep CI/default mode)"
      ;;
  esac
}

# check_staple <label> <path>: a missing staple follows signature mode
# (release judgment needs the notarization ticket stapled).
check_staple() {
  local label="$1"
  local target="$2"
  if xcrun stapler validate "$target" >/dev/null 2>&1; then
    printf 'OK: stapled (%s): %s\n' "$label" "$target"
  else
    warn_or_fail_signature "not stapled ($label) (run: xcrun stapler staple \"$target\"): $target"
  fi
}

verify_app() {
  local app="$1"
  note "app: $app"
  if [[ ! -d "$app" ]]; then
    fail "app bundle not found: $app"
    return
  fi

  local plist="$app/Contents/Info.plist"
  local identifier version minimum executable
  identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null || true)"
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || true)"
  minimum="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist" 2>/dev/null || true)"
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist" 2>/dev/null || true)"

  if [[ "$identifier" == "cloud.itonami.app" ]]; then
    printf 'OK: CFBundleIdentifier=%s\n' "$identifier"
  else
    fail "CFBundleIdentifier: expected cloud.itonami.app, got '${identifier:-<missing>}'"
  fi
  if [[ "$version" == "0.4.2" ]]; then
    printf 'OK: CFBundleShortVersionString=%s\n' "$version"
  else
    fail "CFBundleShortVersionString: expected 0.4.2, got '${version:-<missing>}'"
  fi
  if [[ "$minimum" == "14.0" ]]; then
    printf 'OK: LSMinimumSystemVersion=%s\n' "$minimum"
  else
    fail "LSMinimumSystemVersion: expected 14.0, got '${minimum:-<missing>}'"
  fi

  local binary="$app/Contents/MacOS/$executable"
  if [[ -n "$executable" && -f "$binary" ]]; then
    local archs
    archs="$(lipo -archs "$binary" 2>/dev/null || true)"
    printf 'INFO: lipo -archs %s: %s\n' "$binary" "${archs:-<none>}"
    if [[ "$archs" == *"arm64"* && "$archs" == *"x86_64"* ]]; then
      printf 'OK: universal (arm64 + x86_64)\n'
    else
      warn_or_fail_arch "not universal (expected arm64 and x86_64, got: ${archs:-<none>})"
    fi
  else
    fail "main executable not found: Contents/MacOS/${executable:-<unknown>}"
  fi

  check_signature "app" "$app" --deep --strict --verbose=2

  # spctl policy applies to executable bundles; an unsigned artifact is
  # handled by the signature mode above, so its spctl result is reported
  # (never hidden) but only judged in --require-signature / --strict mode.
  if [[ "$(signature_status "$app")" == "signed" ]]; then
    if /usr/sbin/spctl --assess --type execute --verbose=2 "$app" 2>&1; then
      printf 'OK: spctl assess (app)\n'
    elif [[ "$require_signature" -eq 1 ]]; then
      fail "spctl --assess --type execute (app)"
    else
      printf 'WARN: spctl --assess --type execute (app)\n' >&2
    fi
  else
    printf 'INFO: spctl: skipped (app is not signed; see signature status above, never silent)\n'
  fi

  check_staple "app" "$app"
}

verify_dmg() {
  local dmg="$1"
  note "dmg: $dmg"
  if [[ ! -f "$dmg" ]]; then
    fail "dmg file not found: $dmg"
    return
  fi

  if /usr/bin/hdiutil verify "$dmg" >/dev/null 2>&1; then
    printf 'OK: hdiutil verify\n'
  else
    fail "hdiutil verify"
  fi

  # The .dmg is signed as its own file; the .app signature does not cover it.
  check_signature "dmg" "$dmg" --verbose=2

  check_staple "dmg" "$dmg"

  # Inspect the contents read-only, then detach. The mountpoint is a fresh
  # temp dir and is removed on exit even if a check fails.
  local mount_point
  mount_point="$(mktemp -d "${TMPDIR:-/tmp}/verify-macos-dmg.XXXXXX")"
  cleanup() {
    /usr/bin/hdiutil detach "$mount_point" >/dev/null 2>&1 || \
      /usr/bin/hdiutil detach -force "$mount_point" >/dev/null 2>&1 || true
    rm -rf "$mount_point"
  }
  trap cleanup EXIT
  if /usr/bin/hdiutil attach -readonly -nobrowse -mountpoint "$mount_point" "$dmg" >/dev/null 2>&1; then
    printf 'OK: hdiutil attach (read-only)\n'
    printf 'INFO: dmg contents:\n'
    ls -la "$mount_point" || true
    if [[ -d "$mount_point/Cloud Itonami.app" ]]; then
      printf 'OK: dmg contains Cloud Itonami.app\n'
    else
      fail "dmg does not contain Cloud Itonami.app at its root"
    fi
  else
    fail "hdiutil attach (read-only)"
  fi
  cleanup
  trap - EXIT
}

if [[ -n "$app_path" ]]; then
  verify_app "$app_path"
else
  fail "no --app path given and none found under $bundle_root/*/release/bundle/macos"
fi

if [[ -n "$dmg_path" ]]; then
  verify_dmg "$dmg_path"
else
  fail "no --dmg path given and none found under $bundle_root/*/release/bundle/macos"
fi

if [[ "$failures" -gt 0 ]]; then
  printf 'verify-macos-bundle: %s check(s) failed\n' "$failures" >&2
  exit 1
fi
mode="CI (default; unsigned artifacts warn)"
if [[ "$require_signature" -eq 1 ]]; then
  mode="require-signature"
fi
if [[ "$strict" -eq 1 ]]; then
  mode="strict (require-signature + universal)"
fi
printf 'verify-macos-bundle: all required checks passed [%s]\n' "$mode"
