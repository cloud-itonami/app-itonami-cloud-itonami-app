# macOS distribution (Tauri `.app` + `.dmg`)

Local-only distribution procedure for the Tauri host (`tauri/`, identifier
`cloud.itonami.app`, version `0.4.2`). This is the distribution path for the
second host described in [`tauri/README.md`](../tauri/README.md); the
kotoba-shell path (`scripts/build-macos-release`, `packaging/macos/`) is a
separate host and is not changed by this document.

**Policy:** signing keys, certificates and notary credentials are never
committed to this repository and are never passed to CI. Every step below
runs on a local Mac. CI builds (`.github/workflows/`) must not receive any
of the material in [Required material](#required-material).

## Signing and notarization one-pager

Local Mac only. No signing key, certificate, `.p12`/`.cer`, private identity
name or notary credential is committed or passed to CI. The detailed
prerequisites are in [Required material](#required-material); the build
commands are in [Build steps](#build-steps-local-mac-after-the-prerequisites-above);
the release check is in [Verify a built `.app` and `.dmg`](#verify-a-built-app-and-dmg).
This section is the GO-day checklist and the only signing/notarization
procedure to follow. Signing, notarization and `rustup target add` have not
been executed for this change (document-only).

### GO checklist: 3 conditions

All three must be checked by the named owner steps below before the GO-day
order can run. The commands are the self-checks; do not rely on memory.

- [ ] **① Certificate in keychain (owner task).** The owner installs the
  **Developer ID Application** certificate and its private key into the
  keychain of the Mac that builds the bundle. Self-check:
  `security find-identity -v -p codesigning` must list a Developer ID
  Application identity with a valid count ≥ 1. Installing/identifying a
  certificate uses no disk capacity, so this can be done before condition ③
  is met.
- [ ] **② `rustup target add x86_64-apple-darwin` approved (owner task).**
  Owner approval is required because this downloads a toolchain component
  (~1 GB). Approval itself is a decision and uses no disk; execution
  (step ② of the GO-day order) happens only after condition ③ is met and
  the free space is rechecked. Self-check: before GO,
  `~/.cargo/bin/rustup target list --installed` must *not* list
  `x86_64-apple-darwin`; after the GO-day execution it must list it.
  Do not run it unattended.
- [ ] **③ Free space recovered.** Self-check: `df -h /System/Volumes/Data`.
  Confirm comfortably more than ~1 GB is free before running
  `rustup target add` (several GiB free is the practical target, so the
  ~1 GB download plus the universal build have room). Current state at the
  time of writing: **NOT met** — the volume is 100% full with only roughly
  1 GiB free. Do not run `rustup target add` until this is recovered.

Conditions ① and ② (decision/registration only) may be completed before
condition ③, because they use no capacity. The `rustup target add` execution
itself must wait for ③.

### GO-day order

1. **Confirm the certificate.** `security find-identity -v -p codesigning`
   shows the Developer ID Application identity (checklist condition ①).
2. **Add the Rust target after approval.** Recheck free space with
   `df -h /System/Volumes/Data` (~1 GB premise, checklist conditions ②③),
   then run `~/.cargo/bin/rustup target add x86_64-apple-darwin` and confirm
   it with `~/.cargo/bin/rustup target list --installed`.
3. **Universal build.** Build `arm64 + x86_64` with `npx tauri build
   --target universal-apple-darwin --bundles app,dmg` and
   `APPLE_SIGNING_IDENTITY` set on the signing Mac (see
   [Build steps](#build-steps-local-mac-after-the-prerequisites-above)).
4. **Sign → notarize → staple → verify.** Tauri signs the `.app` and the
   `.dmg` separately when an identity is present. Finish with the manual
   notarization/stapling and the release check below.

### Manual signing (what Tauri does internally)

When re-signing or signing by hand, sign each artifact explicitly with
runtime options and a secure timestamp:

```sh
codesign --force --options runtime --timestamp \
  --sign 'Developer ID Application: ...' 'Cloud Itonami.app'
codesign --force --options runtime --timestamp \
  --sign 'Developer ID Application: ...' 'Cloud-Itonami-0.4.2.dmg'
```

Do not use `--deep` when signing. `--deep` signs nested code
indiscriminately and hides which code was actually signed, so the signer
cannot see the signing target; sign each artifact explicitly instead.
Verification with `codesign --verify --deep` is read-only and is fine — the
verify script uses `--deep` to *check*, never to sign. `--entitlements` is
omitted (empty; see below) so the hardened-runtime defaults apply.

### Notarize, staple, and verify

Always submit with `--wait` so notarization finishes before stapling:

```sh
xcrun notarytool submit --keychain-profile '<profile>' --wait <app.zip>
xcrun stapler staple 'Cloud Itonami.app'
xcrun stapler validate 'Cloud Itonami.app'
xcrun stapler validate 'Cloud-Itonami-0.4.2.dmg'
spctl -a -vv 'Cloud Itonami.app'
```

Expected results (release judgment):

- `notarytool submit --wait`: completes with `status: Accepted`.
- `stapler validate`: prints `Processing: <path>` and then
  `Validation successful.`
- `spctl -a -vv` (`spctl --assess --type execute --verbose=4`): exits 0 with
  `Cloud Itonami.app: accepted` and a `source=Notarized Developer ID` line.

The release decision is `scripts/verify-macos-bundle.sh --require-signature`:
it judges the `.app` and the `.dmg` independently, so one artifact passing
never masks the other failing. Use `--strict` to additionally require a
universal `arm64 + x86_64` binary. See the full mode table in
[Verify a built `.app` and `.dmg`](#verify-a-built-app-and-dmg).

### Why entitlements stay empty

Entitlements are shipped empty on purpose: the hardened-runtime defaults
are sufficient, the WKWebView runs in a separate process, and this host has
no Tauri/wasm/JIT code that needs an executable-memory or JIT entitlement.
After signing, launch the app and confirm normal operation; if a future
capability proves insufficient, add only the smallest missing entitlement.
The committed `tauri.conf.json` omission is detailed in
[What `tauri/src-tauri/tauri.conf.json` carries (and what it does not)](#what-taurisrc-tauritauriconfjson-carries-and-what-it-does-not).

## Current state of this host (2026-11-23)

Signing and notarization **cannot run on this host yet**. The four missing
pieces are independent of each other:

| # | State | How it was checked |
| --- | ----- | ------------------ |
| 1 | No code-signing identity: 0 valid identities | `security find-identity -v -p codesigning` |
| 2 | `x86_64-apple-darwin` Rust target not installed (only `aarch64-apple-darwin` plus Android targets) | `~/.cargo/bin/rustup target list --installed` |
| 3 | No `notarytool` keychain profile exists | `xcrun notarytool history` / `security find-generic-password` (nothing created) |
| 4 | Xcode application not installed (Command Line Tools only) | `xcode-select -p` → `/Library/Developer/CommandLineTools` |

`xcrun notarytool 1.1.2` itself works. The owner holds the certificates, but
they are not in this Mac's keychain, so no signing step has been executed
from here and none is claimed.

## Required material

To sign and notarize, all of the following are needed (none of it in git,
none of it in CI):

- A **Developer ID Application** code-signing certificate, installed in the
  keychain of the Mac that builds the bundle. Its identity name is what the
  Tauri config / environment variable below refers to. Never commit the
  identity name of a private key, a `.p12`, or a `.cer` to the repository.
- A notarization credential, in either form:
  - a `notarytool` keychain profile (created once with
    `xcrun notarytool store-credentials --id <Apple ID> --team <TEAM_ID>
    <profile>`, which prompts for an app-specific password), or
  - an **App Store Connect API key** (`APPLE_API_KEY` / `APPLE_API_ISSUER`
    and the key file path, i.e. the `API_KEY` / `ISSUER` / `KEY_PATH` form
    used by `xcrun notarytool submit --key --key-id --issuer`).
- An **owner-approved** `rustup target add x86_64-apple-darwin`. This
  downloads a toolchain component, so it is an explicit approval step: do
  not run it as part of an unattended setup, and it has not been run for
  this work.

## What `tauri/src-tauri/tauri.conf.json` carries (and what it does not)

The committed config enables bundling:

```json
"bundle": {
  "active": true,
  "targets": ["app", "dmg"],
  "icon": [ "..." ],
  "macOS": {
    "minimumSystemVersion": "14.0",
    "hardenedRuntime": true
  }
}
```

- `minimumSystemVersion: "14.0"` is explicit because Tauri's default is
  `10.13`. Rationale: this host uses no macOS-14-only API (WKWebView APIs
  available since ≤ 10.13; Tauri's 14.0+ WebView features such as
  background-throttling and data-store-identifier are optional and unused),
  so 14.0 is kept as the distribution floor inherited from the existing
  release `packaging/macos/Info.plist` (`LSMinimumSystemVersion 14.0`, since
  `dcf4e0ca`) — parity with the kotoba-shell host, not a hard API dependency.
- `identifier` (`cloud.itonami.app`) and `version` (`0.4.2`) in
  `tauri.conf.json` agree with `tauri/src-tauri/Cargo.toml` and
  `tauri/package.json`. `packaging/macos/Info.plist` is the kotoba-shell
  host (it reports `0.5.7`); it is a different host and is not touched.
- `signingIdentity` is **deliberately omitted** from the committed JSON.
  Tauri does not expand `${...}` placeholders in its config, so a committed
  placeholder would be passed to `codesign` as a literal (invalid)
  identity. At build time on the signing Mac, supply the identity either
  by setting `bundle.macOS.signingIdentity` in a local, uncommitted edit,
  or through the `APPLE_SIGNING_IDENTITY` environment variable. When an
  identity is present, Tauri signs the `.app` and the `.dmg` and runs
  notarization automatically.
- `entitlements` is **deliberately omitted**: no custom entitlements file
  is added. Tauri generates the hardened-runtime entitlements itself, and
  this host needs nothing beyond that — it exposes one read-only command
  (`awai_host_info`) with no filesystem, HTTP or shell plugin permission,
  no deep-link handler, and no JIT. Adding a custom plist (for example
  with JIT, sandbox or network exceptions) would compete with the
  generated one and widen the attack surface for no functional reason. If
  a future capability needs an entitlement, add the smallest possible
  file and reference it from `bundle.macOS.entitlements`.

## Build steps (local Mac, after the prerequisites above)

```sh
# 1. Owner approval required — do not run unattended:
~/.cargo/bin/rustup target add x86_64-apple-darwin

# 2. Web bundle first. tauri/scripts/build.mjs requires index.html,
#    js/main.js and dds.css to already exist in mobile/dist.
cd mobile && npm ci
AMU_ROOT=/path/to/pinned/amu \
KBB_ENGINE_ROOT=/path/to/pinned/amu-engine \
JP_GO_DDS=/path/to/pinned/jp-go-digital-design-system \
  npm run build
cd ../tauri && npm ci && npm run build   # writes tauri/dist

# 3a. Today: aarch64 single-arch .app + .dmg (this host's ceiling):
APPLE_SIGNING_IDENTITY='Developer ID Application: ...' \
  npx tauri build --bundles app,dmg

# 3b. Universal (arm64 + x86_64) — BLOCKED until step 1 is owner-approved
#     and run. It has NOT been built and must not be described as done:
APPLE_SIGNING_IDENTITY='Developer ID Application: ...' \
  npx tauri build --target universal-apple-darwin --bundles app,dmg
```

Tauri signs the `.app` and the `.dmg` as separate artifacts. Notarization
and stapling apply to the `.app` (Tauri notarizes it automatically when an
identity is present). To notarize manually instead:

```sh
xcrun notarytool submit --keychain-profile '<profile>' --wait <app.zip>
xcrun stapler staple 'Cloud Itonami.app'
```

## Verify a built `.app` and `.dmg`

`scripts/verify-macos-bundle.sh` checks both artifacts independently
(the `.dmg` signature and staple do not follow from the `.app`'s):

```sh
scripts/verify-macos-bundle.sh               # auto-discovers the newest bundle (CI mode)
scripts/verify-macos-bundle.sh --require-signature  # release mode: unsigned/ad-hoc/staple-missing = failure
scripts/verify-macos-bundle.sh --strict      # require-signature + universal (arm64+x86_64) required
scripts/verify-macos-bundle.sh --app 'path/to/Cloud Itonami.app' --dmg 'path/to/Cloud-Itonami.dmg'
scripts/verify-macos-bundle.sh --help        # full flag and mode reference
```

It validates `CFBundleIdentifier`, `CFBundleShortVersionString` and
`LSMinimumSystemVersion` from the bundle's `Info.plist`, runs
`lipo -archs` on the main executable, `codesign --verify` on both the
`.app` and the `.dmg`, `spctl --assess --type execute` on the `.app`,
`xcrun stapler validate` on both, and `hdiutil verify` plus a read-only
attach → list → detach of the `.dmg` contents.

Signature judgment is per artifact and never silent: each of `.app` and
`.dmg` gets its own `INFO: signature (...): signed|adhoc|unsigned` line,
so one artifact passing cannot mask the other failing.

| Mode | Flag / env | Unsigned or ad-hoc | Broken (present) signature | Missing staple | Non-universal |
| --- | --- | --- | --- | --- | --- |
| CI (default) | *(none)* | WARN, exit 0 | FAIL | WARN | WARN |
| Release | `--require-signature` or `CLOUD_ITONAMI_REQUIRE_SIGNATURE=1` | FAIL | FAIL | FAIL | WARN |
| Release + universal | `--strict` | FAIL | FAIL | FAIL | FAIL |

Use the default in CI (no signing identity on runners) and
`--require-signature` (or `--strict` for universal release builds) for the
release decision. A present-but-broken signature fails in every mode.

The same checks can be run by hand:

```sh
codesign --verify --deep --strict --verbose=2 'Cloud Itonami.app'
spctl --assess --type execute --verbose=2 'Cloud Itonami.app'
xcrun stapler validate 'Cloud Itonami.app'
lipo -archs 'Cloud Itonami.app/Contents/MacOS/<executable>'
codesign --verify --verbose=2 'Cloud-Itonami-0.4.2.dmg'
xcrun stapler validate 'Cloud-Itonami-0.4.2.dmg'
hdiutil verify 'Cloud-Itonami-0.4.2.dmg'
```

Safe `.dmg` inspection (read-only mount, always detached):

```sh
MOUNT="$(mktemp -d)"
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" 'Cloud-Itonami-0.4.2.dmg'
ls -la "$MOUNT"
hdiutil detach "$MOUNT"; rmdir "$MOUNT"
```

## What can and cannot be built today

- **Universal (arm64 + x86_64) cannot be built on this host today** and has
  not been built: the `x86_64-apple-darwin` target is not installed, adding
  it needs owner approval (see [Required material](#required-material)),
  and it has not been run. The configuration already allows universal
  builds (`--target universal-apple-darwin`), but no universal artifact
  exists and none is claimed anywhere.
- **The current ceiling is an aarch64 single-arch `.app` / `.dmg`**
  (`npx tauri build --bundles app,dmg`), which the verify script checks
  with warnings for non-universal archs in CI mode. Even that requires a
  complete `mobile/dist` (see blockers below), which this host cannot
  produce yet, so the only verification actually executed so far is the
  script's own behavior on synthetic artifacts: default mode exits 0 with
  explicit unsigned warnings, `--require-signature` exits 1, per artifact.

## Known blockers for a full build (rechecked on `origin/main` @ `8e0681b7`)

A universal `tauri build` was **not** executed for this change, because the
frontend bundle it packages cannot be produced on this host yet:

- `mobile/dist/` currently contains only `index.html` (no `js/main.js`,
  no `dds.css`), while `tauri/scripts/build.mjs` refuses to run unless all
  three exist. So `npm run build` in `tauri/` fails with an explicit
  message today.
- `resources/jp_go_dds/dds.css` does not exist in the repository. It is
  produced by `mobile/scripts/copy-assets.mjs`, which requires the
  `JP_GO_DDS` checkout pinned by `mobile/dds.lock`
  (`kotoba-lang/jp-go-digital-design-system`, revision
  `fb279e1c18fe86abe2ca6d815b2c3f5d0c51c347`, sha256
  `86ed3735...`). The pinned Amu and engine checkouts
  (`AMU_ROOT`, `KBB_ENGINE_ROOT`) are likewise external. See
  `mobile/README.md`.
- Items 2 and 4 from [Current state](#current-state-of-this-host-2026-11-23)
  above: no `x86_64-apple-darwin` target and no signing identity on this
  host, so even a complete `mobile/dist` would only produce an unsigned,
  single-arch build here.

These blockers affect producing a shippable artifact; they do not affect
the committed configuration, which is valid JSON and matches the Tauri
3.0.0-alpha.6 config schema used by this repository.
