# #1608 — Mute notifications checkbox in Edit channel

## Files read

- `src/renderer/src/screens/channels/EditChannelDialog.tsx` → `EditChannelDialogView`, `EditChannelDialog`, `promptWriteFor`, `PromptState` — the view gains the checkbox; the container seeds it and adds the write inside the `onSave` callback beside the prompt write. `promptWriteFor` is the pure send-or-not pattern to mirror.
- `src/renderer/src/store/pushNotifyBridge.ts` → `conversationMutedIn` — the existing server-scoped `is_muted === true` row lookup; reused for the opening value.
- `src/renderer/src/store/conversationListStore.ts` → `conversationListStore` — the list the lookup reads, via `getState()` at mount.
- `src/shared/ipc/commands.ts` → the `setConversationMuted` arm of `RendererCommand` (`payload: SetConversationMutedPayload`, required `attemptId`, 1–128 chars).
- `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx` → `crypto.randomUUID()` as the renderer's attempt-id source.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QuestionTick`; `conversation.css` → `.question-panel__input`, `.question-panel__control`, `.question-panel__control--checkbox`, `.question-panel__control-tick` — the shipped translation of the same Figma `Checkbox` (347:6211). Restated under `.edit-channel*`, not imported: this directory never imports from `screens/conversation/`, and the class namespaces must not collide.
- `src/renderer/src/screens/channels/channels.css` → the `.edit-channel*` block — where the new rules go.
- `src/renderer/src/screens/channels/ChannelList.tsx`, `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the two `<EditChannelDialog>` mount sites and their `onSave(writePrompt)` host re-checks. Neither changes.
- `e2e/conversation-mute-command.spec.ts` → spec-local fake answering `set_conversation_muted` with a correlated `conversation_updated`; the new spec sits beside it with the same shape.
- `e2e/channel-info-edit-channel.spec.ts`, `e2e/edit-channel-system-prompt.spec.ts` → how both mount sites are opened at the fake tier.

In-flight overlap check: no other `feature/*` branch touches these files.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=500-2120

The `Checkbox with label` instance (540:2158) is a row in the Content column between the `Text area large` system prompt and the `Actions` row holding Archive channel: a 20×20 control with a 2px `--color-tertiary` ring, 4px radius and the 12×12 tertiary tick when checked, then a 12px gap and the label "Mute notifications" in label-medium emphasized (12/16, 0.5px tracking, weight 600) in the on-surface colour, nudged 2px down. The Content column's own 12px gap spaces it from its neighbours.

## Context

Mute is stored on the host (#1594 adds `is_muted` to the list row; #1595 adds the `setConversationMuted` command). This ticket reads and writes the flag from Edit channel. What a muted channel suppresses is #1607, already merged. No ADR warranted.

## Design

**View (`EditChannelDialogView`)** gains two required props: `muted: boolean` and `onMutedChange: (next: boolean) => void`. Required, per the `onArchive` ruling: an optional prop would ship an inert control on whichever mount site was forgotten. It renders, between the notice lines and `.edit-channel__actions`:

- `<label className="edit-channel__mute">` wrapping a visually hidden `<input type="checkbox" className="edit-channel__mute-input" checked={muted} onChange=…>`, an `aria-hidden` `.edit-channel__mute-control` span holding an inline tick SVG when `muted`, and a `.edit-channel__mute-label` span with the client-owned constant `MUTE_NOTIFICATIONS_LABEL = 'Mute notifications'`. The native input keeps keyboard, focus and the accessible name (from the label text; no `aria-label`). The focus ring sits on the row via `:has(:focus-visible)`, the `.question-panel__option` precedent.
- The tick is a module-local restatement of `QuestionTick`'s path under the `edit-channel` class, not an import (see Files read).
- No disabled arm: like Archive channel, the host guard is taken at interaction time by the caller.

**Pure rule** (exported, beside `promptWriteFor`):

```ts
export type MuteState = { seed: boolean; draft: boolean }
export function muteWriteFor(state: MuteState): { muted: boolean } | null
```

Returns `null` (send nothing) when `draft === seed`, else `{ muted: draft }`. A cell rather than a bare boolean for the same reason as `PromptState`: the comparison needs what was read.

**Container (`EditChannelDialog`)** holds `useState<MuteState>` initialised lazily from `conversationMutedIn(conversationListStore.getState(), serverId, conversationId)` for both seed and draft. The container mounts only while the dialog is open, so a reopen re-reads the host value by construction; a list refresh while the dialog is open does not move the draft (the opening value is the seed). No new props, so neither mount site changes.

Inside the existing `onSave(() => { … })` callback, after the prompt write and in its own `try/catch`, compute `muteWriteFor(mute)`; when non-null send `{ type: 'setConversationMuted', payload: { conversation_id: conversationId, muted }, attemptId: crypto.randomUUID() }` through `window.pyry.sendCommand`. Because it only runs inside the caller's guarded body, it reaches only the channel's own host and never a disconnected one. Cancel, the close control and Archive never invoke that callback, so they send nothing (AC3). The container does not read `conversationMuteResult`; OK dismisses, and a reopen shows the host's value.

The prompt write and the mute write are independent `try` blocks so a local throw from one does not suppress the other.

## State + concurrency model

One more `useState` cell in the container, seeded synchronously at mount. No subscription, no timer, no promise — nothing to tear down. The write is fire-and-forget over the existing command bridge; main correlates it by `attemptId`.

## Error handling

`sendCommand` can throw locally; the catch is silent for the same reason the prompt write's is (an escaping exception would abort the caller's dismissal). A host refusal arrives as `conversationMuteResult { outcome: 'rejected' }`, which nothing here reads by design; the list stays at the host's value. Nothing logs: the conversation id is not loggable here, and the existing `sidebar-mutation` diagnostic already covers the refusal-to-send path in the caller.

## Testing strategy

Unit (`EditChannelDialog.test.tsx`, static render + element-tree walk):
- the view draws a checkbox named "Mute notifications", checked exactly when `muted` is true, unchecked otherwise;
- it sits after the text area and before the Archive channel button; wears only `.edit-channel*` classes; no `aria-label`; the tick is present only when checked;
- `onMutedChange` is bound to the input (element-tree walk, like `archiveButtonProps`) and rendering fires no callback;
- `muteWriteFor`: unchanged false/false and true/true send nothing; flipped either way sends the new value.

Fake tier (`e2e/edit-channel-mute.spec.ts`, spec-local fake holding a promoted channel with `is_muted: true`, answering `set_conversation_muted` by flipping its flag and replying with a correlated `conversation_updated`, and answering every `list_conversations` from the current flag):
- via the Channel info sheet's edit pill: the checkbox opens checked (second mount site);
- via the sidebar pen: opens checked; toggle + Cancel → no write; toggle + close control → no write; OK unchanged → no write; toggle + OK → exactly one `set_conversation_muted` `{ conversation_id, muted: false }` on the wire; reopen shows unchecked after the list refresh; toggle + Archive channel → an `archive_conversation` and still exactly one mute write.

Visual: capture the open dialog at the fake tier and compare against the Figma screenshot.

## Open questions

- Whether the ack `conversation_updated` alone updates the list row or only the follow-up re-list does. Either way the reopen assertion polls, so the spec does not depend on which.

## Documentation handoff

The ticket carries no Documentation handoff section. Pending for the documentation stage: the Edit channel dialog's entry in the owning sidebar/channels package overview should mention the Mute notifications checkbox and its OK-time write.

## Revisions

**2026-09-24, rework 1 (verifier triage: `conversation-create-rename.spec.ts` red).** No design change. The checkbox is a native input and takes a Tab stop between the name field and Archive channel, as the Design section places it. That spec's keyboard walk in the Edit channel dialog pinned the old order, input → Archive channel → Cancel → OK. It now reads input → Mute notifications → Archive channel → Cancel → OK. The walk only focuses the checkbox, so OK still sends no mute write there.
