# #409 — Settings Notifications section: push toggle UI

**Size:** S (confirmed; no split). 2 production `.tsx` files (1 new, 1 modified), 1 CSS modify, 1 new test. 2 new exports. Zero call-site fan-out (additive mount). No data path — reads/writes #408's existing merged store.

**Not security-sensitive.** Renders a client-owned label and a boolean control; no keys, sockets, tokens, or wire frames. No security-review pass.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-64

A single-row section: a "Notifications" header (17:62, label-large in `--color-primary`, identical treatment to the existing Connection/Defaults/Storage section headers) above one row (17:64) laid out `flex gap-16 items-center px-16 py-10` — a left text column holding the body-large label "Push notifications when claude responds" (17:66, `--color-on-surface`), and a trailing 52×32 M3 switch (17:67 track / 17:68 knob) **drawn in the on-position** (the enabled default). The switch's on-state tokens read from Figma: track = `Schemes/Primary` (#9dcbfc dark), knob = `Schemes/On Primary` (#003355 dark) — the standard M3 selected-switch treatment. The row geometry is a pixel match for the existing `.settings__storage-row`.

## Files to read first

- `src/renderer/src/store/pushNotificationPrefStore.ts` — **the store this row consumes (already merged, #408).** Read exports: `usePushNotificationPrefStore` (hook), `selectPushNotificationsEnabled` (selector, returns `boolean`), the `pushNotificationPrefStore` singleton, and `setPushNotificationsEnabled(value: boolean)` on its state. Absence-on-empty already resolves to enabled at the store (`PUSH_NOTIFICATIONS_DEFAULT_ENABLED`) — the row reflects whatever boolean it reads; do **not** re-implement a default.
- `src/renderer/src/screens/settings/ArchivedCountRow.tsx:1-50` — **the closest structural precedent**: a pure props-in/markup-out view + a thin store-bound `…Control` that reads a selector and hands the value down. No `useState`, no sheet. This row follows this exact two-part shape (plus one callback prop the ArchivedCountRow doesn't have).
- `src/renderer/src/screens/settings/DefaultWorkspaceRow.tsx:97-138` — the `onChoose` store-write posture: the setter is dereferenced via `pushNotificationPrefStore.getState().setPushNotificationsEnabled(next)` **inside the callback only, never at render**, never two-way-bound. Copy this discipline; ignore its picker-sheet/`useState` machinery (not needed here).
- `src/renderer/src/screens/conversation/RunConfigSections.tsx:227-240` — the nearest accessible-switch markup: `role="switch"` + `aria-checked` + a knob child. **Genuine delta:** that switch is a `<span>` wired only to `onClick`, so Space/Enter do not activate it. #409's keyboard AC requires real Space/Enter operability — use a native `<button role="switch">` (see Design), not a click-only span.
- `src/renderer/src/screens/conversation/conversation.css:1349-1402` — the `run-config__switch` / `--on` / `-knob` styles + the focus-visible ring. **Clone these into `settings.css`** as `.settings__switch*` (see CSS home). The token choices (off: `surface-container-highest` track / `outline` border / `outline` knob at left; on: `primary` track / `surface` knob at right, grown to 24px) are correct M3 and match the Figma dark-theme render; carry them verbatim.
- `src/renderer/src/screens/settings/SettingsScreen.tsx:41-104` — the mount point. Insert the new section between the Defaults `</section>` (line 82) and the Storage section comment (line 83). Add a `notifications: 'Notifications'` key to `SETTINGS_COPY` (lines 10-18) and import the new Control.
- `src/renderer/src/screens/settings/settings.css:87-208` — the section/section-header/section-body + `.settings__storage-row*` blocks. The new row's layout (`.settings__notifications-row*`) mirrors `.settings__storage-row` geometry (gap-16 → `--space-4`; px-16 py-10 → `--space-4` / `--space-3`, the same 2px-delta mapping).
- `src/renderer/src/screens/settings/DefaultWorkspaceRow.test.tsx` / `ArchivedCountRow.test.tsx` — **the test harness idiom**: `renderToStaticMarkup` under the `node` vitest runtime, asserting on the returned string. No DOM-event simulation available. Follow this shape for the reflect matrix.
- `src/renderer/src/theme/tokens.css:16-29` — confirms the tokens the cloned switch uses (`--color-primary` #9dcbfc, `--color-surface`, `--color-outline`, `--color-surface-container-highest`) all exist; **no new token is introduced.** Note `--color-on-primary` does *not* exist — the run-config precedent's `--color-surface` knob is the correct substitute (dark, ≈ the Figma knob #003355), so do not reach for `--color-on-primary-container` (#cfe4ff is a light tone, wrong contrast).

## Context

The Settings screen (#333 scaffold) renders Connection, Defaults, Storage, and About sections. #408 (merged, PR #411) added the persisted push-notification preference store; #392 (renderer trigger) reads it to decide whether to fire a notification. This slice adds the user's **control** over that preference: a "Notifications" section with one toggle row. **It adds no data path** — it reads `selectPushNotificationsEnabled` and writes `setPushNotificationsEnabled` on the existing store.

Out of scope: the Figma section's second row "Notification sound" (17:69) — no client- or daemon-side infrastructure exists; deliberately excluded.

## Design

### Module structure

One new file, `src/renderer/src/screens/settings/PushNotificationRow.tsx`, exporting two components (the `ArchivedCountRow` two-part idiom, plus a callback prop):

**`PushNotificationRowView`** — pure, props-in/markup-out (the tested seam). Props: `{ enabled: boolean; onToggle: (next: boolean) => void }`. Renders the storage-row layout: a text column with the label `<p>`, and a trailing **native `<button role="switch">`** carrying the knob child.

- Copy constant (module-level, the `SERVER_ROW_LABEL` idiom): `PUSH_TOGGLE_LABEL = 'Push notifications when claude responds'` — Figma-verbatim (17:66), lowercase "claude", apostrophe-free (renderToStaticMarkup-safe, the standing desktop lesson).
- The switch is a `<button type="button" role="switch">` (**not** a `<span>`): a native button is focusable and activates its `onClick` on both Space and Enter with no `onKeyDown` handler — this is what satisfies the keyboard AC. `aria-checked={enabled}`; `aria-label={PUSH_TOGGLE_LABEL}` (the switch is a sibling of the label `<p>`, not its parent, and `role="switch"` computes its name from author not contents — so an explicit `aria-label` set to the same copy constant ties the accessible name to the visible label deterministically). `onClick={() => onToggle(!enabled)}`. Class `settings__switch` + `settings__switch--on` when `enabled`. A single `<span className="settings__switch-knob" aria-hidden="true" />` child.

Contract sketch (not the implementation — the developer writes the body in-idiom):

```
export function PushNotificationRowView(props: { enabled: boolean; onToggle: (next: boolean) => void }): JSX.Element
// <div .settings__notifications-row>
//   <div .settings__notifications-row-text><p .settings__notifications-row-label>{PUSH_TOGGLE_LABEL}</p></div>
//   <button type=button role=switch aria-checked={enabled} aria-label={PUSH_TOGGLE_LABEL}
//           className={enabled ? '…switch …switch--on' : '…switch'} onClick={() => onToggle(!enabled)}>
//     <span .settings__switch-knob aria-hidden />
//   </button>
// </div>
```

**`PushNotificationRowControl`** — store-bound container (the `ArchivedCountRowControl` posture). Reads `const enabled = usePushNotificationPrefStore(selectPushNotificationsEnabled)`; renders `<PushNotificationRowView enabled={enabled} onToggle={(next) => pushNotificationPrefStore.getState().setPushNotificationsEnabled(next)} />`. No effects, no `useState`, no `window` deref, no IPC — a pure read plus one interaction-time write. The setter is dereferenced inside the `onToggle` callback (never at render). Because the write goes through the setter (not a two-way binding), unidirectional state is preserved.

### Data flow

```
localStorage ──(#408 store hydrate)──▶ pushNotificationPrefStore ──selectPushNotificationsEnabled──▶ Control ──enabled prop──▶ View (renders on/off)
                                                    ▲                                                                              │
                                                    └────────── setPushNotificationsEnabled(next) ◀── onToggle(!enabled) ◀── button onClick
```

No new store, no bridge, no reducer, no discriminated union — the store already exists and exposes exactly the read selector + single setter this row needs.

### CSS home — clone into `settings.css`

Add to `src/renderer/src/screens/settings/settings.css`:

1. `.settings__notifications-row` + `.settings__notifications-row-text` + `.settings__notifications-row-label` — mirror the `.settings__storage-row*` geometry/typography (gap-16, px-16 py-10 → `--space-4` / `--space-3`; label body-large `--color-on-surface`). Dedicated classes reusing tokens, **not** the storage-row's classes — the `.settings__about-row` / `.settings__storage-row` precedent of keeping each row semantically decoupled.
2. `.settings__switch` / `.settings__switch--on` / `.settings__switch-knob` + focus-visible ring — cloned from `conversation.css:1349-1402`, adapted for a `<button>`:
   - Add a button reset (`appearance: none; margin: 0; padding: 0; font: inherit`) alongside the existing `box-sizing/border/border-radius/background` — follow the `.settings__back` / `.settings__pair-another-row` button-reset idiom already in this file.
   - The switch is **always operable** (no read-only variant here), so `cursor: pointer` and the `:focus-visible` outline are unconditional — drop the run-config `:not([aria-readonly])` guard.
   - Token choices carry over verbatim (off: `--color-surface-container-highest` track / `--color-outline` border / `--color-outline` knob at `left: 8px`, 16px; on: `--color-primary` track+border / `--color-surface` knob at `right: 4px`, 24px). No new token.

**Decision — clone, don't reuse.** Reusing `.run-config__switch` from `conversation.css` would couple `settings.css` to a conversation-screen selector (load-order and semantic coupling). The client-owned-copy idiom (each screen owns its CSS, as `.settings__storage-row` did rather than share the Server row's classes) says clone. The clone is ~35 lines; the coupling it avoids is permanent.

### SettingsScreen mount

In `SettingsScreen.tsx`:
- Add `notifications: 'Notifications'` to the `SETTINGS_COPY` object.
- `import { PushNotificationRowControl } from './PushNotificationRow'`.
- Insert a new `<section className="settings__section">` **between the Defaults `</section>` (line 82) and the Storage section (line 83)**: an `<h2 className="settings__section-header">{SETTINGS_COPY.notifications}</h2>` plus a `<div className="settings__section-body"><PushNotificationRowControl /></div>`. This yields the Figma vertical order Connection → Defaults → **Notifications** → Storage → About (Notifications y=610 above Storage y=910), the placement discipline #404/#351 used. No loader to mount — the row reads the client-owned store directly.

## State + concurrency model

- **Store slice:** `pushNotificationPrefStore` (#408) only. Read via `usePushNotificationPrefStore(selectPushNotificationsEnabled)` (narrow single-boolean slice → the Control re-renders only when the preference changes). Write via the singleton setter inside `onToggle`.
- **No async, no streams, no effects, no cancellation.** Synchronous read + synchronous localStorage-backed write (the store's setter persists then `set`s). Nothing to tear down on screen exit.
- **Unidirectional:** selector-in, setter-on-interaction-out. No two-way binding, no setter call at render.

## Error handling

No new failure modes. There is no network, socket, parse, or permission path in this slice. The store's setter persists through #408's localStorage port, whose failure handling (a `typeof window` guard, no defensive try/catch) is #408's already-shipped, deliberate decision — not re-litigated here. Under `node`/`renderToStaticMarkup` the store hydrates to the enabled default and the write is a no-op; the row still renders correctly.

## Testing strategy

`src/renderer/src/screens/settings/PushNotificationRow.test.tsx` — the `node` + `renderToStaticMarkup` harness (the `ArchivedCountRow.test.tsx` / `DefaultWorkspaceRow.test.tsx` idiom; no DOM-event simulation). Test the **pure `PushNotificationRowView`** with injected props (never the store singleton). Scenarios (bullet-pointed; developer writes the assertions):

- **enabled = true** → markup contains `aria-checked="true"`, `role="switch"`, the label text `Push notifications when claude responds`, and the `settings__switch--on` class.
- **enabled = false** → markup contains `aria-checked="false"`, `role="switch"`, the label text, and does **not** contain `settings__switch--on`.
- **both states** → the label text + `role="switch"` present (the "label names the control" + reflect assertions).
- **keyboard-operability is structural, not event-tested** → assert the switch renders as `<button` with `type="button"` (a native button activates on Space/Enter by construction), not a `<span>`. This is the deterministic proxy for the keyboard AC in a harness that cannot dispatch key events.

**Not tested here (by design):**
- The Control's store-write wiring (`onToggle` → setter) is unreachable under `renderToStaticMarkup` (no click) — reviewed glue, the `DefaultWorkspaceRow` `onChoose` precedent.
- The persist-across-restart round-trip is #408's already-tested responsibility, inherited — not re-tested.

Type coverage: `npm run typecheck` (both sides). Full suite: `npm test`. Build gate: `npm run build`.

## Open questions

None blocking. One judgment call already made: the switch's accessible name uses `aria-label={PUSH_TOGGLE_LABEL}` (same constant as the visible `<p>`) rather than `aria-labelledby` — simpler, DRY via the shared constant, and matches the run-config switch's `aria-label` posture. If review prefers `aria-labelledby` pointing at the label `<p>` id, that is an equivalent, mechanical swap.
