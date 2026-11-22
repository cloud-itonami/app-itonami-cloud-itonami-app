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
  `10.13`, and the existing macOS release `packaging/macos/Info.plist`
  already declares `LSMinimumSystemVersion 14.0`. The two agree.
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

# 3. Universal .app + .dmg. Uses tauri.conf.json (bundle.active=true,
#    targets ["app","dmg"]) and signs when an identity is available:
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
scripts/verify-macos-bundle.sh            # auto-discovers the newest bundle
scripts/verify-macos-bundle.sh --strict   # missing staple / non-universal = failure
scripts/verify-macos-bundle.sh --app 'path/to/Cloud Itonami.app' --dmg 'path/to/Cloud-Itonami.dmg'
```

It validates `CFBundleIdentifier`, `CFBundleShortVersionString` and
`LSMinimumSystemVersion` from the bundle's `Info.plist`, runs
`lipo -archs` on the main executable (expects `arm64` + `x86_64` for a
universal build), `codesign --verify` on both the `.app` and the `.dmg`,
`spctl --assess --type execute` on the `.app`, `xcrun stapler validate` on
both, and `hdiutil verify` plus a read-only attach → list → detach of the
`.dmg` contents. A missing staple is a warning by default and a failure
under `--strict`.

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
