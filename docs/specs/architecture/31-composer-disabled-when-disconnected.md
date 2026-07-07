# #31 — Disable the composer send control while the daemon session is not connected

**Size:** S (renderer-only; 2 production files modified, 1 CSS, 2 test files; no new files, no new store slice, no transport/preload/IPC change). Refines #11; the crash-guard half is already shipped by #65 (main/transport no-throw) + #66 (renderer send bridge, AC4). This ticket adds only the *visible* half — a UX affordance layered on the already-safe send path.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-61

The Composer (node 16-61) is a pinned row: a rounded `surface-container-high` input pill on the left and a separate round (`radius-full`, 48px) `surface-container-high` send button on the right, both with `on-surface` icons. **The Figma node shows only the connected/enabled baseline — there is no designed disabled state and no inline "why" hint in the design.** Those two states are net-new UX this ticket introduces; derive their styling from existing theme tokens (muted `--color-on-surface-variant` for both the disabled send icon and the hint caption). Do **not** touch the send icon, the input, or the mic glyph — the enabled composer markup #66 built stays as-is; you only add a `disabled` attribute, a conditional hint element, and their styles.

## Context

Today a send issued while the app is not connected to the daemon is *silently* dropped: #65 makes `daemonConnection.send()` an idempotent no-op with no driver, and #66's renderer bridge swallows a failed send — so the keystroke goes nowhere with no feedback. The user has no way to tell a live session from a dead one; they type into a void.

The session store already exposes the connection lifecycle: `selectStatus` returns a `ConnectionStatus` discriminated union (`disconnected | connecting | connected | error`), fed reactively by the `DaemonEvent` channel. This ticket reads that one slice at render time and reflects it in the composer: the send control is disabled unless `status.type === 'connected'`, and a lightweight inline caption says *why* it's unavailable.

**This is a UX affordance, not a safety net.** The belt (never crash / never emit on a dead send) is #65 + #66's deterministic code. This is the suspenders the user can see. Per the ticket's Technical Notes: **do not add a second safety guard** in the renderer beyond #66's existing `try/catch` around `sendCommand` — the gate here is purely a render-time read that governs the UI affordance, not a defensive no-op.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:51-101` — the `Composer` container (#66). This is the file you modify. Note `handleSubmit` (used by both `onClick` and Enter), `handleKeyDown` (Enter→submit, Shift+Enter→newline), and that it selects only the stable `dispatch` today.
- `src/renderer/src/screens/conversation/composerSend.ts` (whole, ~68 LOC) — the pure, React-free composer-logic module. Add `composerAvailability` here, alongside `submitMessage`; follow its injected-deps / plain-value idiom. `submitMessage` itself is **not** changed.
- `src/renderer/src/store/sessionStore.ts:14-31,139` — `ConnectionStatus` (the 4 arms; `connected` carries `ack`, `error` carries a `ConnectionError`) and the `selectStatus` selector the gate reads. Do not add a new state source.
- `src/renderer/src/screens/conversation/conversation.css:66-129` — `.composer`, `.composer__input`, `.composer__send` (+ `:hover`, `:focus-visible`). You restructure `.composer` into a column wrapper + a `.composer__row`, and add `.composer__hint` and `.composer__send:disabled`. Every value is a theme token — keep it that way.
- `src/renderer/src/theme/tokens.css:16-28,55-68` — the color + small-text tokens: `--color-on-surface-variant` (muted content), `--text-body-small-*` / `--text-label-small-*` (caption scale), spacing scale.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:10-13,50-70` — the `renderToStaticMarkup` smoke-test harness **and the load-bearing caveat**: under server rendering, zustand v5's `useStore` reads `getInitialState()`, not `setState`-mutated state. The initial store state is `{ status: disconnected, messages: [] }`, so the container smoke test always sees the *disconnected* branch. Add the disabled-button + hint assertions here.
- `src/renderer/src/screens/conversation/composerSend.test.ts` — the pure-function test idiom (plain `vi.fn()` spies, no DOM/store/Electron). Add the `composerAvailability` describe block here.
- `docs/knowledge/codebase/66.md` — the pure-logic/thin-container split and the **deferred DOM-interaction testing** note. This is *why* the send/no-send decision and the hint text must live in a pure function: the harness is `renderToStaticMarkup` (node, no jsdom), so anything that must be tested deterministically cannot depend on firing DOM events.

## Design

### The gate is a pure predicate over `ConnectionStatus`

The load-bearing decision — *can we send, and if not, why?* — is a total mapping over the four status arms. Put it in `composerSend.ts` as a pure, React-free function so it is unit-testable without a DOM (the same reason `submitMessage` is pure). Both facts it produces (the boolean and the caption) are derived from the single `selectStatus` read, so there is exactly **one** source of truth.

```ts
export interface ComposerAvailability {
  canSend: boolean      // true only when status.type === 'connected'
  hint: string | null   // short "why unavailable" caption; null iff canSend
}

