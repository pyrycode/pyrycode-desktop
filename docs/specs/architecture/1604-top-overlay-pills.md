# #1604 — usage notice and Re-pair move to a Top overlay of pills

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx`
  - `ComposerErrorSlot`: the slot's pure view. Its first arm is the Re-pair button (`shouldOfferRepair`), and `notice` carries the settings error, the stopping banner and, lowest, the usage notice.
  - `ComposerErrorSlotControl`: the container. It reads the usage reading (`selectUsageLimitFor`, now read in unix seconds at render time), owns `handleRepair` (delegating to `onRepairHost`) and builds `notice`.
  - `ComposerUsageLimitNotice`: the usage view that moves out of the slot.
  - `useOpenConnectionStatus`: the open conversation's host connection status, which the new container reuses.
  - `ConversationScreen`'s JSX around `<Timeline>`. The message area is `Timeline`'s `.conversation__thread`, a flex child of `.conversation`. `Timeline` renders `EmptyThread` at zero rows and is skipped when the host is offline with nothing to show.
- `src/renderer/src/screens/conversation/usageLimitNotice.ts`, `usageLimitNotice`: supplies the text and the `exhausted`/`warning` treatment. Its header states the untrusted-string discipline this ticket inherits.
- `src/renderer/src/store/usageLimitStore.ts`, `UsageLimitReading`: `{ status, limitType, resetsAt }`, with daemon-authored open strings.
- `src/renderer/src/screens/conversation/composerSend.ts`: `shouldOfferRepair` (non-retryable `pairing-rejected` only) and `shouldOfferReconnect` (which excludes `pairing-rejected`). With Re-pair gone, `pairing-rejected` reaches the `ComposerErrorChip` arm with no new case. `COMPOSER_REPAIR_BUTTON_COPY` is `Pairing error - Re-pair`.
- `src/renderer/src/store/lastEffortStore.ts`: the small `createStore`, singleton and hook shape that the new store follows.
- `src/renderer/src/PairedShell.tsx`: `ConversationScreen` is mounted with `key={props.paneKey}` and only on the `thread` route, so component state does not survive navigation. The dismissal therefore needs a store, not `useState`.
- `src/renderer/src/screens/conversation/conversation.css`
  - `.conversation`, `.conversation__thread`, `.conversation__empty`: the flex-column layout the overlay sits in.
  - `.composer-status__usage*`: retired with the view.
- `src/renderer/src/theme/*.css`: provides `--color-primary-container`, `--color-on-primary-container`, `--color-error-container`, `--color-error`, `--space-1/2/3`, `--radius-xs` and the body-small type tokens.
- Specs that pin either control in the slot:
  - `ConversationScreen.test.tsx`: the `ComposerErrorSlot` describe, the `ComposerUsageLimitNotice` describe, and the mounted Re-pair container test.
  - `historyRetry.test.tsx` and `mcpFailureNotice.test.tsx`: `onRepair` props.
  - `e2e/composer-usage-limit.spec.ts`, `e2e/unpair-repair.spec.ts`, `e2e/pairing-recovery.spec.ts`, `e2e/host-row-per-server.spec.ts`.
- `docs/knowledge/features/conversation-shell-composer-usage-limit-notice.md` and `conversation-shell-composer-repair-button.md`: prior rulings (untrusted-string discipline, the slot's single-occupant rule).

No in-flight `feature/*` branch touches these files; the check ran on 2026-09-24.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171 (frame "Top overlay" inside it). The pill's Default variant is https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617.

The "Top overlay" is absolutely positioned at the message area's top edge (`left: 0; right: 0; top: 0`). It is a column with `align-items: flex-end`, a 12px gap (`--space-3`) and a `drop-shadow(0 6px 4px rgba(0,0,0,.6))` filter. Each pill hugs its text:
- Padding: 4px 8px (`--space-1` `--space-2`).
- Radius: 6px (`--radius-xs`).
- Gap: 8px.
- Maximum width: the message area.
- Text: body-small, right-aligned.

The Default pill uses a `--color-primary-container` ground and `--color-on-primary-container` ink, and ends in an 8px X glyph. The Error pill uses a `--color-error-container` ground and `--color-error` ink, with no X. Figma places the usage pill ("Nearly at usage limit - 7-day window, resets …") above the Re-pair pill ("Pairing error - Re-pair"). The X is drawn as an inline SVG with `fill="currentColor"`, so it takes the token ink; the Figma asset hardcodes `#CFE4FF`.

## Context

Both controls currently compete for the composer status row's single slot. The usage warning also shows only while connected, and only when nothing else holds the slot. The design moves both into an overlay shared with mobile. No ADR is needed; this is a surface move inside an existing pattern.

## Design

### 1. `usageLimitNotice.ts` (pure helper, additive)

- `UsageLimitNotice` gains `variant: 'default' | 'error'`. The value is decided by **exact equality** of `reading.status` with a module-private `DISMISSIBLE_STATUS = 'allowed_warning'`. It is client-owned and independent of `treatment`: `rejected` gets the exhausted text on an error pill, and an unknown status gets the warning text on an error pill.
- New `isUsageReadingDismissed(reading, dismissed: UsageLimitReading | null): boolean`. It is true only when all three fields are `===`, compared **field by field**, with no concatenation and no key.
- `treatment` and `text` are unchanged, and so is every existing assertion on them. The header comment's "only consumer" line is updated to name the overlay.

### 2. `store/usagePillDismissalStore.ts` (new)

- `createUsagePillDismissalStore()` holds `{ dismissed: UsageLimitReading | null; dismiss(reading): void }`. `dismiss` stores a fresh copy of exactly the three fields. It keeps one remembered triple for the app process: renderer memory, no persistence, no IPC.
- It exports the singleton `usagePillDismissalStore` and the hook `useUsagePillDismissalStore(selector)`.
- A single global triple, not one per conversation, because the reading describes the account's quota. A dismissed identical triple in another conversation is the same fact. Any change to status, limit type or reset time makes the triple unequal, and the pill returns.

### 3. `TopOverlay.tsx` (new), with the pure view `TopOverlay`

```ts
export const USAGE_PILL_DISMISS_LABEL = 'Dismiss usage notice'
export function TopOverlay(props: {
  reading: UsageLimitReading | null
  nowSeconds: number
  dismissed: UsageLimitReading | null
  repair: boolean
  onDismissUsage: (reading: UsageLimitReading) => void
  onRepair: () => void
}): JSX.Element | null
```

- The view returns `null` when there is no usage pill to show (reading null, or dismissed) and `repair` is false. It renders no element and takes no space.
- Otherwise it renders `<div class="conversation__top-overlay">`, containing the usage pill first and then the Re-pair pill.
- The usage pill is a `div.top-overlay-pill` with `--default` or `--error` added by an **explicit two-way conditional** over `variant`, never a template. Inside is a `span.top-overlay-pill__text` holding `notice.text`. Only on `default` does it add `<button type="button" class="top-overlay-pill__dismiss" aria-label={USAGE_PILL_DISMISS_LABEL}>` wrapping an `aria-hidden` inline SVG.
- The Re-pair pill is `<button type="button" class="top-overlay-pill top-overlay-pill--error">`, with the text `COMPOSER_REPAIR_BUTTON_COPY` as the visible name.
- There is no live region. The chip and notice rulings apply: #279's banner already announces connection changes.

### 4. `ConversationScreen.tsx`

- `ComposerErrorSlot` drops its Re-pair arm and its `onRepair` prop. Otherwise the chain is unchanged, so `pairing-rejected` falls through to `ComposerErrorChip`.
- `ComposerErrorSlotControl` drops `onRepairHost`, `handleRepair` and the usage read. `notice` becomes the settings error, then the stopping banner, then `null`.
- `ComposerUsageLimitNotice` is deleted (no consumer). The now-unused `NO_USAGE_LIMIT_READING` moves with the read.
- New unexported container `TopOverlayControl({ onRepairHost })`:
  - Reads the open conversation, `nowSeconds = Math.floor(Date.now() / 1000)`, the usage reading (the existing `selectUsageLimitFor` / `NO_USAGE_LIMIT_READING` seam, moved), `useOpenConnectionStatus()` into `repair = shouldOfferRepair(status)`, and the dismissal store's `dismissed`.
  - Its `onRepair` is the moved `handleRepair`, which resolves the host from the stores at click time.
  - `onDismissUsage` calls `usagePillDismissalStore.getState().dismiss`.
- In `ConversationScreen`'s JSX, the `<Timeline>` render is wrapped in `<div className="conversation__message-area">`, followed by `<TopOverlayControl onRepairHost={onRepairHost} />`. The wrapper is always rendered, so the overlay (Re-pair especially) still shows when an offline host has nothing for `Timeline` to draw.
- The Timeline's `key`, props and scroll-pin wiring are untouched.

### 5. `conversation.css`

- `.conversation__message-area`: `position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column`. It takes over the flexible middle, so `.conversation__thread` and `.conversation__empty` fill it as before.
  - Known side effect: with the Timeline skipped (offline, no rows), the composer now sits at the pane's bottom rather than directly under the notices. The flexible region is empty there, not missing.
- `.conversation__top-overlay`: absolute at top 0, left 0 and right 0, in a column with `align-items: flex-end`, `gap: var(--space-3)` and the Figma drop-shadow filter. It sets `pointer-events: none` so the thread beneath stays scrollable and clickable between pills, and `z-index: 1`.
- `.top-overlay-pill`:
  - Layout: `pointer-events: auto`, flex, `align-items: center`, `gap: var(--space-2)`, `padding: var(--space-1) var(--space-2)`, `border-radius: var(--radius-xs)`, `max-width: 100%`, `box-sizing: border-box`.
  - Text: body-small tokens, `text-align: right`, and `overflow-wrap: anywhere` so it wraps instead of truncating.
  - Button reset for the Re-pair pill: `border: none`, `font: inherit`, `cursor: pointer`. The UA focus ring is not suppressed.
- Variants: `--default` uses the primary-container ground with on-primary-container ink, and `--error` uses the error-container ground with error ink.
- `.top-overlay-pill__text`: `min-width: 0`.
- `.top-overlay-pill__dismiss`:
  - Reset: `border: none`, `background: none`, `padding: 0`, `color: inherit`, `cursor: pointer`.
  - Sizing: `flex: 0 0 auto`, `display: flex`.
  - Glyph: an 8px SVG.
- The `.composer-status__usage*` rules are removed with their view.

## State + concurrency model

- One new zustand slice (`usagePillDismissalStore`). It is written only from the X's click handler and read by `TopOverlayControl` through a narrow selector (`s => s.dismissed`).
- There are no timers, effects or subscriptions beyond the zustand hooks. The zustand hooks clean up on unmount.
- Expiry remains the render-time comparison in `selectUsageLimitFor`.
- The overlay control re-renders on usage, dismissal or connection-status changes. It is a sibling leaf, so the thread does not re-render.

## Error handling

There are no new failure modes. Every function is total. Repair keeps its "no host → no-op" guard. Nothing is logged: the usage-limit header's no-logging rule extends to the variant and the dismissal.

## Testing strategy

- **`usageLimitNotice.test.ts`**:
  - `variant` is `default` for exactly `allowed_warning`, and `error` for `rejected`, `allowed_warning ` (with a trailing space), `ALLOWED_WARNING`, a sentinel, and the empty string.
  - `isUsageReadingDismissed` returns false for `null`, true for an equal triple, and false when any single field differs (`it.each` over the three fields).
- **`usagePillDismissalStore.test.ts`**: the initial value is null; `dismiss` stores the triple, as a copy that is not the same reference.
- **`TopOverlay.test.tsx`**, all via `renderToStaticMarkup`:
  - The empty overlay renders `''` in each of three cases: no reading and no repair; a dismissed reading and no repair; and a dismissed reading while the status has not changed.
  - Default pill: the X button carries the client-owned `aria-label`, the text is the notice text, and the markup contains no error class.
  - Error pill for `rejected` and for an unknown sentinel status: no `<button`. The sentinel `status` and `limitType` never appear in the markup.
  - Re-pair only: an exact button markup.
  - Both pills: the usage pill comes before Re-pair, and both sit inside a single overlay element.
  - A dismissed triple that differs in one field shows the pill again.
- **`ConversationScreen.test.tsx`**:
  - Remove `onRepair` from every slot render.
  - Repoint the Re-pair-arm tests: `pairing-rejected` now renders the chip, and the button-arm class and accessible-name tests use the reconnect arm.
  - Delete the `ComposerUsageLimitNotice` describe, whose coverage moves to `TopOverlay.test.tsx`.
  - The mounted container test with `pairing-rejected` asserts that the Re-pair pill renders inside `.conversation__top-overlay` before `.composer-status`, and that the chip is in the row.
  - The disconnected test still asserts no Re-pair copy.
- **`historyRetry.test.tsx`, `mcpFailureNotice.test.tsx`**: drop `onRepair`.
- **e2e**:
  - `e2e/composer-usage-limit.spec.ts` is rewritten to drive the overlay:
    - The warning appears as a Default pill.
    - Clicking the X hides it.
    - Pushing the same reading again keeps it hidden.
    - A changed reading (a new reset time) brings it back.
    - `rejected` gives an Error pill without an X.
    - `allowed` clears it.
    - At 800x600 the warning pill wraps: its height is greater than one line, and its box stays inside the message area with no horizontal overflow.
  - `e2e/unpair-repair.spec.ts`'s first test expects the chip in the row and the Re-pair pill in the overlay, rather than a 32px row. Its row-geometry assertions for Re-pair move to "row stays 24 with the chip". Its reconnect tests are unchanged.
  - `pairing-recovery.spec.ts` and `host-row-per-server.spec.ts` locate by role and name, so they keep working. Their `.composer-status__error` count assertion in `host-row-per-server` is on a healthy arm, so it is unaffected.

## Open questions

- Does any other spec assert Re-pair's 32px row height or its position in `.composer-status`? This will be resolved by running the touched e2e specs.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/conversation-shell-composer-usage-limit-notice.md` and `conversation-shell-composer-repair-button.md` to record that both now live in the Top overlay, and add the overlay to the conversation-shell topic.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.**
  - `status` and `limitType` are claude-authored and model-influenced, and they reach three new places:
    - `usageLimitNotice`'s `variant`: exact `===` against a module-private constant.
    - `isUsageReadingDismissed`: field-by-field `===`.
    - The dismissal store: held as data.
  - None of the three renders them, interpolates them, logs them or uses them as a key.
  - The overlay's class names are chosen by explicit two-way conditionals over the client-owned `variant`, and its text comes from `usageLimitNotice`'s client constants. The X's accessible name and the Re-pair copy are client constants.
  - No `Record`/`Map` is keyed by a daemon string, which closes the `__proto__`/`constructor` hazard by construction. The `TopOverlay` tests pin sentinel `status`/`limitType` values absent from the markup.
- **[Trust boundaries] SHOULD FIX (Phase B), test only.**
  - A `NaN` `resetsAt` would never compare equal, so a dismissed NaN reading would come straight back. JSON cannot carry `NaN` and the decoder requires a number, so the risk is nuisance-only and needs no production guard.
  - The `isUsageReadingDismissed` tests will still assert the plain `===` behaviour, so a future "normalising" comparison (such as a trim or case fold) reddens.
- **[Tokens] No findings.** No token, key or credential is touched. Repair delegates to the existing `onRepairHost`, whose flow is unchanged.
- **[File / storage] No findings.**
  - The dismissal is renderer memory only: a zustand store with no `localStorage`, IndexedDB or IPC write. The ticket says it need not survive a reload.
  - The stored triple is non-secret display state already present in `usageLimitStore`.
- **[Electron surface] No findings.** No IPC channel, preload API, navigation or window-open behaviour is added. The Re-pair pill calls the same `onRepairHost` prop the slot button called, with the host resolved from the stores at click time (the moved `handleRepair`). There is no new capability.
- **[Crypto] Not applicable.** The change has no randomness, hashing or key material.
- **[Network & I/O] No findings.** No new frames or wire fields. A hostile daemon can re-show a dismissed pill by changing `resets_at` on every frame. That is nuisance-level and bounded by the existing store's replace-on-write, and it is the specified behaviour (a changed reading returns).
- **[Logs] No findings.** Nothing new is logged. `usageLimitNotice`'s no-logging rule extends to the variant and the dismissal, and the plan adds no diagnostic.
- **[Concurrency] No findings.**
  - There are no timers or effects, and zustand hooks unsubscribe on unmount.
  - The X passes the reading rendered at click time. If a newer reading landed in between, the stored triple is the one the operator saw and the new reading still shows, which is the correct direction.
- **[Threat model] No findings.**
  - A hostile daemon choosing `status` picks only between the two client-owned pill variants and the two client-owned leads. It cannot make an error look dismissible except by also sending the benign-warning wording.
  - The overlay covers the thread's top-right corner. It sets `pointer-events: none` except on the pills, and the pills carry only client-owned copy and existing actions. There is nothing for a clickjacking attempt to redirect to.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24

## Revisions

**2026-09-24, during implementation**

- Two more unit specs encoded the old "usage waits in the slot" priority. Both assertions are repointed to the overlay contract: the reading always shows as a pill ahead of `.composer-status` and no longer holds history back.
  - `banner.test.tsx`: the store-bound priority `it.each`.
  - `historyRetry.test.tsx`: its priority chain.
- The describe that pinned the `notice` prop's precedence stays and is retitled. The prop still carries the settings error and the stopping banner.
- Open question resolved: `pairing-recovery.spec.ts` and `host-row-per-server.spec.ts` needed no change. They locate Re-pair by role and name and pass as they are. Only `unpair-repair.spec.ts`'s first test asserted the 32px row. It now asserts that the row keeps its at-rest 24px geometry with the chip, and that the pill sits at the message area's top-right.
