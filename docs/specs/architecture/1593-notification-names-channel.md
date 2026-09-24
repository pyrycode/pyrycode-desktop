# #1593 — a desktop notification names the channel it came from

## Files read

- `src/renderer/src/store/pushNotifyBridge.ts` → `notifyKindForEvent`, `subscribePushNotify`, `usePushNotify` — the filter, the dedup + toggle gates, and the production wiring that gains the name lookup.
- `src/shared/ipc/commands.ts` → `NotifyKind`, `NotifyPayload`, `isNotifyPayload` — the renderer→main boundary the name crosses.
- `src/main/fireNotification.ts` → `NOTIFICATION_COPY`, `fireNotification` — the copy table (keeps the body) and the constructor call (takes the title).
- `src/main/index.ts` → the `notify` case of the command switch — the sole composition site; its comment already anticipates host-attributed copy.
- `src/shared/ipc/events.ts` → `StampedDaemonEvent`, `ServerOrigin` — `preload`'s `onDaemonEvent` delivers the stamped form; `serverId: string | null` is client-bound, not wire-sourced.
- `src/renderer/src/store/conversationListStore.ts` → `ConversationListState.byServer`, `selectConversationsFor` — per-server rows keyed by the same origin the event carries; `name: string | null`.
- `docs/knowledge/features/push-notifications.md` § "The guard is the security-relevant line", § "Edge cases and limitations" — the closed-set guard's rationale that this ticket narrows.

## Design source

N/A — the notification is drawn by the operating system; there is no in-app surface (ticket § Figma).

## Context

Every notification reads "Pyrycode" plus fixed body copy, so with several channels running the operator cannot tell which one finished or is waiting. Both notify-worthy arms (`turnEnd`, `modalShown`) carry a `conversationId`, the stamped event carries its `serverId`, and the conversation list holds each row's `name` per server. The title becomes the conversation's name; the body stays the client-owned copy.

The invariant "no free text can reach a notification" narrows to "no free text reaches the **body**". The documentation phase may want to record that narrowing in the push-notifications overview (see Documentation handoff); it does not warrant a new ADR.

## Design

### Renderer — `pushNotifyBridge.ts`

- `subscribePushNotify(onDaemonEvent, sendCommand, isPushEnabled, nameFor)`:
  - `onDaemonEvent`'s listener type widens from `DaemonEvent` to `StampedDaemonEvent` (what `window.pyry.onDaemonEvent` already delivers), so the listener can read `event.serverId`.
  - New required injected `nameFor: (serverId: string | null, conversationId: string) => string | null`, read per event like `isPushEnabled`. Required, not defaulted, so an unwired caller is a type error rather than silently unnamed notifications.
  - After the dedup and toggle gates (order unchanged), resolve `nameFor(event.serverId, event.conversationId)` — both owned arms carry `conversationId: string`. Send `{ kind }` when the result is `null`, otherwise `{ kind, name }`. The key is omitted, never `name: undefined` (structured-clone present-key precedent in preload).
  - The conversation id is read only as a lookup key and never leaves the listener.
- New exported pure `conversationNameIn(state: ConversationListState, serverId: string | null, conversationId: string): string | null` — `state.byServer.get(serverId)`, find the row by `id`, return its `name`, `null` when the slot or row is missing. Keyed by the event's own server, so a same-id row from another host never names it.
- `usePushNotify` passes `(serverId, id) => conversationNameIn(conversationListStore.getState(), serverId, id)`.

### Boundary — `commands.ts`

- `NotifyPayload` gains `name?: string` — the conversation name, untrusted host text, title only.
- `isNotifyPayload`: the closed-set `kind` check is unchanged; additionally `name` must be absent, `undefined`, or a `string`. Any other type fails the command closed.
- Docblocks on `NotifyKind`, `NotifyPayload`, `isNotifyPayload` narrow the invariant to "no free text reaches the body", and state that the name is cleaned main-side and never logged.

### Main — `fireNotification.ts` + `index.ts`

- `NOTIFICATION_COPY` becomes `Record<NotifyKind, string>` — the body only. A `DEFAULT_TITLE = 'Pyrycode'` constant owns the fallback.
- New exported pure `notificationTitle(name: string | undefined): string` — drop every control character (`\p{Cc}`: C0, DEL, C1), keep at most 80 characters (code points, so a surrogate pair is never split), trim surrounding whitespace, and return `DEFAULT_TITLE` when nothing is left or no name was given. Bounded iteration: it stops after 80 kept characters instead of materialising the whole string.
- `fireNotification(kind, deps, name?)` — the optional name is appended after `deps`, so existing call sites stay valid; constructs `{ title: notificationTitle(name), body: NOTIFICATION_COPY[kind] }`. Focus gate and click wiring unchanged.
- `index.ts` `notify` case passes `command.payload.name`; its comment is updated (host-attributed title now shipped, still no conversation id, name never logged). No log line is added.

