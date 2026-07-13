# #351 — Settings Storage section: archived conversations count

A "Storage" section on the Settings screen with a single read-only row that shows how
many conversations are archived, derived live from the existing `conversationListStore`.
No new store, no new wire message, no navigation.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-93

A "Storage" section header (node 17:91 → text 17:92, y=910) followed by one row
(node 17:93, y=950): a left text column with a body-large `--color-on-surface` primary
line "Archived conversations" (17:95) and a body-small `--color-on-surface-variant`
secondary line "11 archived" (17:96). The row structurally mirrors the existing Server
row — same `px-16 py-10` padding, same two-line text column. In the full mobile design
the row carries a trailing 20px nav chevron (17:97); **omit it** — same call the Server
row made for its chevron (17:16), since desktop has no archive screen to navigate to yet
(that lands in #347).

**Section order:** In Figma the Storage section (y=910) sits *above* About (y=1056). The
desktop Settings screen today renders only Connection → About (the intervening mobile
sections aren't built), so insert the new Storage section **between** Connection and
About to preserve the design's relative vertical order.

## Files to read first

- `src/renderer/src/screens/settings/SettingsScreen.tsx` — the composition point; copy the
  Connection/About `<section>` pattern (header `<h2 className="settings__section-header">` +
  `<div className="settings__section-body">`). This is where the Storage section is inserted.
- `src/renderer/src/screens/settings/ServerRow.tsx` — **the template for this row**: pure
  view (`ServerRow({ serverInfo })`) + store-bound container (`ServerRowControl`) reading the
  store's own selector. Copy this two-part shape exactly; own the row's copy strings as
  module constants (`SERVER_ROW_LABEL` idiom).
- `src/renderer/src/screens/settings/settings.css:105-182` — the `.settings__section-body`,
  `.settings__server-row*`, and `.settings__about-row*` rules. Mirror the Server row's
  padding/type into new `.settings__storage-row*` classes; every value is an existing token.
- `src/renderer/src/store/conversationListStore.ts:36-64` — the store, `selectConversations`,
  and the documented `conversations: null` = "not yet loaded" vs `[]` = loaded-zero
  distinction that AC4 depends on. The new selector is added here.
- `src/renderer/src/store/conversationListBridge.ts:44-129` — evidence the store is kept
  **live**: `ConversationListData` (mounted app-level, App.tsx:113) requests the list on
  connect and re-requests on every `conversationUpdated` broadcast (incl. archive/restore).
  You add nothing here — read it to confirm AC2's "reflects latest state" is already free.
- `src/shared/wire/types.ts:507-518` — `ConversationSummary.is_archived: boolean` (a value,
  not an absence). This is the flag the selector counts.
- `src/renderer/src/screens/settings/SettingsScreen.test.tsx` — the `renderToStaticMarkup`
  test idiom and the existing Server-row loading-branch assertion (lines 29-40) you extend.
- `src/renderer/src/store/conversationListStore.test.ts` — the store's `ConversationSummary`
  fixture idiom and selector-test shape to follow for the new selector's cases.

## Context

Ticket split from #151. Mobile's Settings "Storage" section leads with a live archived
count. Desktop already holds the data: `conversationListStore` mirrors the daemon's full
conversation list verbatim (snake_case `ConversationSummary` rows), each carrying
`is_archived`. The list is kept live by the app-level `ConversationListData` bridge
(requested on connect, re-listed on `conversationUpdated`). So the archived count is a
pure derived read of existing renderer state — the whole ticket is a selector + a row +
a section header. The archive *screen* (browse/restore) is #153/#347; this is the count
readout only.

## Design

### 1. Derived selector — `conversationListStore.ts` (MOD, ~4 lines)

Add one pure selector alongside `selectConversations`, keeping the store the single owner
of its read surface:

```ts
export const selectArchivedCount = (s: ConversationListState): number | null =>
  s.conversations === null ? null : s.conversations.filter((c) => c.is_archived).length
```

- **`null` passthrough is load-bearing (AC4):** `conversations === null` (not-loaded) →
  `null`; a received `[]` → `0` (loaded, zero archived). The two are distinct, exactly as
  the store's own doc comment promises.
- **Primitive return = narrow re-render seam:** the selector yields `number | null`, so
  zustand's `Object.is` equality re-renders the row **only when the count changes** — a
  list replacement that leaves the archived count unchanged does not re-render it. This is
  strictly better than selecting the whole array and counting in the component, and it
  keeps the derivation a pure, independently-unit-testable function.

### 2. The row — `ArchivedCountRow.tsx` (NEW, ~40 lines)

Follow the `ServerRow.tsx` two-part shape verbatim — a pure view + a store-bound container:

- **`ArchivedCountRow({ archivedCount }: { archivedCount: number | null }): JSX.Element`**
  — pure, props-in/markup-out. Renders the label line "Archived conversations" always;
  the secondary line is the placeholder when `archivedCount === null`, else the count
  string. Structure mirrors `.settings__server-row` → text column → two `<p>` lines. No
  trailing icon.
- **`ArchivedCountRowControl(): JSX.Element`** — reads
  `useConversationListStore(selectArchivedCount)` and hands the value to the pure view. No
  effects, no `window.pyry`, no IPC — a pure read (the `ServerRowControl` posture).

Own the copy as module constants (the `SERVER_ROW_LABEL` idiom), never daemon strings:

- `ARCHIVED_ROW_LABEL = 'Archived conversations'`
- `ARCHIVED_ROW_PLACEHOLDER = '—'` (U+2014 em dash — the neutral "not yet loaded" line;
  apostrophe-free, so `renderToStaticMarkup` leaves it untouched)
- Count string: **`` `${archivedCount} archived` ``** — see the pluralization note below.

**Pluralization (AC3) — invariant, do NOT branch.** The AC's concrete examples are
"0 archived", "1 archived", "2 archived" and the Figma reads "11 archived". "archived"
here is a past-participle state, not a countable noun, so it does **not** pluralize across
counts. The format is uniformly `` `${count} archived` `` for every count including 0 and
1. Do **not** introduce `Intl.PluralRules`, a singular/plural branch, or a "conversation(s)"
noun — that would contradict the examples. The only conditional is null → placeholder.

### 3. Section wiring — `SettingsScreen.tsx` (MOD, ~10 lines)

- Add `storage: 'Storage'` to the `SETTINGS_COPY` constant.
- Import `ArchivedCountRowControl` from `./ArchivedCountRow`.
- Insert a new `<section className="settings__section">` **before** the existing About
  section (see Design source → Section order), matching the Connection section's markup:

```tsx
<section className="settings__section">
  <h2 className="settings__section-header">{SETTINGS_COPY.storage}</h2>
  <div className="settings__section-body">
    <ArchivedCountRowControl />
  </div>
</section>
```

No loader to mount (unlike #334's `ServerInfoData`): the conversation list is already kept
live app-level, so the container is a pure read. `SettingsScreen` stays server-renderable —
the container's store read resolves to the initial `null` under server render (see Testing).

### 4. Styling — `settings.css` (MOD, ~4 rules, no new tokens — AC5)

Add dedicated `.settings__storage-row*` classes that mirror the Server row's geometry and
type, referencing only existing tokens (the `.settings__about-row` precedent of a dedicated,
semantically-decoupled class that reuses tokens rather than reusing the Server row's classes):

- `.settings__storage-row` — row padding `var(--space-3) var(--space-4)` (the `px-16 py-10`
  → `--space-4` / `--space-3` mapping the Server and About rows already use).
- `.settings__storage-row-text` — `flex-direction: column; gap: 2px; min-width: 0`
  (structural geometry, the Server-row text-column convention).
- `.settings__storage-row-label` — body-large / `--color-on-surface` (mirrors
  `.settings__server-row-label`).
- `.settings__storage-row-count` — body-small / `--color-on-surface-variant` /
  `overflow-wrap: anywhere` (mirrors `.settings__server-row-id`).

The "Storage" header needs **no new CSS** — reuse the existing `.settings__section-header`
class (label-large, `--color-primary`) exactly as Connection/About do.

## State + concurrency model

- **Store slice:** reads the existing `conversationListStore.conversations` slice through the
  new `selectArchivedCount`. No new store, no new state.
- **No async, no subscription, no teardown:** the container is a synchronous store read with
  no effects. The list is fed by the already-mounted app-level `ConversationListData`; this
  ticket adds no data path. AC2 ("reflects the latest store state after an archive/restore
  re-list, not a mount-time snapshot") is satisfied for free — the selector reads current
  store state on every render, and `conversationUpdated` (archive/restore) triggers a
  re-list that flows through `setConversations` → new count → row re-render.
- **Unidirectional:** read-only selector; the row never writes the store. Settings mounts
  paired-only; unmounting leaves nothing to clean up.

## Error handling

No failure modes in this slice — it is a pure derivation over in-memory renderer state. The
only non-value state is `conversations === null` (list not yet loaded), surfaced as the
neutral "—" placeholder (AC4), never as a spurious "0 archived". No network, parse, socket,
or permission path is touched; nothing to surface as a banner or dialog.

## Testing strategy

Unit tests only (`npm test`, vitest); `npm run typecheck` covers the type-level contracts.

- **`conversationListStore.test.ts` (MOD)** — pure `selectArchivedCount` cases over
  `ConversationListState`, using the file's existing `ConversationSummary` fixture idiom:
  - `conversations: null` → `null` (not-loaded; the AC4 boundary).
  - `[]` → `0` (loaded, zero archived — distinct from null).
  - one row `is_archived: false` → `0`.
  - one row `is_archived: true` → `1`.
  - a mix (e.g. 2 archived among 5) → `2`.
- **`ArchivedCountRow.test.tsx` (NEW)** — server-render the pure view with injected
  `archivedCount` (the `ServerRow`/#218 idiom); no store, no DOM harness:
  - `null` → contains the "—" placeholder and the "Archived conversations" label; does
    **not** contain " archived" (proves the placeholder replaces the count, not "0 archived").
  - `0` → contains "0 archived".
  - `1` → contains "1 archived" (invariant word — proves no singular/plural branch).
  - `5` → contains "5 archived".
- **`SettingsScreen.test.tsx` (MOD)** — extend the existing server-render assertions:
  - contains `>Storage</h2>` (AC1).
  - the zustand-v5 server-render gotcha (per the Server-row test at lines 29-40): under
    `renderToStaticMarkup` the container reads the store's **initial** `null` state, so the
    row shows its placeholder. Assert the markup contains "Archived conversations" and the
    "—" placeholder, and does **not** contain "0 archived" (a seeded/loaded value can't
    reach a server-rendered container). The populated count paths are proven on the pure
    view above, not here.

## Open questions

None blocking. Two decisions recorded so they aren't re-litigated in implementation:

1. **Trailing nav chevron (Figma 17:97) omitted.** No archive screen is wired yet; the tap
   target lands with #347. This matches the Server row's omission of its own chevron (17:16).
2. **Selector lives in the store, not the component.** Chosen for the narrow-re-render seam
   (primitive equality) and pure-function testability, consistent with the store already
   owning `selectConversations` as its documented read surface.
