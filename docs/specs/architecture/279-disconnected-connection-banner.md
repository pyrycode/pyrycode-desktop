# Spec #279 — Disconnected connection banner in the conversation thread

Split from #148 (thread-chrome). Size **XS**. Not security-sensitive (renderer-only read of
the existing `sessionStore` connection slice — no keys, sockets, or Noise handshake touched).

## Design source

N/A — the mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) has no frame for the disconnected thread
banner; only the connected Conversation Thread Screen (node 16-8) is drawn. Sourced from the locked
mobile design doc ("Connection state banner (top, only when not connected)"). A request to add the
frame is filed on the parent #148. The visual-fidelity check is intentionally sourced from the design
doc, not a Figma node.

## Files to read first

- `src/renderer/src/screens/conversation/composerSend.ts:69-129` — the two existing pure
  `ConnectionStatus` readers you'll sit a third beside. `composerAvailability` (94-107) returns the
  **terse** composer hints `'Connecting…' / 'Not connected' / 'Connection error'` — the banner copy
  must read distinctly from these (AC5). `shouldOfferRepair` (127-129) is the exact pattern to mirror:
  a pure, React-free predicate over `ConnectionStatus` co-located in this file. **The docstring at
  90-93 explicitly names this banner as "the connection banner's surface"** — this ticket is the
  anticipated home; the composer hint deliberately does NOT surface `status.error.message`.
- `src/renderer/src/store/sessionStore.ts:15-32` — the `ConnectionStatus` union (4 arms:
  `disconnected | connecting | connected | error`) and `ConnectionError` (28-32). **`ConnectionError.message`
  (line 30) is the daemon-adjacent string the banner must NOT render (AC3).** `selectStatus` at line 170
  is the read seam.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:36-82` — the render tree + mount
  points. **Lines 440-483 (`RepairPrompt` pure view + `RepairControl` container) are the exact shape to
  clone** for `ConnectionBanner` / `ConnectionBannerControl`: a pure view taking `status` that returns
  `null` unless a predicate holds, plus a thin store-bound container. Lines 264-271 (`ThinkingIndicator`)
  are a second precedent for a null-on-absent pure view whose visible label is a client-owned constant.
- `src/renderer/src/screens/conversation/conversation.css:665-733` — the `.modal-rejection` block
  (#249): the established **error-accent banner** idiom on desktop — `border-left: 4px solid
  var(--color-error)` over a `--color-surface-container-high` fill, token-only, no new theme tokens.
  Lines 339-349 (`.composer__hint`) — the **muted** inline caption the banner must read as *more
  prominent* than. Lines 114-122 (`.composer__repair`) — a `flex: 0 0 auto` non-growing conversation strip.
- `src/renderer/src/theme/tokens.css:33` — `--color-error: #ffb4ab` is the **only** error role token
  (no `--color-error-container`). Use it for the accent; confirm token names, don't invent new ones.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-60` — the test idiom:
  `renderToStaticMarkup` server-render, pure views exercised directly with props. **Note lines 15-21:**
  zustand v5's `useStore` reads `getInitialState()` (= `disconnected`) under server render, so a
  store-bound container renders its *disconnected* branch. For the banner, disconnected is a *visible*
  branch — so the container's visible path IS reachable under server render (unlike `RepairControl`,
  whose visible branch needs `error`).
- `src/renderer/src/screens/conversation/composerSend.test.ts` — the pure-predicate test shape for
  `composerAvailability` / `shouldOfferRepair`; add `shouldShowBanner` cases in the same shape.

## Context

The thread today gives no prominent disconnected signal — only the composer's inline hint
(`composerAvailability`) gates the send control with a terse label. Mobile shows a connection-state
banner at the top of the thread, only when not connected. This ticket adds that band: a third,
prominent read of the same `ConnectionStatus` slice.

`composerSend.ts` already reserves this surface — its docstring states the composer hint deliberately
omits `status.error.message` because that is "the connection banner's surface." This ticket builds
that surface. The composer hint stays the terse inline gate; the banner becomes the prominent,
disconnected-only signal. Both remain visible while disconnected.

## The three reads of `ConnectionStatus` — boundary confirmation

The ticket asks the architect to confirm the banner does not duplicate the two other status surfaces.
It is a **third, independent read of one union**, each with a distinct job and a distinct copy register:

