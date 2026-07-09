# Spec — #72: Log data Download button in the Run configuration modal

**Size:** S (renderer-only; 3 production files touched, 2 new). **Not security-sensitive** (labels confirm; the three events carry only a count, a local path, and a closed enum — the secret-free-by-construction contract is already enforced upstream in `events.ts`).

## Context

This is the sole user-facing entry point for the debug-bundle download. The entire background-process chain is built and merged: request (#115), reassemble (#116), save (#117), orchestrator + wiring (#169), and the typed IPC command/event contract (#168). The host modal — the **Status sheet** (Run configuration) — is built and merged by **#177** (PR #184); its blocker #156 was split and closed. `ConversationScreen.tsx` already renders an exported, pure `StatusSheet` with an **empty** `.status-sheet__body` that follow-up sections populate one at a time.

This ticket adds the last section, **Log data**, beneath Context-window (Figma node 20-100, subtree `98:2`/`98:16`): a section header plus a full-width filled-tonal **Download** button, wired to fire `requestDebugBundle` and reflect the three debug-bundle daemon events as a small local state machine. Presentation only — no new wire types, no store, no main-process change.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

The **Log data** section (subtree `98:2`→`98:19`) is a column: a `Log data` section-header row (`label-large`, `on-surface-variant`, identical to the Model/Effort/YOLO/Context-window headers) followed by a single **full-width filled-tonal pill button** labelled `Download` — background `Schemes/Secondary Container` **#3a4857**, text `Schemes/On Secondary Container` **#d6e4f7**, `label-large` weight-500, pill radius. The busy / saved / error states are **not drawn** in the design (only the idle button is) — they are desktop-specific additions modelled on the pairing screen's precedent (`pairing__error` uses `--color-tertiary` as the palette's attention color), so there is no visual reference to diverge from for those.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:100-146` — exported pure `StatusSheet` + `StatusSheetProps` and the empty `.status-sheet__body`; **34-42** the container that renders `{sheetOpen && <StatusSheet …/>}`. This is the attach seam.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:55-81` — the `StatusSheet` test suite, incl. `renders an empty scrollable body` which pins `Log data`/`Download` **absent** for a *childless* `<StatusSheet/>`. Must stay green untouched (you pass no children in that test).
- `src/renderer/src/screens/conversation/composerSend.ts:1-60` — the idiom to mirror: pure, React-free logic in a `.ts` file with injected effects + a `composerAvailability(status) → {canSend, hint}` view-model function; the React container is thin glue over it.
- `src/renderer/src/store/daemonEventBridge.ts:27-80` — the `onDaemonEvent` subscribe/unsubscribe-on-unmount idiom (`useEffect` returning the `off` handle) and the choke point where the three `debugBundle*` events return `null` (the store does **not** consume them — this UI does).
- `src/shared/ipc/events.ts:27-59` — `DaemonEvent`: `debugBundleProgress {chunksReceived:number}`, `debugBundleSaved {path:string}`, `debugBundleFailed {reason:DebugBundleFailure}`; `DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'`.
- `src/shared/ipc/commands.ts:39-52` — `RendererCommand`; the bare `{ type: 'requestDebugBundle' }` member (no payload).
- `src/preload/index.ts:81-92` and `:24-26` — `onDaemonEvent(listener) → unsubscribe` and `sendCommand(command)`; the `window.pyry` surface this section uses.
- `src/renderer/src/theme/tokens.css:15-30` — the color tokens; you add two (below).
- `src/renderer/src/screens/conversation/conversation.css:220-357` — the `status-row`/`status-sheet` styles; add the section-header + log-data styles alongside, every value via a token.
- `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` — the mandate: ephemeral screen-local state is `useReducer` over a **pure reducer**, never the module-singleton store. The download state is exactly this.

## Design

### Module structure

Three production files (mirrors the `composerSend.ts` (pure logic) + `Composer` (container) split):

1. **`src/renderer/src/screens/conversation/logDataDownload.ts`** — new, pure, React-free logic.
2. **`src/renderer/src/screens/conversation/LogDataSection.tsx`** — new; the pure `LogDataView` (props-in/markup-out, the `MessageThread`/`StatusSheet` pattern) plus the thin `LogDataSection` container.
3. **`src/renderer/src/screens/conversation/ConversationScreen.tsx`** — edit: give `StatusSheet` an optional `children`, render it in the body, and mount `<LogDataSection/>` as the (currently only) child.

Plus non-counting edits: `tokens.css` (+2 tokens), `conversation.css` (section styles).

### State model (`logDataDownload.ts`)

A four-state machine. Contract sketch (types only — no bodies):

```ts
export type DownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; chunks: number }
  | { phase: 'saved'; path: string }
  | { phase: 'failed'; reason: DebugBundleFailure }

export type DownloadAction =
  | { type: 'requested' }                            // user pressed Download
  | { type: 'progress'; chunks: number }             // ← debugBundleProgress
  | { type: 'saved'; path: string }                  // ← debugBundleSaved
  | { type: 'failed'; reason: DebugBundleFailure }   // ← debugBundleFailed

export const initialDownloadState: DownloadState  // = { phase: 'idle' }
export function reduceDownload(state: DownloadState, action: DownloadAction): DownloadState
export function toDownloadAction(event: DaemonEvent): DownloadAction | null
export function downloadView(state: DownloadState): DownloadViewModel
```

- `reduceDownload` — **phase-agnostic and total**: each action fully determines the next state (`requested → downloading{chunks:0}`, `progress → downloading{chunks}`, `saved → saved{path}`, `failed → failed{reason}`). No cross-state branching in the reducer; the single-in-flight *guard* lives in the container + orchestrator, not here (see below).
- `toDownloadAction` — the `translateDaemonEvent` analogue: maps the three `debugBundle*` events to their action, returns `null` for every other `DaemonEvent` member (the filter). Keeping it a pure function makes the "ignores unrelated events" behavior unit-testable without React.
- `downloadView(state) → { label, busy, status }` — the `composerAvailability` analogue; the one place presentation strings are derived. Behavior summary:
  - `label`: `'Downloading…'` while `downloading`, else `'Download'`.
  - `busy`: `true` iff `downloading` (drives `disabled` + `aria-busy`).
  - `status`: `{ text, isError } | null` — `null` when `idle`; a running-count line while `downloading` (must contain the `chunks` count — AC3, no total/percentage exists); the saved path while `saved` (`isError:false`); the mapped user message while `failed` (`isError:true`). **AC5 is enforced here**: the failed text is drawn from a closed `reason → sentence` map; it must never contain the raw reason token, an errno, or a stack. Proposed copy (developer may refine, but the shape — a plain sentence, no code — is fixed):
    - `unavailable` → “Debug data isn’t available right now. Try again in a moment.”
    - `stream-corrupt` → “The download was interrupted. Please try again.”
    - `write-failed` → “Couldn’t save the download. Check that there’s disk space and try again.”

### Container + view (`LogDataSection.tsx`)

- **`LogDataView({ state, onDownload })`** — pure, exported, server-renderable. Renders (owning both its header and content, per the shell's per-section contract):
  - the section header `Log data` (`.status-sheet__section-header`);
  - the full-width Download button (`.log-data__download`) — accessible name `Download` (or `Downloading…`), `disabled`/`aria-busy` from `busy`, `onClick={onDownload}`;
  - the status caption (`.log-data__status`, `role="status"` polite live region) rendered only when `status` is non-null, gaining `.log-data__status--error` when `status.isError`.
- **`LogDataSection()`** — thin container:
  - `const [state, dispatch] = useReducer(reduceDownload, initialDownloadState)` (ADR 0006).
  - `useEffect(() => window.pyry.onDaemonEvent(e => { const a = toDownloadAction(e); if (a) dispatch(a) }), [])` — one subscription; the returned `off` handle is the effect cleanup, so a sheet-close/open remount nets exactly one live listener.
  - `onDownload`: if `state.phase === 'downloading'` return (guard); else `window.pyry.sendCommand({ type: 'requestDebugBundle' })` then `dispatch({ type: 'requested' })` (optimistic — the `unavailable` path emits no progress, so the busy state must not wait on an event).
  - `window.pyry` is dereferenced only in the effect and the handler, never in render — so `renderToStaticMarkup(<LogDataSection/>)` renders the idle view without a bridge mock (same discipline as `Composer.handleSubmit`).

### Attach seam (`ConversationScreen.tsx`)

- `StatusSheetProps` gains `children?: ReactNode` (import `type ReactNode`); `StatusSheet` renders `{children}` inside `.status-sheet__body` (replacing the self-closing empty `<div className="status-sheet__body" />`).
- The container mounts the section as a child:
  ```tsx
  {sheetOpen && (
    <StatusSheet onClose={() => setSheetOpen(false)}>
      <LogDataSection />
    </StatusSheet>
  )}
  ```
  Ordering note for #181/#182: Log data is the **last** child (“beneath Context-window”); those tickets prepend their sections above `<LogDataSection/>`.

**Why `children`, not a direct import:** it keeps `StatusSheet` a pure shell and keeps the existing `renders an empty scrollable body` test valid — a *childless* `<StatusSheet/>` still has no sections, so `Log data`/`Download` stay absent there. Do **not** modify that test.

### Styles (`conversation.css`, all tokens)

- `.status-sheet__section-header` — the reusable section-header (first defined here; #181/#182 reuse it): `label-large` type tokens, `color: var(--color-on-surface-variant)`, padding mapping Figma pt-12/pl-24/pr-16/pb-4 to `var(--space-3) var(--space-4) var(--space-1) var(--space-6)`.
- `.log-data` — the section body wrapper: `padding: var(--space-1) var(--space-4) 0` (Figma pt-4 px-16), column, `gap: var(--space-2)`.
- `.log-data__download` — full-width filled-tonal pill: `width:100%`, `background: var(--color-secondary-container)`, `color: var(--color-on-secondary-container)`, `border:none`, `border-radius: var(--radius-full)`, `padding: var(--space-3) var(--space-4)` (Figma py-10 → space-3, the ±2px-tokenized convention the `status-row`/`pairing` styles already use), `label-large` type tokens, `cursor:pointer`, centered text. `:focus-visible { outline: 1px solid var(--color-outline) }`. `:disabled { color: var(--color-on-surface-variant); cursor: not-allowed }` (the `composer__send:disabled` muted-content convention — no opacity literal). Hover is omitted (no design ref, no state-layer token).
- `.log-data__status` — `body-small` tokens, `color: var(--color-on-surface-variant)`, `word-break: break-word` (the saved path can be long). `.log-data__status--error` overrides `color: var(--color-tertiary)` (the `pairing__error` precedent — the palette's only attention color; there is no `--color-error` token on desktop).

### Tokens (`tokens.css`, additive — the #177 precedent added `surface-container-low` + `scrim`)

Add under the Colors block (authoritative values fetched from Figma `get_variable_defs` on node 98-18):

```css
--color-secondary-container: #3a4857;
--color-on-secondary-container: #d6e4f7;
```

## State + concurrency model

- **Store slices:** none. The download state is `useReducer`-local per ADR 0006; the session store is untouched (`translateDaemonEvent` already returns `null` for all three events).
- **Subscription:** a single `window.pyry.onDaemonEvent` in the container's mount effect, torn down via the returned `off` handle on unmount → no listener accumulation across sheet remounts.
- **Single-in-flight — belt-and-suspenders, different fabric:** (1) the button is `disabled` while `downloading`; (2) `onDownload` re-checks `phase` before sending; (3) the **deterministic** backstop is the #169 orchestrator's single-in-flight guard on the main side — a stray duplicate command is dropped there, not by another React guard. AC3 satisfied.
- **Accepted ephemerality:** closing the sheet mid-download unmounts the section and discards its state; the main-process download continues regardless, and reopening shows `idle` until the next `progress`/`saved`/`failed` event re-hydrates the view (the reducer is phase-agnostic, so a bare `progress` moves `idle → downloading` cleanly). This is intended per ADR 0006 — the state is view-state, not truth.

## Error handling

- **Daemon-reported failure:** the only failure surface. `debugBundleFailed{reason}` → `downloadView` maps the closed `DebugBundleFailure` set to a plain sentence; **never** a raw code, errno, or stack (AC5). Assert this negatively in tests.
- **Command send:** fire-and-forget (`ipcRenderer.send`), no reply, no throw path to handle — mirrors `Composer`. The optimistic `requested` transition covers the `unavailable` case (which emits no progress).
- **Subscription:** the listener only `dispatch`es; it never throws into render. The raw `IpcRendererEvent` is already stripped at the preload boundary.

## Testing strategy

Vitest, no DOM harness (jsdom/Testing Library) — pure logic tested as plain functions, pure view server-rendered, exactly as `composerSend.test.ts` / the `StatusSheet` suite do.

**`logDataDownload.test.ts`** (pure):
- `reduceDownload`: each action from a representative prior state proves totality — `requested → downloading{0}`, `progress{5} → downloading{5}` (from `downloading{0}` and from `idle`), `saved{p} → saved{p}`, `failed{r} → failed{r}`.
- `toDownloadAction`: the three `debugBundle*` events map to the right action; a non-bundle event (`connected`, `messageReceived`, `snapshotReceived`) → `null`.
- `downloadView`: `idle → {label:'Download', busy:false, status:null}`; `downloading{3} → busy:true` and `status.text` contains `"3"`; `saved{path} → label:'Download'`, `status.text` contains the path, `status.isError:false`; `failed{reason}` for each of the three reasons → distinct `status.text`, `isError:true`, **and** none of the three texts contains its raw reason token, `"errno"`, or a stack marker (AC5).

**`LogDataSection.test.tsx`** (server-render the pure `LogDataView`):
- `idle` → renders the `Log data` header and a `Download` button; no status caption.
- `downloading{3}` → button is `disabled`/`aria-busy`; a `role="status"` caption shows the running count `3`.
- `saved{'/Users/x/pyry-debug.tar.gz'}` → caption contains the path; button not disabled (pressable again).
- `failed{'unavailable'}` → caption carries the mapped sentence with the `--error` class; button not disabled; caption does not contain `unavailable`.
- (smoke) `renderToStaticMarkup(<LogDataSection/>)` does not throw and contains the idle `Download` button — proves the container renders without touching `window.pyry`.

Type coverage: `npm run typecheck`; build gate: `npm run build`.

## Open questions

- **Failure/progress/saved copy** — the sentences above are proposals; the developer may refine wording, but the constraint (a plain sentence, never a raw code/errno/stack) is fixed.
- **Progress placement** — count shown in the status caption (recommended, keeps button width stable) vs. in the busy button label. Either satisfies AC3 as long as the count is visible and updates; the test keys on the count appearing in the rendered section, not on which element holds it.
