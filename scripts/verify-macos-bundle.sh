#!/usr/bin/env bash
# Verify a Tauri macOS .app bundle and its .dmg independently.
#
# The .app and the .dmg are signed separately (Tauri signs the .dmg file
# itself, and notarization stapling applies to the .app contents and to the
# .dmg file), so neither artifact's checks may substitute for the other's.
#
# Usage:
#   scripts/verify-macos-bundle.sh [--strict] [--app <path>] [--dmg <path>]
#
# Without --app/--dmg, the newest matching artifact under
# tauri/src-tauri/target/*/release/bundle/macos is used.
# Without --strict, a missing staple and a non-universal build are warnings.
# With --strict, both are failures.
#
# Exit code: 0 when every required check passes, 1 otherwise.
set -euo pipefail

strict=0
app_path=""
dmg_path=""

usage() {
  echo "usage: $0 [--strict] [--app <path>] [--dmg <path>]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      strict=1
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

warn_or_fail() {
  if [[ "$strict" -eq 1 ]]; then
    fail "$1"
  else
    printf 'WARN: %s\n' "$1" >&2
  fi
}

check_staple() {
  # $1 = path. A missing staple is a warning unless --strict.
  local target="$1"
  if xcrun stapler validate "$target" >/dev/null 2>&1; then
    printf 'OK: stapled: %s\n' "$target"
  else
    warn_or_fail "not stapled (run: xcrun stapler staple \"$target\"): $target"
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
      warn_or_fail "not universal (expected arm64 and x86_64, got: ${archs:-<none>})"
    fi
  else
    fail "main executable not found: Contents/MacOS/${executable:-<unknown>}"
  fi

  if /usr/bin/codesign --verify --deep --strict --verbose=2 "$app" 2>&1; then
    printf 'OK: codesign verify (app)\n'
  else
    fail "codesign --verify --deep --strict (app)"
  fi
  /usr/bin/codesign -dv --verbose=4 "$app" 2>&1 | /usr/bin/sed -n '/^Identifier=/p;/^Authority=/p;/^TeamIdentifier=/p' || true

  if /usr/sbin/spctl --assess --type execute --verbose=2 "$app" 2>&1; then
    printf 'OK: spctl assess (app)\n'
  else
    fail "spctl --assess --type execute (app)"
  fi

  check_staple "$app"
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
  if /usr/bin/codesign --verify --verbose=2 "$dmg" 2>&1; then
    printf 'OK: codesign verify (dmg)\n'
  else
    fail "codesign --verify (dmg)"
  fi
  /usr/bin/codesign -dv --verbose=4 "$dmg" 2>&1 | /usr/bin/sed -n '/^Identifier=/p;/^Authority=/p;/^TeamIdentifier=/p' || true

  check_staple "$dmg"

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
printf 'verify-macos-bundle: all required checks passed%s\n' "$(if [[ "$strict" -eq 1 ]]; then printf ' (strict)'; fi)"
