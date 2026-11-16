# Awai Bots and Apps — Otehon candidate

Tracking: [AWAI-538](https://linear.app/kotobalabs/issue/AWAI-538).
Design first: [editable six-screen flow](https://www.figma.com/design/EFljF3PXOrrVNM2v9Wdis1?node-id=20-3).
[Feature and verification ledger](https://docs.google.com/spreadsheets/d/1ToGgKnjwca069sctG3byfbMk7HtcjUNl_2xdm3xARTc/edit).

`src/itonami/workspace/core.cljc` owns the portable workspace catalog, owned Bot
creation planner and model operation planner. `view.cljc` maps the Figma flow to
semantic Hiccup. `browser.cljs` renders the static candidate with text nodes,
native form validation, keyboard focus and no external requests. This Otehon
path is separate from Native selfhost qualification and the existing resident
server. Existing resident endpoints are not moved or stopped.

Manimani is the main Bot. Additional Bots retain their user's owner identity;
a Bot can propose a child with at most its own capabilities. The planner never
creates DID, keys or approvals. The browser currently has no authenticated owner
adapter, so actual creation is refused without losing or sending the input.

The Apps catalog contains Dougaka, Gaka, Mangaka, Ongakuka, Animeka and Dandori.
Gaka/Mangaka share Qwen Image Turbo; Dougaka/Ongakuka/Animeka share MiniMax H3.
Dandori uses the local agent. A model operation request is distinct from a
verified host result. Download leaves an on-disk artifact; release removes only
its RAM residency. Active/unknown leases refuse release. Load admission needs a
measured available budget and runtime peak including temporary buffers/KV state.
No full 24GB model-fit claim is made.

## Validation

Run `bb -cp otehon/src:otehon/test -m itonami.workspace-test` from repository root.
Run `npm ci && npm run build` from `otehon` (shadow-cljs 3.5.13) and
serve `public/` as static files. The current candidate CSP denies network and
iframes until the canonical operation broker and verified adapters are linked.
Do not relax that CSP merely to make an arbitrary extension load.

## Remaining connections

- AWAI-180/258: authenticated user-side host, actual itonami-agent execution,
  bounded Bot creation tool, voice and computer tool adapters. Memory-only UI
  state is not durable Bot provisioning.
- AWAI-2933: owner/DID custody and recovery. Keep Hermes and Itonami stores separate.
- AWAI-2927: immutable source + complete Qwen encoder/denoiser/VAE/runtime pins,
  MiniMax H3 local backend, actual generation, 24GB admission measurements.
  H3 public base provides 768p audio-video. API-only context/2K stages are separate;
  Ongakuka audio-only output is unqualified.
- AWAI-155: standard MCP Apps JSON-RPC/postMessage iframe host. Verify origin,
  source window, resource policy, bounded routes and trusted operation-specific
  user approval via the canonical broker. No iframe or Bot may mint consent.
  ChatGPT-specific `window.openai` extensions are a separate compatibility matrix.
- AWAI-531/532/534: canonical bytes/CID, durable save/recovery, independent-node
  receipts/retention, conflicts and offline retries. The display consumes these
  facts and does not implement a second filesystem.

Sources checked 2026-11-16:
[OpenAI Plugins](https://developers.openai.com/plugins),
[MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui),
[Grok Bots](https://docs.x.ai/grok-bot/bots),
[MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/README.md),
[Qwen encoder source](https://huggingface.co/AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF).