// Total over ConnectionStatus's four arms. Pure — no store, no React, no I/O.
export function composerAvailability(status: ConnectionStatus): ComposerAvailability
```

Behaviour, one row per arm (the developer writes the bodies; keep the copy short and sentence-case):

| `status.type` | `canSend` | `hint` |
|---|---|---|
| `connected` | `true` | `null` |
| `connecting` | `false` | e.g. `'Connecting…'` |
| `disconnected` | `false` | e.g. `'Not connected'` |
| `error` | `false` | e.g. `'Connection error'` |

**Boundary constraint (do not cross):** the `error` arm's hint is a short, generic status label. It **must not** read or embed `status.error.message` — the `ConnectionError.message` ("for the banner") is a distinct surface, explicitly out of scope per the ticket. Surfacing it here would leak the banner's job into the composer. A test asserts the hint does not contain the error's message string.

Import `ConnectionStatus` from `../../store/sessionStore` (already a sibling import in this module for `SessionAction`; the `@shared` alias caveat does not apply — this is renderer code).

### Container wiring (`Composer` in `ConversationScreen.tsx`)

The container stays thin glue over the pure predicate — the pairing/messageViewModel/#66 precedent. Changes, all inside the existing `Composer` function:

- Select the status slice: `const status = useSessionStore(selectStatus)`, then `const { canSend, hint } = composerAvailability(status)`. (Import `selectStatus` alongside the existing `selectMessages` import.)
- **Guard the send decision** at the top of `handleSubmit`: return early when `!canSend`, before touching `submitMessage`. This blocks the Enter path (`handleKeyDown` → `handleSubmit`) and is the authoritative gate; `submitMessage` is never reached while disconnected, so no `sendCommand` and no optimistic `dispatch` fire. The input is **not** cleared (nothing was sent).
- **Disable the button natively:** `disabled={!canSend}` on the send `<button>`. A disabled button fires no `onClick`, so the button path is blocked by the platform in addition to the handler guard — same `canSend`, two render outputs, one source of truth (not a redundant safety net).
- Leave the `<textarea>` **enabled** — the user may draft while `connecting`. Only the *send control* is gated (AC1's exact wording).
- **Render the hint** conditionally: when `hint` is non-null, render a caption element (see markup below).

### Markup + CSS restructure

To seat the caption above the input/button row without disturbing that row's flex layout, wrap the existing two elements in a `.composer__row` and let `.composer` become a vertical stack. Contract-level markup shape (not a paste-in — preserve the existing textarea/button attributes and the SVG):

```
<div className="composer">
  {hint && <p className="composer__hint" role="status">{hint}</p>}
  <div className="composer__row">
    <textarea className="composer__input" … />           {/* unchanged */}
    <button className="composer__send" … disabled={!canSend}>…</button>
  </div>