| Surface | Scope | Prominence | Copy | Status |
|---|---|---|---|---|
| Composer hint (`composerAvailability`, #31) | inline, gates Send | muted caption | terse: `Connecting…` / `Not connected` / `Connection error` | shipped |
| Two-dot Relay/Pyrycode indicator (#149) | header/settings, **always-on** | compact glyph | none (dots) | separate ticket, not built here |
| **Connection banner (this ticket)** | top-of-thread band, **disconnected-only** | prominent | one client-owned sentence naming the host + consequence | new |

The banner reads the **same `selectStatus` slice** the composer gate already uses — no new store state,
no new wire arm, no touching of #149's surface. The distinctness is enforced by copy (below) and by
`shouldShowBanner` being a *separate* predicate from `composerAvailability`.

## Design

Mirror the `RepairPrompt` / `RepairControl` split exactly. No new files.

### 1. `composerSend.ts` — the predicate + the copy (pure, React-free)

Add, beside `composerAvailability` and `shouldOfferRepair`, so all three `ConnectionStatus` reads live
in one reviewable file:

- **`CONNECTION_BANNER_COPY`** — an exported module-level client-owned string constant. This is the
  banner's *entire* text; it is never derived from `status`, so AC3 ("no daemon-supplied string is
  rendered as the banner text") is a structural guarantee, not a convention (the `EMPTY_THREAD_COPY` /
  `ThinkingIndicator` label idiom). Recommended value:

  > `"Can't reach pyrybox — your messages won't send until the connection is back."`

  Rationale for this exact copy (AC5 — "architect to reconcile the exact copy split"):
  - **Prominent & host-named** — a full sentence naming the target (`pyrybox`) and the consequence
    ("messages won't send"), vs. the composer's bare label.
  - **Lexically distinct** from all three composer hints (leads with "Can't reach", shares no leading
    words with `Connecting…` / `Not connected` / `Connection error`), so the two surfaces never read as
    the same string stacked twice.
  - **Honest across all three non-connected arms** — `disconnected`, `connecting`, and `error` are all
    states where pyry is not reachable, so "Can't reach" and "until the connection is back" read
    correctly for each without a temporal claim (avoids "restored"/"lost", which imply a prior connect).
  - A single constant (not a per-arm map) is deliberate: a second three-way copy split would be the
    duplication AC5 warns against. The composer already carries the per-arm nuance.

  PO/design may tune the wording later — it is a client-owned constant. The load-bearing contract is:
  (a) one client-owned constant, (b) lexically distinct from the three composer hints, (c) zero
  daemon-supplied substring.

- **`shouldShowBanner(status: ConnectionStatus): boolean`** — returns `status.type !== 'connected'`.
  Signature + behavior: true for `disconnected | connecting | error`, false for `connected` (AC1/AC2).

  Design note — why `!== 'connected'` and **not** an exhaustive `switch`/`assertNever`: unlike
  `composerAvailability` (each arm → different copy, so it must enumerate), every non-connected arm maps
  to the *same* behavior (show the banner). Expressing it as "show unless connected" is the honest
  shape, and its fail-mode is correct: a hypothetical future 5th `ConnectionStatus` arm would default to
  *showing* the not-connected banner — the safe direction (over-showing a "not connected" band beats
  silently hiding it). Document this reasoning inline.

### 2. `ConversationScreen.tsx` — the pure view + the container

- **`ConnectionBanner({ status }: { status: ConnectionStatus }): JSX.Element | null`** — exported pure
  view (so tests server-render it with each status, the `RepairPrompt` discipline). Returns `null`
  unless `shouldShowBanner(status)`. When shown, renders a single band element containing
  `CONNECTION_BANNER_COPY` and nothing derived from `status`. Give it `role="status"` (a polite live
  region — consistent with `.composer__hint`'s existing `role="status"`; the banner persists visually,
  so a polite announcement suffices and avoids an assertive double-announce with the composer hint).
  Class `conversation__banner`.

- **`ConnectionBannerControl(): JSX.Element | null`** — in-file store-bound container (not exported).
  Reads `const status = useSessionStore(selectStatus)` and returns `<ConnectionBanner status={status} />`.
  Selecting only the `status` slice means it re-renders exactly when connection status changes and never
  on a timeline delta (AC4 reactivity — the same narrow-slice seam the composer gate uses; no new store
  wiring). No `window.pyry` dereference, no effects — pure read.

- **Mount** — add `<ConnectionBannerControl />` in `ConversationScreen`'s tree **between `<UnpairControl />`
  and `<Timeline items={items} />`** (line 58→59), i.e. below the app-bar header row, above the message
  list — "the top of the thread." One added line.

`ConnectionBanner` imports `CONNECTION_BANNER_COPY` and `shouldShowBanner` from `./composerSend`,
exactly as the screen already imports `composerAvailability` / `shouldOfferRepair` from there.

### 3. `conversation.css` — the band

Add `.conversation__banner`, token-only (every value a theme token; no color/type/spacing literal),
following the `.modal-rejection` (#249) error-accent idiom:

- `flex: 0 0 auto` — never grows or shrinks (the header/composer convention); it pushes the thread down
  rather than overlaying it.
- Fill `var(--color-surface-container-high)`; an error accent via `var(--color-error)` (the only error
  role token — recommend `border-left: 4px solid var(--color-error)` matching `.modal-rejection`, or a
  bottom border; the developer picks the decoration that reads as "prominent band, not a muted caption").
- Text `var(--color-on-surface)`, body-medium type tokens (`--text-body-medium-*`) — a step up in
  prominence from `.composer__hint`'s muted `--color-on-surface-variant` body-**small**.
- Full-width, horizontal padding aligned with the thread (`--space-4`), `margin: 0` on any inner `<p>`.
- No new theme tokens (the `--color-error` accent is reused, per the #230/#249 precedent).

## State + concurrency model

No new state, no async, no store slice, no effect. The banner is a synchronous derived read of the
existing `sessionStore` `status` slice via `selectStatus`. Reactivity (AC4 — appears on drop,
disappears on reconnect, no reload) is inherited from `useSessionStore(selectStatus)`: when #3
dispatches `disconnected` / `connecting` / `connected` / `failed`, the store notifies, the container
re-renders, `shouldShowBanner` re-evaluates, and the band mounts/unmounts. This is the identical
reactive seam the composer gate already relies on — the store→UI reactivity is proven in
`sessionStore.test.ts`; no new reactive test is needed here (the composer gate added none for the same
reason).

## Error handling

None to add. The banner is a passive read; it renders no failure of its own and touches no transport.
It deliberately does **not** surface `status.error.message` (AC3) — the terse composer hint likewise
omits it, and wire-error rejection surfacing is #227's job. The only "error" the banner represents is
the *presence* of a non-connected status, conveyed entirely by the client-owned constant.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. All tests are pure — `renderToStaticMarkup` server-render for
the view, plain function calls for the predicate (no DOM harness, no store mutation), mirroring the
existing `ConversationScreen.test.tsx` / `composerSend.test.ts` idioms.

**`composerSend.test.ts` — `shouldShowBanner` (the AC1/AC2 truth table):**
- `{ type: 'connected', ack }` → `false`.
- `{ type: 'disconnected' }` → `true`.
- `{ type: 'connecting' }` → `true`.
- `{ type: 'error', error }` → `true`.

**`ConversationScreen.test.tsx` — `ConnectionBanner` pure view:**
- Renders the banner (contains `CONNECTION_BANNER_COPY`) for each of `disconnected`, `connecting`,
  `error` (AC1).
- Renders **nothing** (empty markup / no banner class) for `connected` (AC2).
- **AC3 lock:** given `{ type: 'error', error: { code: 'x', message: 'DAEMON_SECRET_DETAIL', retryable: false } }`,
  assert the rendered markup contains `CONNECTION_BANNER_COPY` and does **not** contain
  `'DAEMON_SECRET_DETAIL'` — no daemon-supplied string reaches the banner.
- **AC5 distinctness:** assert `CONNECTION_BANNER_COPY` is not equal to any of the three
  `composerAvailability` hints (`Connecting…` / `Not connected` / `Connection error`). Optionally, a
  full `<ConversationScreen />` server-render (store at initial `disconnected`) asserting both the
  banner copy AND the composer hint `'Not connected'` appear and differ — proving "both remain visible
  while disconnected" in one integration assertion.

## Open questions

- **Exact banner wording** — the recommended constant is a reconciliation call, not a hard requirement;
  PO/design may adjust. The three invariants (single client-owned constant, lexically distinct from the
  composer hints, no daemon substring) are the actual contract and are locked by the tests above.
- **Accent decoration** — `border-left` (matching `.modal-rejection`) vs. a full-width top/bottom
  accent is a visual-language judgment left to the developer within the token set; there is no Figma
  node to match, only the design-doc "prominent band" intent.

## Acceptance criteria (developer deliverables)

- [ ] `shouldShowBanner(status)` and `CONNECTION_BANNER_COPY` added to `composerSend.ts`; predicate is
      `status.type !== 'connected'`.
- [ ] `ConnectionBanner` (exported pure view, `null` unless `shouldShowBanner`) and
      `ConnectionBannerControl` (in-file container reading `selectStatus`) added to
      `ConversationScreen.tsx`; container mounted between `UnpairControl` and `Timeline`.
- [ ] `.conversation__banner` added to `conversation.css`, token-only, reading as prominent (distinct
      from the muted `.composer__hint`).
- [ ] Banner renders while status is `disconnected` / `connecting` / `error`; absent when `connected`.
- [ ] Banner text is `CONNECTION_BANNER_COPY` only; no `status.error.message` (or any daemon string)
      rendered (test-locked).
- [ ] Banner copy is lexically distinct from the three composer hints; both banner and composer hint
      remain visible while disconnected (test-locked).
- [ ] `npm run build` (typecheck + build) and `npm test` green.