## State + concurrency model

No new state and no new async work. The lookup reads a store snapshot synchronously per event; the dedup `Set` and the per-event toggle read are untouched, so the #514 properties hold unchanged.

## Error handling

No new failure mode reaches the user: a missing slot or row, or `name === null`, yields the default title. A malformed `name` from a hostile renderer fails the whole `notify` command closed at `isRendererCommand` (existing drop path). `notificationTitle` never throws.

## Testing strategy

Vitest, all node-environment, fakes only:

- `pushNotifyBridge.test.ts`:
  - `fakeBridge.emit` stamps a `serverId` onto the fixture events; existing calls pass a `nameFor` that returns `null`, so every existing assertion is unchanged (the XYZ no-leak checks still prove the conversation id stays out).
  - A named conversation sends `{ kind, name }` for `turnEnd` and for `modalShown`; `nameFor` receives the event's `serverId` and `conversationId`.
  - `nameFor` returning `null` sends `{ kind }` with no `name` key.
  - `nameFor` is not consulted when the toggle is off or the prompt is deduped.
  - `conversationNameIn`: named row → name; `name: null` → null; unknown id → null; unknown server → null; a same-id row under another server does not name it.
- `commands.test.ts`: accepts a string `name`; accepts an absent name (existing); rejects number, null, object and array `name`.
- `fireNotification.test.ts`: `notificationTitle` — undefined → "Pyrycode"; plain name kept; control characters (`\n`, `\t`, `\u0000`, `\u007f`, `\u009b`) dropped; 81+ characters cut to 80; a surrogate pair at the cut boundary not split; empty, whitespace-only and control-only names → "Pyrycode". `fireNotification` with a name → `{ title: name, body }` unchanged body; existing copy-table test keeps the "Pyrycode" title without a name.

No Playwright spec: the notification is OS-drawn and there is no in-app interaction.

## Open questions

- Should `\p{Cf}` (bidi overrides such as U+202E) also be dropped? The ticket names control characters only; the name is the operator's own host's conversation name, so a bidi override can only reorder that name's own text. Resolved: out of scope, noted in the security review.

## Documentation handoff

Pending for the documentation stage (no documentation-only ACs on the ticket; these follow from the change):

- `docs/knowledge/features/push-notifications.md` § "The guard is the security-relevant line" — the guard now also admits an optional string `name`; the closed-set invariant is scoped to the body.
- same file, § "The copy table is exhaustive by construction" — the table holds the body only; the title comes from `notificationTitle`.
- same file, § "Edge cases and limitations", bullet "No conversation id on the notification" — still true, but the title now names the conversation (resolved renderer-side).

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — two explicit boundaries. Renderer→main: `isNotifyPayload` admits `name` only as absent/undefined/string; `notificationTitle` is the single main-side cleaner and the only path from payload to the OS call. Host→renderer: the name is read from `conversationListStore` rows already parsed by `parseConversationSummary`; the lookup key is the client-bound `serverId` stamp (`ServerOrigin`), never a wire field, so a daemon cannot make its event resolve another host's row.
- [Tokens] No findings — no token, key or record field is touched; the only values read are a conversation id (lookup only, never sent) and a display name.
- [File / storage] No findings — the name is never a path, filename, cache key or storage key; the lookup index is the existing `Map` (no `__proto__` write-through).
- [Electron attack surface] No findings — no new channel, no new bridge method; the existing `notify` command widens by one optional field validated at the guard. Electron's `Notification` renders `title` as plain text (no markup parsing on macOS/Windows/Linux-libnotify titles). A compromised renderer can already choose when to notify; it can now also choose a ≤80-character, control-free title — no escalation beyond the renderer's own display capability.
- [Crypto] Not applicable — no cryptographic material in this path.
- [Network & I/O] Not applicable — main-local command, nothing reaches the transport. Size: `notificationTitle` stops after 80 kept characters, so an oversized name costs at most one scan to the 80th non-control character.
- [Logs] No findings — no log line is added; the `notify` case keeps logging nothing, and the name is stated as MUST-NOT-log in the `NotifyPayload` docblock and the `notify` case comment.
- [Concurrency] No findings — synchronous snapshot read per event; no new subscription, timer or listener.
- [Threat model] OUT OF SCOPE — bidi-format characters (`\p{Cf}`) in a host-supplied name can reorder the name's own glyphs in the title. The body stays client-owned and the name only ever names the host's own conversation, so impact is cosmetic; revisit only if a spoofing report surfaces. Hostile daemon names are otherwise bounded by the 80-character cut and control stripping.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
