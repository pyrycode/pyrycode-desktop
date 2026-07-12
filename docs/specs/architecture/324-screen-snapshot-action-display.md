# #324 — Screen-snapshot action & display

The view half of #318's store/render split: an in-thread control that fires the **existing**
`requestSnapshot` command (gated on connection), plus a display region that reads the screen-snapshot
store (#323) and shows the held rendered-screen `text` as **plain text in a `<pre>`**. No new command,
no new IPC, no new store — this slice only *reads* the store #323 already populates and *fires* the
command #180 already wired.

Size: **S** (confirmed, not split). Two production files: a new pure action helper and additions to
`ConversationScreen.tsx`. No consumer cascade, no signature changes.

---

## Files to read first

- `src/renderer/src/screens/conversation/runConfigSnapshot.ts:42-54` — `requestRunConfigSnapshot(sendCommand)`:
  the exact mirror for the new action helper — fires the inline `{ type: 'requestSnapshot', payload:
  { conversation_id: MILESTONE_CONVERSATION_ID } }` literal typed as `RendererCommand`, fire-and-forget.
- `src/renderer/src/screens/conversation/sendInterrupt.ts:12-35` — the guarded-send posture to copy:
  `SendInterruptDeps { sendCommand }`, single injected effect, `try/catch` that swallows a bridge failure
  (`console.error`, never rethrow) so a failed send can't crash the window.
- `src/renderer/src/screens/conversation/sendInterrupt.test.ts` — the action-helper test idiom (plain
  `vi.fn()` spy, "fires exactly one command", "swallows a bridge failure without throwing").
- `src/renderer/src/screens/conversation/runConfigSnapshot.test.ts:89-98` — the `requestRunConfigSnapshot`
  dispatch assertion (`toHaveBeenCalledWith({ type: 'requestSnapshot', payload: { conversation_id: … } })`).
- `src/renderer/src/store/screenSnapshotStore.ts` (whole file, ~67 lines) — the store this slice reads:
  `ScreenSnapshot = { text: string; ts: string }`, `useScreenSnapshotStore(selector)`, `selectScreenSnapshot`
  returning `ScreenSnapshot | null`. Read the header comment: `null` = "no screen yet", `{ text: '', ts }`
  = a real received blank screen; **text is held verbatim, the plain-text-never-HTML sink is THIS slice's job.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:451-531` — the `isTurnRunning` / `InterruptButton`
  (pure view) / `InterruptControl` (in-file container) triad: the exact pattern to clone. Note `window.pyry.sendCommand`
  is dereferenced **only inside the click closure** (`InterruptControl`, line 528), never at render.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:716-795` — `Composer`: the connection-gate
  read (`useSessionStore(selectStatus)` → `composerAvailability(status)`, line 728-729) and the
  `disabled={!canSend}` send button (line 779). AC2's gate reuses this exact `composerAvailability(status).canSend`.
- `src/renderer/src/screens/conversation/composerSend.ts:17` — `MILESTONE_CONVERSATION_ID` (`'default'`), and
  `composerAvailability` (line 94) — the shared connection-gate helper.
- `src/renderer/src/store/sessionStore.ts:16-20` — `ConnectionStatus` is a **discriminated union on `type`**,
  not a bare string; `selectStatus` at line ~170. The connected check is `status.type === 'connected'` (or,
  reused here, `composerAvailability(status).canSend`).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:443-480` (the `InterruptButton` describe)
  and `:872-882` (the container inert-slice smoke) — the pure-view + container-smoke test split to mirror.
- `src/renderer/src/screens/conversation/conversation.css` — the stylesheet the new region's few classes join
  (grep `.conversation__interrupt` / `.bubble--daemon` for the local idiom); add the `<pre>` styling here.

---

## Context

`requestSnapshot` was wired at #180; the daemon answers a snapshot request with **two** events — the
run-config fields (`snapshotReceived`, consumed by #187) and the rendered-screen text
(`screenSnapshotReceived`, added #316). #316's bridge (#323, merged PR#325) writes the screen text/ts into
`screenSnapshotStore` app-wide. Everything up to "the latest screen text is in a store" already exists.

This slice adds the **user-facing half**: (a) an action that requests a snapshot, and (b) a surface that
displays the held screen. Per the ticket sizing note, action + display ship as **one `s`** — a request
button with nothing to render is dead UI, and a display with no trigger only shows unsolicited pushes;
neither half is independently observable. This is the codebase's "guarded action helper + in-screen control"
slice (#307 `sendInterrupt` + `InterruptControl`; #166 `runUnpair` + `UnpairControl`), plus a `<pre>` panel
reading an existing store.

## Design source

N/A — the mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) does not draw a screen-snapshot / daemon-screen
surface (per the ticket body: Conversation Thread node `16-8` draws only the message list, the status row,
and the top-bar overflow). Visual design is a Figma-side follow-up for Juhana. The visual-fidelity check is
intentionally skipped for this slice; the developer builds a functional, unstyled-beyond-idiom `<pre>` panel
using existing `conversation.css` conventions. Keep it monospace/preformatted (a terminal screen) and bounded
(max-height + scroll) so it does not shove the composer off-screen.

---

## Design

Follow the established **pure-view + in-file-container** triad exactly (the `InterruptButton` / `InterruptControl`
shape). Everything lives in `ConversationScreen.tsx` beside its siblings, except the pure action helper, which
is its own co-located, React-free module (the `sendInterrupt.ts` / `runConfigSnapshot.ts` idiom).

### New file: `src/renderer/src/screens/conversation/requestScreenSnapshot.ts`

A pure, React-free, framework-free action helper — the `sendInterrupt` twin, but firing `requestSnapshot`
instead of `interrupt`. Contract:

```ts
export interface RequestScreenSnapshotDeps {
  sendCommand: (command: RendererCommand) => void
}
// Fire exactly one requestSnapshot for the milestone conversation. Guarded: a bridge failure is
// swallowed (console.error), never rethrown — a failed request must not crash the window.
export function requestScreenSnapshot(deps: RequestScreenSnapshotDeps): void
```

- Fires the inline literal `{ type: 'requestSnapshot', payload: { conversation_id: MILESTONE_CONVERSATION_ID } }`
  typed as `RendererCommand` — **no new command constructor**, exactly as `requestRunConfigSnapshot` does.
  Import `MILESTONE_CONVERSATION_ID` from `./composerSend`, and `type RendererCommand` from `@shared/ipc/commands`.
- Wrap the `sendCommand` call in `try/catch` (the `sendInterrupt` posture) — swallow + `console.error`, no local
  dispatch, no return value (`void`).
- **Why a `deps` object, not a bare `sendCommand` param?** Mirror `sendInterrupt`'s `SendInterruptDeps` shape
  rather than `requestRunConfigSnapshot`'s bare-param shape, because this helper has the guarded-send +
  swallow behavior of `sendInterrupt` (which `requestRunConfigSnapshot` lacks — the latter fires unguarded from
  inside a `useEffect`). This is a click-driven, fire-and-forget send; the `sendInterrupt` twin is the closer
  precedent. (Either shape is defensible; pick the `deps` shape for consistency with the guarded siblings.)

### Additions to `src/renderer/src/screens/conversation/ConversationScreen.tsx`

**Client-owned copy constants** (module scope, the `EMPTY_THREAD_COPY` / `INTERRUPT_LABEL` idiom —
apostrophe-free, never a daemon string):

- `SCREEN_SNAPSHOT_REQUEST_LABEL` — the request button's accessible/visible label, e.g. `'Show daemon screen'`.
- `SCREEN_SNAPSHOT_EMPTY_COPY` — the "no snapshot yet" placeholder, e.g. `'No screen snapshot yet'`.

**`ScreenSnapshotView` (exported pure view)** — props-in / markup-out, the whole affordance in one testable unit
(the `InterruptButton` posture, but bundling the display too since the two are one surface):

```ts
export function ScreenSnapshotView({
  snapshot,        // ScreenSnapshot | null — the held screen (null = none received yet)
  canRequest,      // boolean — the connection gate (composerAvailability(status).canSend)
  onRequest        // () => void — required injected effect (a view that cannot act is a bug)
}: {
  snapshot: ScreenSnapshot | null
  canRequest: boolean
  onRequest: () => void
}): JSX.Element
```

Render contract (this is the load-bearing AC surface):

- **Always** renders a request `<button type="button">` carrying `SCREEN_SNAPSHOT_REQUEST_LABEL`, `disabled={!canRequest}`,
  `onClick={onRequest}` (AC1/AC2). Mirror the composer send button's `disabled={!canSend}` exactly.
- **Display region**, discriminated on the null-vs-value distinction (AC3):
  - `snapshot === null` → render the `SCREEN_SNAPSHOT_EMPTY_COPY` placeholder (a `<p>`), **no `<pre>`**.
  - `snapshot !== null` → render a `<pre className="screen-snapshot__screen">{snapshot.text}</pre>`, and **not**
    the placeholder. For `{ text: '', ts }` the `<pre>` is present but empty — structurally distinct from the
    null placeholder (this is how "no snapshot yet" is told apart from "received a blank screen", AC3).
- **AC4 — untrusted text sink.** `snapshot.text` is rendered as **auto-escaped React children** inside the `<pre>`
  (`{snapshot.text}`), **never** `dangerouslySetInnerHTML`, never `innerHTML`. Any terminal control sequences /
  HTML render as literal characters. This is the assistantText / toolCall / workspaceCwd posture already in this
  file. The `<pre>` gives monospace + whitespace preservation (a terminal screen); ANSI-to-styling is explicitly
  out of scope (a separate fidelity follow-up).
- No `ts` rendering is required by the ACs; omit it (or render it only if trivially free — do **not** add a
  date-formatting helper; that is scope creep). Keep the surface to: button + placeholder-or-`<pre>`.

**`ScreenSnapshotControl` (in-file container, not exported)** — the `InterruptControl` twin. Reads both stores,
binds the effect, mounts the pure view:

```ts
function ScreenSnapshotControl(): JSX.Element {
  const status = useSessionStore(selectStatus)
  const snapshot = useScreenSnapshotStore(selectScreenSnapshot)
  return (
    <ScreenSnapshotView
      snapshot={snapshot}
      canRequest={composerAvailability(status).canSend}
      onRequest={() => requestScreenSnapshot({ sendCommand: window.pyry.sendCommand })}
    />
  )
}
```

- `window.pyry.sendCommand` is dereferenced **only inside the `onRequest` click closure** (the
  `InterruptControl` / `Composer.handleSubmit` discipline) — so the server-rendered container smoke test never
  touches the bridge.
- `canRequest` reuses `composerAvailability(status).canSend` (AC2: "the same connection read the composer's
  send-gate uses") — a single source of truth for the connected gate, no re-deriving `status.type === 'connected'`.
- Two narrow-slice store reads (status + snapshot). Both slices are orthogonal to the timeline, so this control
  re-renders only on a connection change or a new snapshot — no timeline-delta churn.

**Mount** — add `<ScreenSnapshotControl />` once inside `ConversationScreen`'s `<div className="conversation">`.
Placement: alongside the other in-thread controls, near `<StatusRow />` / `<InterruptControl />` (between the
status row and the composer is natural — it is a "daemon inspection" affordance, a sibling of the run-config
row). Exact position is not AC-load-bearing; keep it above `<Composer />` so the composer stays pinned at the
bottom. Unlike `InterruptControl` (which is `null` at rest), this control always renders (button + placeholder),
so it is always visible — bound with CSS max-height so a large screen dump scrolls internally.

### New imports in `ConversationScreen.tsx`

- `import { requestScreenSnapshot } from './requestScreenSnapshot'`
- `import { useScreenSnapshotStore, selectScreenSnapshot, type ScreenSnapshot } from '../../store/screenSnapshotStore'`
- (`useSessionStore`, `selectStatus`, `composerAvailability` are already imported.)

### `conversation.css` additions (a handful of lines)

- `.screen-snapshot` — the region wrapper (spacing consistent with `.conversation__interrupt` / `.status-row`).
- `.screen-snapshot__request` — the button (reuse the de-emphasized text-button treatment, e.g. the
  `.conversation__unpair` idiom, or the icon-button idiom if the developer prefers an icon; a plain labelled
  button is fine and simplest).
- `.screen-snapshot__screen` — the `<pre>`: `font-family` monospace, `white-space: pre`, `max-height` (bounded,
  e.g. a sensible cap) + `overflow: auto`, plus the surface fill/radius/padding matching `.bubble--daemon` so it
  reads as daemon-originated content.
- `.screen-snapshot__empty` — the placeholder line (muted, the `.composer__hint` treatment).

## State + concurrency model

- **No new store, no new bridge, no new IPC.** #323's `screenSnapshotBridge` already subscribes to
  `screenSnapshotReceived` and writes `screenSnapshotStore` app-wide; this slice only *reads* it via
  `useScreenSnapshotStore(selectScreenSnapshot)`. Do **not** re-subscribe to `onDaemonEvent` here.
- **Reactivity (AC3 "updating when a newer snapshot arrives")** is free from the store subscription: the
  bridge's `setSnapshot` replaces the whole snapshot object (most-recent-wins), which re-renders
  `ScreenSnapshotControl` (it selects that slice) and the view shows the new text. No local state, no effects,
  no cancellation surface — the control is a pure read + a click-driven fire-and-forget send.
- **The action** is a one-shot fire-and-forget `sendCommand` (the daemon owes a reply via the same
  `screenSnapshotReceived` path; there is no request/response correlation to track in this slice — that is the
  transport's job, already done). No `AbortController`, no pending state, no optimistic mutation: a re-request
  simply overwrites the store when its reply lands.

## Error handling

- **Send-bridge failure** (`window.pyry.sendCommand` throws): swallowed inside `requestScreenSnapshot`
  (`try/catch` + `console.error`), never propagated — the window stays up, the held screen is unchanged. The
  `sendInterrupt` / `submitMessage` posture.
- **Untrusted daemon content** (the screen `text`): the security concern of this slice. Handled structurally by
  the plain-text `<pre>` sink (AC4) — auto-escaped React children, never an HTML sink. Not label-gated as
  security-sensitive, but the plain-text discipline is a hard AC and a load-bearing test.
- **No network/socket/parse handling here** — those live in the transport (`src/main`); by the time a snapshot
  reaches the store it is already parsed and typed.

## Testing strategy

Mirror the `InterruptButton` (pure view) + `sendInterrupt` (helper) + container-smoke split. No jsdom — the
suite server-renders with `renderToStaticMarkup` (`node` env, no click harness), so the populated/connected
branches are proven on the **pure view with injected props**, and the disconnected/empty branch on the
**container smoke** (zustand v5 reads `getInitialState()` under server render → `status: disconnected`,
`snapshot: null`). This is the same reason every sibling (Timeline, InterruptButton, ConnectionBanner) proves
its shown path on the pure view.

**New file `requestScreenSnapshot.test.ts`** (the `sendInterrupt.test.ts` idiom, plain `vi.fn()` spy):
- Fires exactly one command per call, and it is `{ type: 'requestSnapshot', payload: { conversation_id:
  MILESTONE_CONVERSATION_ID } }` (assert `toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith(…)`). — AC1 / AC5
  "triggering the action dispatches requestSnapshot" (proven at the helper level; the `node` env fires no clicks).
- Swallows a throwing `sendCommand` without rethrowing (spy that throws; `expect(() => …).not.toThrow()`;
  `console.error` spied + restored).

**`ScreenSnapshotView` describe in `ConversationScreen.test.tsx`** (inject props, server-render the markup):
- `snapshot={null}` → markup contains `SCREEN_SNAPSHOT_EMPTY_COPY`, does **not** contain a `<pre` /
  `.screen-snapshot__screen` (the no-snapshot state, AC3).
- `snapshot={{ text: 'hello world', ts }}` → markup contains a `.screen-snapshot__screen` `<pre>` carrying
  `hello world`, and does **not** contain the placeholder copy (a received snapshot shows, AC3/AC5).
- `snapshot={{ text: '', ts }}` → markup contains the `<pre>` (present, empty content) and **not** the
  placeholder — the blank-screen-vs-null distinction (AC3).
- `snapshot={{ text: '<b>x</b>', ts }}` → markup contains the escaped `&lt;b&gt;x&lt;/b&gt;` and **not** the live
  `<b>x</b>`; assert the markup contains no `dangerouslySetInnerHTML` sink is unnecessary (React never emits it),
  but the escape assertion is the AC4 proof. Use an apostrophe-free fixture (`renderToStaticMarkup` escapes
  `'` → `&#x27;`, the standing desktop lesson).
- `canRequest={true}` → the request button is present and **not** `disabled`; `canRequest={false}` → the button
  is present and `disabled` (AC2). Match the exact button class so the assertion is unambiguous.

**Container smoke in the `ConversationScreen — store binding` describe** (against the initial stores):
- Mounts against the initial disconnected + null-snapshot store → the request button renders **disabled** (the
  composer-send-gate parallel: disconnected is the only server-render-reachable branch) and the
  `SCREEN_SNAPSHOT_EMPTY_COPY` placeholder is present with no `<pre>` (AC2 disabled-when-not-connected + AC3
  no-snapshot). Also confirms `window.pyry` is not touched at render (the bridge lives only in the click closure).

**Note on AC5's "populates and shows the display".** The store→view reactive wiring itself (bridge writes store,
selector re-renders) is already covered by `screenSnapshotStore.test.ts` + `screenSnapshotBridge.test.ts` (#323);
this slice's contribution is the *render* of an injected snapshot (the pure-view test with `{ text: 'hello…' }`)
— the exact value the store holds after the bridge writes it. Do not add a jsdom mount to re-prove #323's
reactive path; that would duplicate coverage and break the `node`-env convention.

## Open questions

- **Placement precision.** The spec puts `<ScreenSnapshotControl />` between the status row and the composer.
  If, in implementation, that feels visually wrong given the always-visible placeholder, moving it (e.g. below
  the timeline, or gating the whole region behind an "open" toggle like `StatusSheet`) is acceptable — but a
  toggle adds `useState` + trigger glue and is **not** required by the ACs; prefer the always-visible bounded
  panel unless a real problem surfaces. Do not expand scope into a full sheet host.
- **Request vs. refresh labelling.** Once a snapshot is shown, the same button re-requests (a "refresh"). A
  single static `SCREEN_SNAPSHOT_REQUEST_LABEL` covers both honestly; a snapshot-aware label swap is optional
  polish, not an AC — skip it to keep the view a pure function of its three props.
</content>
</invoke>
