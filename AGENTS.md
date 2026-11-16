# Itonami app: Awai Otehon UI continuity

Follow the workspace architecture, Linear and delivery rules.

Owner decision 2026-11-16 / AWAI-538: use Figma design first for UI changes.
The baseline is https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=216-476
(editable shell master `216:475`, page `215:2`). The shared workflow is
https://github.com/network-awai/awai-os/blob/codex/awai-2965-6600h-desktop/docs/otehon/design-first.md
and is introduced by awai-os PR #143.

Preserve Awai's existing Core / Apps / System navigation, Manimani conversation
and activity panel, account/node docks and network status. Design affected
states in Figma before coding, then implement and compare rendered evidence.
Integrate Bot creation, model management and Gaka in the existing composition.
The separate `/workspace/` candidate and Figma file `EFljF3PXOrrVNM2v9Wdis1` are
unaccepted work; do not deploy them as a replacement desktop. Retain their WIP.

Figma controls composition; tests/source describe actual behavior. Record gaps
instead of silently rewriting the baseline. Major composition changes require
an explicit owner design decision. Ordinary additions inside the baseline can
proceed under the authorized task. Preserve identity and existing local state;
do not use the owner's keys in design fixtures or bypass operation consent.
Keep source/CI, preview, physical acceptance and persistent restart evidence
separate. Include baseline/proposal Figma URLs and before/after screen evidence
in UI PRs. No automated visual CI gate is currently claimed.
