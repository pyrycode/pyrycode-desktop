# Spec: Channel Info sheet — Archive action (#366)

**Size:** S (comfortably; 1 production file, ~15 production LOC, no new types, no wire/IPC/CSS).
**Security-sensitive:** No. All security surface for this verb already shipped in #363 (the
`archiveConversation` command and its untrusted renderer→main boundary guard
`isArchiveConversationPayload`, `src/shared/ipc/commands.ts:294`). This ticket only dispatches the
already-guarded command from the renderer — the `#348`-render / `#368`-render precedent (renderer-only
dispatch of a main-guarded verb is not security-sensitive).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-94

Node 20:94 "Archive" is a full-width Material 3 **tonal pill** inside the sheet's Actions section
(20:85): secondary-container fill, on-secondary-container label, fully-rounded (`radius-full`), centred
`label-large` text, `px 16 / py 10`. This is **pixel-identical to the `.channel-info__action` style #368
already shipped for Rename** (`conversation.css:1635`, whose comment explicitly calls it "A generic base
#366/#367 reuse"). So Archive reuses that class verbatim — **no new CSS**. Desktop stacks the actions in
a column (the slot is `flex-direction: column`), dropping mobile's 2-column grid and out-of-scope "Change
workspace"; Archive renders as a second pill **below Rename** (see § Button order).

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:858-944` — `ChannelInfoSheetView`, the
  pure view. The Actions slot is lines 927-936; the `onRename?`-gated Rename button (932-934) is the
  exact shape to mirror for Archive. **Extract:** how a callback-gated `.channel-info__action` button
  renders inside `.channel-info__actions`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:951-1006` — the `ChannelInfoSheet`
  container. The `onRename` handler (984-991) opens a dialog; the `onArchive` handler you add is
  **simpler** — dispatch then close, no dialog. **Extract:** the `conversation === null ? undefined : …`
  callback-supply pattern and that `window.pyry` is dereferenced only inside the callback.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:162-166` — where the sheet is mounted:
  `onClose={() => setChannelInfoOpen(false)}`. The archive handler reuses this same `onClose` to close
  the sheet (AC2). **Extract:** confirm `onClose` closes the sheet; nothing new to wire.
- `src/renderer/src/screens/archive/ArchiveScreen.tsx:216-229` — `requestUnarchiveConversation`, the
  helper to clone. Archive is its mirror-image twin. **Extract:** the bare `sendCommand({ type, payload:
  { conversation_id } })` shape — no try/catch, no deps object, no constructor.
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx:85-108` — the sibling
  `requestRenameConversation` (#368). Confirms the same bare-dispatch, `RendererCommand`-typed,
  no-constructor idiom the ticket cites. **Extract:** nothing to write; corroborates the helper shape.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1120-1152` — the #368 Rename-button
  render tests. Clone for Archive. **Extract:** the render-assertion shape AND the test gotcha (see
  § Testing strategy — anchor on `>Archive</button>`, not the shared class).
- `src/renderer/src/screens/archive/ArchiveScreen.test.tsx:170-178` — the `requestUnarchiveConversation`
  direct dispatch test. Clone for `requestArchiveConversation`. **Extract:** the spy + `toHaveBeenCalledWith`
  assertion shape.
- `src/shared/ipc/commands.ts:98` — the `archiveConversation` command union member (payload =
  `ArchiveConversationPayload`). **Extract:** confirms the inline literal type-checks against
  `RendererCommand`; no import of `ArchiveConversationPayload` needed, only `RendererCommand`.
- `src/renderer/src/screens/conversation/conversation.css:1621-1650` — the `.channel-info__actions` slot
  and `.channel-info__action` tonal-pill style #368 shipped. **Extract:** reused verbatim; **do not edit
  this file.**

## Context

The Channel Info sheet shell (#365) left an empty `channel-info__actions` slot for its three sibling
actions. #368 (Rename) landed **first** and filled the slot's first row, creating the shared
`.channel-info__action` tonal-pill style and the `onRename?`-gated-button pattern. **This corrects the
stale assumption (in the ticket's Context and in project memory) that #366 is the first action to fill
the slot and establishes the style** — it is now the *second*, and it reuses #368's style unchanged.

The `archive_conversation` outbound transport (#363) already ships the dormant `archiveConversation`
command with its renderer→main guard. This ticket adds the Archive action row that dispatches it. Archive
is the mirror-image of the already-shipped unarchive path (#346/#348): both take a single
`conversation_id`, both are fire-and-forget, and the archived conversation leaving the active list is
**free** — the daemon replies to `archive_conversation` with `conversation_updated`, on which desktop
already re-requests the conversation list (#275). No reflection code is added (AC3).

## Design

One production file: `src/renderer/src/screens/conversation/ConversationScreen.tsx`. Four changes.

### 1. New exported dispatch helper (co-located, mirrors `requestUnarchiveConversation`)

Add near the `ChannelInfoSheet` container. A verbatim mirror of `requestUnarchiveConversation` (which
lives in-file with *its* caller in `ArchiveScreen.tsx`) — bare dispatch, no try/catch, no deps object:

```ts
export function requestArchiveConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string
): void
// body: sendCommand({ type: 'archiveConversation', payload: { conversation_id: conversationId } })
```

Requires a new type-only import: `import type { RendererCommand } from '@shared/ipc/commands'`
(`RendererCommand` is not yet imported in this file; the `@shared` alias resolves in the renderer). The
inline literal type-checks against the `archiveConversation` union member (`commands.ts:98`) — no
`ArchiveConversationPayload` import needed. Exported so it is unit-testable directly, since the sheet
renders server-side only (no jsdom; the click handler cannot be exercised by firing a DOM event).

### 2. `ChannelInfoSheetView` gains an `onArchive?` prop

Add `onArchive?: () => void` to the view's props type, alongside the existing `onRename?` (line ~870).

### 3. Archive button in the Actions slot

In the `.channel-info__actions` slot (lines 930-936), render a second `.channel-info__action` button
**after** the Rename button, gated on `onArchive` exactly as Rename is gated on `onRename`:

```tsx
{onArchive && (
  <button type="button" className="channel-info__action" onClick={onArchive}>
    Archive
  </button>
)}
```

### 4. Container supplies `onArchive` (guard + dispatch + close)

In the `ChannelInfoSheet` container (lines 976-1004), pass `onArchive` to the view — supplied **only for a
non-null conversation** (AC1 guard, mirroring `onRename`). Unlike `onRename` (which opens a dialog), the
archive handler dispatches and closes immediately:

```tsx
onArchive={
  conversation === null
    ? undefined
    : () => {
        requestArchiveConversation(window.pyry.sendCommand, conversation.id)
        onClose()
      }
}
```

`onClose` is the container's existing prop (`() => setChannelInfoOpen(false)`, threaded from line 166), so
calling it closes the sheet (AC2). `window.pyry` is dereferenced only inside this callback (AC4).

### Button order

`Rename → Archive → [Delete #367]`. Destructive-last convention: Rename (edit) first, Archive
(soft-remove) second, the future Delete (permanent, #367) will layer an error-tinted variant last. Since
both `onRename` and `onArchive` are supplied under the same `conversation !== null` condition, they render
or absent together; per-button callback-gating is kept (not collapsed to one guard) to match #368's
pattern and keep each action independently omittable/testable.

## State + concurrency model

None added. No store slice, no async task, no subscription, no effect. The helper is a synchronous
fire-and-forget dispatch (`sendCommand` returns `void`, the composer-send / unarchive posture). The
sheet's transient state (rename dialog open/name) is unchanged; Archive needs no local state. The
archived conversation leaving the active list is driven entirely by the existing #275 event path
(daemon `conversation_updated` → list re-request), off this ticket's surface.

## Error handling

Fire-and-forget, matching `requestUnarchiveConversation` and the ticket's stated posture — the helper
does **not** wrap the dispatch in try/catch (unlike `sendInterrupt.ts`, whose deps/try-catch shape is for
a different concern). A bridge failure surfaces through the existing IPC error path, not here. No new
failure modes: the payload is a single opaque routing id, the main-side guard (#363) rejects a malformed
payload at the boundary, and no user-controlled parsing happens in the renderer.

## Testing strategy

Server-render assertions + one direct helper test (the sheet renders server-side only; `npm test`,
vitest). Clone the #368 tests and the `requestUnarchiveConversation` test.

**Test gotcha (load-bearing):** Rename and Archive now share `class="channel-info__action"`. Assertions
must anchor on the **label** `>Archive</button>` to identify the Archive button uniquely — do *not* use
`class="channel-info__action"` as the Archive discriminator (it matches either button). The existing #368
tests stay green: their positive test supplies only `onRename` (so only Rename renders), and their
null-guard test asserts the class is absent when `conversation === null` (neither button renders).

Scenarios:
- **Archive present (AC1):** render `ChannelInfoSheetView` with a conversation and `onArchive={noop}` →
  markup contains `>Archive</button>`.
- **No Archive when conversation is null (AC1 guard):** render with `conversation={null}` → markup does
  not contain `>Archive</button>`; the Actions header still renders.
- **No Archive when `onArchive` omitted, conversation present (callback-gated, AC1):** render with a
  conversation but no `onArchive` → no `>Archive</button>` (proves the view honours the container's
  guard rather than deriving the button from `conversation`).
- **Helper dispatch (AC2):** `requestArchiveConversation(spy, 'conv-x')` calls `spy` exactly once with
  `{ type: 'archiveConversation', payload: { conversation_id: 'conv-x' } }`.

AC3 (archived conversation leaves the active list) is inherited from #275 and needs no test at this layer.
AC4 (server-renderability) is covered by the render tests above, which never touch `window.pyry`.

## Open questions

None. The pattern is fully established by the just-landed sibling #368 and the mirror-image #346/#348.