</div>
```

`role="status"` makes the caption a polite live region, so a screen reader announces the status change (AC2/AC3) without stealing focus. When `status` flips to `connected`, `hint` is `null`, the `<p>` unmounts, and the button re-enables — no announcement needed for the recovery.

CSS changes in `conversation.css` (all values from tokens):

- `.composer` — move to a column: keep `flex: 0 0 auto`, padding, and background; set `flex-direction: column`, `align-items: stretch`, and `gap: var(--space-1)`. Remove the row-only `align-items: flex-end` / `gap` from it.
- `.composer__row` (new) — carries the former row layout: `display: flex; align-items: flex-end; gap: var(--space-2)`.
- `.composer__hint` (new) — muted caption: `color: var(--color-on-surface-variant)`, the `--text-body-small-*` (or `--text-label-small-*`) scale, small horizontal padding to align with the input. Keep it lightweight — one short line.
- `.composer__send:disabled` (new) — reduced-emphasis: `cursor: not-allowed`, `color: var(--color-on-surface-variant)` for the muted icon, and neutralize the `:hover` background change (guard the existing `.composer__send:hover` with `:not(:disabled)` or override under `:disabled`). Prefer muted content color over a raw `opacity` literal, matching the M3 disabled-content convention and the file's "no bare literals" rule.

## State + concurrency model

- **No new state.** No store slice, no reducer arm, no async task, no `useEffect`, no subscription, no timer. The gate is a synchronous render-time read of the existing `status` slice.
- **Re-render seams.** `Composer` now selects `status` in addition to the stable `dispatch`, so it re-renders when the connection status changes — exactly the reactive behaviour AC3 requires. The message thread is a *separate* component that selects only `selectMessages`, so status changes do **not** re-render the thread. Narrow-slice selection (ADR 0004 / the store's design) is preserved.
- **Teardown.** Nothing to tear down — no effect, no listener, no promise outlives a render.

## Error handling

- The only error surface touched is `status.type === 'error'`, rendered as the short generic hint (`'Connection error'`), never the wire/transport `ConnectionError.message`.
- **No new failure modes and no new guard.** This is pure render logic; there is no I/O to fail. Per the Technical Notes, the deterministic no-throw safety already lives in #65's `daemonConnection.send()` and #66's `sendCommand` `try/catch`; this ticket adds neither a second safety net nor any `try/catch`.

## Testing strategy

Test-first, `vitest`. Two buckets — mirror #66's split (pure choke point tested directly; thin React wiring smoke-tested).

**Pure: `composerAvailability` (new describe in `composerSend.test.ts`, plain values, no spies needed):**
- `connected` (with any stub `HelloAckPayload`) → `{ canSend: true, hint: null }`.
- `connecting` → `canSend === false` and `hint` a non-empty string.
- `disconnected` → `canSend === false` and `hint` a non-empty string.
- `error` → `canSend === false` and `hint` a non-empty string **that does not contain** the `ConnectionError.message` — build the status with a distinctive message (e.g. `'BANNER-ONLY-TEXT'`) and assert `hint` excludes it. This nails the out-of-scope boundary.
- The three not-connected arms yield *distinct* hints (each tied to its own status), proving AC2's "tied to the connection status".

**Container smoke: `ConversationScreen.test.tsx` (`renderToStaticMarkup`, initial store = `disconnected`):**
- The send button renders with the `disabled` attribute (the initial state is not connected). Assert against the send control's markup (the element carrying `aria-label="Send"`).
- The inline hint renders: the markup contains `class="composer__hint"` (and `role="status"`) with the disconnected copy.
- Because server rendering reads `getInitialState()` (never `setState`), the **connected/enabled** branch is *not* smoke-testable in the container — it is covered by the `composerAvailability(connected)` pure test above. Note this in the test comment, mirroring #66's deferred-DOM-testing note; don't attempt to force a connected render via `setState`, it won't take.

**Not tested here (carried forward, consistent with #66):** live DOM interaction — actual Enter/click event dispatch, `disabled`-button click suppression at runtime, `onChange` typing — remains untested because the harness is `renderToStaticMarkup` (no jsdom). The send/no-send *decision* is fully covered by the pure `composerAvailability` test; the container's use of it (`disabled` attr + `handleSubmit` early-return) is thin glue over that tested predicate. Closing the DOM-interaction gap needs the jsdom/Testing-Library harness #66/#69 deferred.

**Gates:** `npm run typecheck`, `npm test`, `npm run build` all clean (AC4).

## Acceptance criteria → design mapping

- **AC1** (not connected ⇒ neither Enter nor button emits a `sendMessage` or appends an echo): `composerAvailability(...).canSend === false` for all three not-connected arms (pure-tested); container blocks the Enter path via the `handleSubmit` early-return and the button path via native `disabled`; `submitMessage` is never called, so no `sendCommand`, no `dispatch`.
- **AC2** (lightweight inline indication of *why*, tied to status): `composerAvailability(...).hint` per arm (pure-tested, distinct per status), rendered as `.composer__hint`.
- **AC3** (transition to `connected` ⇒ normal, no reload): `Composer` selects `status`, so a `connected` dispatch re-renders it; `composerAvailability(connected) = { canSend: true, hint: null }` re-enables the button and unmounts the hint. Same reactive store→UI mechanism #69 uses for the thread (reactive path proven in `sessionStore.test.ts`; mapping proven in the new pure test).
- **AC4**: the three gates above.

## Open questions

- **Hint copy.** The table gives placeholder strings (`'Connecting…'`, `'Not connected'`, `'Connection error'`); the Figma node has no designed copy for these states. Short sentence-case labels are the intent — the exact words are the developer's call and can be tuned later without design churn.
- **Enter while disconnected.** With the `handleSubmit` early-return, Enter is inert while not connected (no send, and `handleKeyDown`'s `preventDefault` also suppresses a newline). Allowing Enter to insert a newline while drafting-during-`connecting` is a marginal nicety; not required by any AC. Keep the simple inert behaviour unless it feels wrong in the running app.
