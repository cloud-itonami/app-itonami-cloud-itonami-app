# Awai portable Bot and model policies

Tracking: [AWAI-538](https://linear.app/kotobalabs/issue/AWAI-538).
The [original desktop Figma baseline](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=216-476)
controls UI composition. Follow `AGENTS.md` before adding a user interface.

`src/itonami/workspace/core.cljc` owns the portable Apps catalog, owned Bot
creation planner and model-operation planner. It performs no I/O, authentication,
key creation, inference, provisioning, consent or persistence. The caller must
supply verified host observations; a request never proves completion.

Manimani is the main Bot. Additional Bots keep the user's owner identity. A
child Bot can receive at most its creator's capabilities. Missing ownership,
missing parents and capability expansion are refused. Model download and RAM
residency are separate states; a release is refused while leases are active or
unknown. Model admission needs a measured available budget and runtime peak.
The pure policy does not prove that a model fits 24GB.

The catalog names Dougaka, Gaka, Mangaka, Ongakuka, Animeka and Dandori. These
entries describe intended integrations, not functioning generators. Awai FS
status labels distinguish local durability from verified remote retention.

## Validation

Run `bb -cp otehon/src:otehon/test -m itonami.workspace-test` from the repository
root. `.github/workflows/otehon-workspace.yml` pins the Otehon reference runtime
and runs this independently of Native selfhost gates.

## Remaining implementation

The standalone `/workspace/` screen was rejected for changing the existing
Awai composition, and is excluded from this change. Its source and the real
adapter work remain preserved in the original task worktree. This PR does not
ship a replacement desktop or qualify actual Bot creation, model download/load,
Gaka generation, Awai FS save/sync, or an MCP Apps iframe host.

Continue through AWAI-180/258 (agent execution), AWAI-2933 (identity/custody),
AWAI-2927 (media/model qualification), AWAI-538 (standard MCP Apps integration) and
AWAI-531/532/534 (storage). Follow the Figma baseline, then design affected states,
implement within the existing shell, compare screens and verify on 6600H.
