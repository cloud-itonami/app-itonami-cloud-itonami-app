# tauri — Cloud Itonami as a Tauri v3 app (AWAI-3015)

A Tauri **3.0.0-alpha.6** host (explicit `tauri-runtime-wry` v3) that carries the existing `mobile/` web bundle. Owner decision 2026-11-17 overrides the statement in `app.mobile.kotoba.edn` that the Tauri app is superseded by kotoba-shell; the kotoba-shell path (`app.mobile.kotoba.edn`, `mobile/`) is unchanged and still builds independently. This directory adds a second host, it does not remove the first.

## What is added

| Path | Role |
| --- | --- |
| `src/descriptor.mjs` | Builds the `kotoba.app.client-runtime.v1` descriptor from `mobile/data/command-tables.json`: fleet search/facets on the edge Worker, ingress reads (all pinned GET routes) and the three offered conversation writes on `https://agent.itonami.cloud`. All `each-operation` |
| `src/host.js` | Runs before the bundle's `js/main.js`. Builds the shared consent broker and replaces `window.fetch`: cross-origin requests must match a declared route and be approved in the trusted dialog; anything else is refused. No raw-network fallback |
| `scripts/build.mjs` | Copies a built `mobile/dist`, adds the pinned broker, host, descriptor, derives the CSP (connect-src from declared origins, inline styles by SHA-256 hash) and writes `release.json` digests |
| `vendor/` | Pinned `kotoba-client-runtime.js` / consent CSS and `PINS.json` (kotoba-lang/kotoba, copied from awai-os `nixos/otehon/shell/vendor`). The build fails on digest drift. No product-local broker |
| `src-tauri/` | Tauri shell, identifier `cloud.itonami.app`, one read-only command, no HTTP/fs/shell plugin permission |

## Commands

```sh
cd mobile && npm ci && npm run build   # needs the pinned Amu, engine and DDS checkouts (mobile/README.md)
cd ../tauri && npm ci
npm test                               # 5 tests; no mobile build needed
npm run build                          # tauri/dist from mobile/dist
npm run build:desktop                  # native executable, no bundle/signing
```

## Behavior changes versus the kotoba-shell host

- Every request that leaves the app now shows the consent dialog (service, endpoint, method/path, data categories) and needs a click. The shell host sent them directly.
- **Custom ingress origins are not supported.** The pairing screen accepts any HTTPS origin, but the static CSP and descriptor allow only `https://agent.itonami.cloud`; other origins are refused.
- **Query strings on ingress commands are refused** (the pinned table has no query parameters to declare). Fleet search keeps `limit`, `text`, `role`.
- Fleet requests go to the bundle's default edge Worker URL. Set `MOBILE_API_BASE` for both the mobile build and `npm run build` if it differs.

## Status and limits (2026-11-17)

Verified: `npm test` 5/5; fixture build with a stub `mobile/dist`; loopback browser check that an undeclared URL/method is refused, a declared request opens the consent dialog with the right fields, and Deny sends nothing; no CSP violations; `cargo check`.

Not verified: a real `mobile/dist` build (the pinned `jp-go-digital-design-system` revision `fb279e1` is not reachable from GitHub here, so `dds.css` could not be reproduced; the host build stops with an explicit message until `mobile` is built), a launched native window, `tauri build`, iOS/Android targets, signing and store publication, and whether the real bundle's `redirect:"error"`/`credentials` fetch options behave under the broker (it ignores them and forces `credentials: omit`, `redirect: error`).
