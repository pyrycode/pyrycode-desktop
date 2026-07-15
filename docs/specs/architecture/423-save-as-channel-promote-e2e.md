# 423 — fake e2e: save-as-channel promote (scratch + dedicated branches)

**Ticket:** [#423](https://github.com/pyrycode/pyrycode-desktop/issues/423) · Size **S** · sibling of #451 / #452 (the #422 lifecycle-e2e family)
**Labels:** `enhancement`, `size:s` — **not** `security-sensitive`, no `## Figma` section.

This is a **test-only** ticket: one new Playwright e2e spec, **zero production code**. It rides the two merged
fixtures (`launchPairedApp` #433 / `conversationStateFake` #434) and asserts existing UI. There is no new attack
surface (assertions read DOM text / visibility / counts only) and no new UI (it drives the already-shipped
`SaveAsChannelDialog`, #274/#288, Figma 19:24) — so neither a security-review pass nor a Design source section
applies. Both are intentionally skipped, per the ticket body ("Not UI-visible").

---

## Files to read first

Read the sibling demonstrator in full first — this spec is the same drive shape (seed → `launchPairedApp`
passthrough → one back-nav → dialog drive → assert on the re-listed Channel List), applied to the
Save-as-channel dialog instead of the rename dialog, and split across **two** tests (one per location branch).

- `e2e/conversation-create-rename.spec.ts` (whole, 111 lines) — **the pattern to clone.** The exact skeleton:
  `conversationStateFake({ conversations: [SEED] })` → `launchPairedApp({ buildReplyFrames })` → the one
  back-nav → a dialog drive → assertions scoped to `.channel-list`, plus the `ROUNDTRIP_TIMEOUT_MS` headroom
  const and the secret-hygiene header. Clone all of that; swap the rename-dialog steps for the two save-as
  drives below.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx:234-299` — **the interaction container.** The
  `onSave` branch is the whole design: `scratch` fires `requestPromoteConversation(..., row.cwd)` then
  `onPromoted()` synchronously; `dedicated` (the default) dispatches `createRequested` (→ in-flight, disables
  Save + input + both radios) then `requestCreateChannelFolder`, and the **created-effect** (lines 264-268) does
  the promote with `roundTrip.path` VERBATIM. `<NewFolderData />` is mounted dialog-scoped (line 275) — the
  listener that folds the daemon's reply into the store lives exactly while the dialog is open.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx:98-185` — the pure view: `.save-as-channel-overlay`
  + `.save-as-channel-overlay__scrim`, the two `.save-as-channel__radio` inputs (accessible names "Move to
  dedicated channel folder" / "Keep in scratch"), `.save-as-channel__save` (disabled while blank OR in-flight).
  Confirms the dialog **unmounts on Save** (no manual scrim-close needed, unlike #451's status sheet).
- `src/renderer/src/screens/channels/ChannelList.tsx:63-99` — the mount: `saveRow` state, the
  `<SaveAsChannelDialog>` gated on a non-null row, `onDismiss`/`onPromoted` both `setSaveRow(null)`. The
  save-as flow starts **and ends on the Channel List** (the dialog overlays the list) — so **no back-nav after
  Save**; the re-list re-renders the list underneath.
- `src/renderer/src/screens/channels/ChannelList.tsx:243-281` — `partitionByPromotion` + the two section
  headers: `.channel-list__section-header` reading **"Channels"** (promoted) / **"Recent discussions"**
  (non-promoted). A section with zero rows renders **no header** — the load-bearing assertion seam (see Design).
  `.channel-list__save` (aria-label "Save as channel") renders **only** on Recent-discussion rows (line 342/348).
- `e2e/fixtures/conversationStateFake.ts:83-175` — the shared stateful fake this composes over.
  `promote_conversation` (lines 142-150) flips `is_promoted → true` and sets `name`/`cwd` from the payload, then
  broadcasts `conversation_updated` → the app auto re-lists → the row moves sections. Its `default` arm
  (line 169) returns `[]` for `create_workspace_folder` — **this is the realizability gap** (see Design).
- `e2e/fixtures/launchPairedApp.ts:184-189` — the launch clicks a **strict single** `.channel-list__row-open`
  and lands in that row's thread. Strict → a second clickable seed strict-violates → **exactly one seed per
  launch** (drives the two-test structure).
- `src/main/daemonConnection.ts:718-731` — the inbound `workspace_folder_created` arm: emitted
  **unconditionally on decode** (the `path` is self-sufficient; correlation state gates only the #396
  rejection path). So the spec-local reply needs only a well-formed `workspace_folder_created { path }` frame;
  `in_reply_to` is contract-fidelity, not a functional gate.
- `src/renderer/src/store/newFolderBridge.ts` + `src/renderer/src/store/newFolderStore.ts` — the round-trip
  the dedicated branch drives: `workspaceFolderCreated { path }` → `folderCreated` → store `in-flight → created`
  → the dialog's created-effect promotes. Read to see why answering `create_workspace_folder` is the whole
  unblock for the dedicated leg.
- `src/shared/wire/types.ts:83-84, 732-751` — the wire type union entries `create_workspace_folder` /
  `workspace_folder_created` and `WorkspaceFolderCreatedPayload { path }` (the spec's reply payload). Import
  wire types + the codec by **relative** path from `e2e/` (`../src/...`) — the `@shared` alias is not available
  to e2e, mirroring the sibling specs.

**Lessons / environment (not code — grep/Read won't surface these):** e2e is **not** typechecked by any project
tsconfig; a fresh worktree needs `npm install` before `npm run e2e`; run the built binary via
`./node_modules/.bin/playwright`, never `npx`.

---

## Context

Save-as-channel is the only client flow with two location branches, and neither has any e2e today. The daemon
never registered a `promote_conversation` handler, so the flow silently fails on the real wire
(pyrycode/pyrycode#949) — caught by no test, because the fake daemon answers anything. This spec pins the
**client half** of the contract on the merged fixtures: the app leaves the right frames and the UI reflects the
promotion. The real-wire half lands in the real-daemon actions family and is blocked on the daemon fix — **out
of scope here** (this ticket does not depend on #949).

Both branches end the same way — the seeded row **promotes** and re-renders in the "Channels" section — but they
get there differently:

- **Scratch** ("Keep in scratch"): a single `promote_conversation` carrying the row's existing `cwd`.
- **Dedicated** (the dialog default): a two-verb dance — `create_workspace_folder` → the daemon's
  `workspace_folder_created { path }` reply → `promote_conversation` with that **returned** path (the client
  never templates the path; the preview line is illustrative only, #288).

---

## Design

### The two-test structure (the key decision)

Both branches **promote** the seeded row, and promotion is one-way: once promoted, the row moves to "Channels"
and **loses** the `.channel-list__save` affordance (it's Recent-discussions-only). So one seeded row cannot
drive both branches sequentially. And `launchPairedApp` clicks a **strict single** `.channel-list__row-open`
(`e2e/fixtures/launchPairedApp.ts:189`), so a two-seed single launch strict-violates at launch. Therefore:

> **Two `test()` blocks, each with its own `launchPairedApp` launch and its own single non-promoted seed.**
> Test 1 drives the scratch branch; test 2 drives the dedicated branch. Each is fully isolated (separate app
> instance, separate fake state).

This is the only realizable shape given the strict-single-row launch + one-way promotion. A fresh launch +
pairing costs ~15–60s, so two launches is the whole run cost — acceptable and consistent with the family (each
sibling spec is one launch; this flow's constraints make it two).

### The seed (both tests)

Exactly **one non-promoted** row, so it (a) launches — `.channel-list__row-open` is present on every row, so
`launchPairedApp`'s strict click reaches the thread — and (b) after one back-nav renders the `.channel-list__save`
affordance under "Recent discussions". Fixed literals only (no `Date.now()` / randomness — the fake convention).

```ts
// is_promoted: false → renders under "Recent discussions" with the Save-as affordance, and is the only
// clickable row so launchPairedApp's strict row-open click reaches its thread.
const SEED: ConversationSummary = { id: 'scratch-conversation', name: 'Scratch discussion',
  is_promoted: false, is_archived: false, cwd: '/fake/workspace',
  last_message_ts: FIXED_TS, last_used_at: FIXED_TS }
const ROUNDTRIP_TIMEOUT_MS = 15_000   // headroom over Playwright's 5s default for a cold runner (sibling value)
```

The two tests may reuse this literal (they're isolated) or use per-test names for diagnostic clarity — the
developer's call. The scratch branch reads `SEED.cwd` on promote; the dedicated branch ignores it (promotes with
the returned path).

### The realizability gap + the spec-local wrapper (dedicated branch)

`conversationStateFake` answers `promote_conversation` (broadcast-then-relist) but its `default` arm returns `[]`
for `create_workspace_folder` — so the dedicated branch's create-folder leg would get no
`workspace_folder_created` reply and the round-trip would hang **in-flight** forever (Save stays disabled, the
promote never fires). Only this spec needs that verb answered, so the reply stays **in-spec** — compose/wrap the
shared fake, **not** a fixture change, **no split** (single-consumer test-infra rule). Contract sketch (~12 lines,
a composition seam — the developer writes the body in the fake's idiom):

```ts
// Wrap conversationStateFake so the dedicated branch's create_workspace_folder gets a canonical reply;
// delegate every other verb (list_conversations, promote_conversation, …) to the shared fake untouched.
function promoteFake(seed: ConversationSummary): (inbound: Uint8Array) => Uint8Array[] {
  const stateFake = conversationStateFake({ conversations: [seed] })
  return (inbound) => {
    const env = decodeEnvelope(inbound)                       // peek the verb (double-decode is pure + harmless)
    if (env.type === 'create_workspace_folder') {
      return [encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'workspace_folder_created', ts: FIXED_TS,
        in_reply_to: env.id, payload: { path: DEDICATED_PATH } satisfies WorkspaceFolderCreatedPayload })]
    }
    return stateFake(inbound)                                 // scratch's promote, both tests' list, etc.
  }
}
```

- `decodeEnvelope` / `encodeEnvelope` from `../src/main/transport/codec`; `WorkspaceFolderCreatedPayload` from
  `../src/shared/wire/types` (relative paths — no `@shared` in e2e).
- `in_reply_to: env.id` mirrors the daemon's correlation contract and the `conversationDeletedFrame` precedent;
  the client's success path emits **unconditionally** (`daemonConnection.ts:718-731`), so it is contract-fidelity,
  not a functional requirement.
- `DEDICATED_PATH` is a fixed literal deliberately **distinct** from the dialog's previewed slug
  (`~/pyry-workspace/channels/<slug>/`) — e.g. `'/srv/pyry/workspaces/chan-7fa'`. The divergence is documentary
  (proves the client promotes with the daemon-**returned** path, never the templated preview, #288). It is not
  DOM-asserted (cwd is not surfaced in the list); its correctness is proven structurally — see below.
- Both tests use `promoteFake(SEED)`; in the scratch test the `create_workspace_folder` arm is simply never hit.

### Drive — Test 1: scratch branch

1. `const { page } = await launchPairedApp({ buildReplyFrames: promoteFake(SEED) })` — lands in the seeded
   row's thread.
2. `.conversation__back` click → route `list`. The conversation-list store already holds SEED (listed on the
   connected edge).
3. **Baseline (AC1).** Assert SEED renders under Recent: `.channel-list__section-header` with text "Recent
   discussions" is visible, SEED's title is visible in `.channel-list`, and **no** "Channels" header exists yet
   (`.channel-list__section-header` filtered to "Channels" → count 0).
4. **Open the dialog (AC1).** `.channel-list__save` click → `.save-as-channel` (role dialog) visible.
5. **Choose scratch + Save (AC2).** `page.getByRole('radio', { name: 'Keep in scratch' }).check()` (the two
   radios share `.save-as-channel__radio`, so target by accessible name), then `.save-as-channel__save` click.
   This fires `promote_conversation` with `cwd = SEED.cwd`, synchronously closes the dialog (`onPromoted`),
   and the fake broadcasts `conversation_updated` → the app re-lists.
6. **Assert promotion (AC2).** The dialog is gone and we're still on the list. Assert the row **moved to
   Channels**: `.channel-list__section-header` filtered to "Channels" becomes visible
   (`toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })`), the "Recent discussions" header is gone (count 0), and
   SEED's title is still visible in `.channel-list`.

### Drive — Test 2: dedicated branch

Same launch + back-nav + baseline (steps 1–4) with a fresh launch and single non-promoted seed. Then:

5. **Leave the default + Save (AC3).** The `dedicated` radio is pre-checked (AC1 default) — optionally assert
   `page.getByRole('radio', { name: 'Move to dedicated channel folder' })` is checked, then `.save-as-channel__save`
   click. This dispatches `createRequested` (dialog goes in-flight; input + both radios + Save disabled) and
   sends `create_workspace_folder` → **`promoteFake` answers `workspace_folder_created { path: DEDICATED_PATH }`**
   → the mounted `<NewFolderData />` folds it into the store (`in-flight → created`) → the created-effect fires
   `promote_conversation` with `DEDICATED_PATH` verbatim → `onPromoted()` unmounts the dialog → the fake
   broadcasts `conversation_updated` → the app re-lists.
6. **Assert promotion (AC3).** Identical section-move assertion as test 1 (Channels header appears with
   `ROUNDTRIP_TIMEOUT_MS` headroom; Recent header gone; row title visible).

### Why the section-move assertion is the crisp proof

With exactly one seeded row, the two section headers are mutually exclusive proxies for its promotion state: a
non-promoted row renders **only** the "Recent discussions" header, a promoted row renders **only** the
"Channels" header (a zero-row section renders no header — `ChannelList.tsx:250-278`). So "Channels header appears
AND Recent header disappears AND the row title stays visible" fully captures "the row promoted in place". No
per-section DOM wrapper exists to scope a row under a header, so this header-transition trio is the crispest
available section-membership assertion (the sibling #451 left strict per-section scoping optional for the same
reason). For the **dedicated** branch this trio is also the end-to-end proof that the create-folder leg was
answered: if `promoteFake` did not reply to `create_workspace_folder`, the store would hang in-flight, the
promote would never fire, and the "Channels" header would time out.

---

## State + concurrency model

- **Two launches, two store lifetimes.** Each test gets a fresh app instance → fresh `conversationListStore`,
  `newFolderStore`, and fake held-list. No cross-test bleed; no reseeding within a test.
- **`newFolderStore` lifecycle (dedicated).** The `<NewFolderData />` listener is mounted dialog-scoped, so it's
  live before Save and torn down on the dialog's unmount; the dialog's unmount also dispatches `reset` → the
  singleton store returns to idle. The whole round-trip (createRequested → created → promote → unmount) is one
  in-process hop the section-move assertion auto-waits.
- **Async confirmations, Playwright auto-wait.** Promote and create-folder are fire-and-forget on the wire;
  their effects (broadcast, re-list, created-effect promote) arrive as daemon events. Every assertion/click
  auto-waits — no manual sleeps, no polling. The fake is deterministic (fixed ids/ts, no clock/random), so a
  failure means a real regression, never flake.
- **Teardown** is owned entirely by the `launchPairedApp` fixture (LIFO: app → daemon → forwarder →
  `rm(userDataDir)`), firing on pass and fail, per test. This spec adds nothing.

---

## Error handling / failure modes

- **Dialog never opens** → `.save-as-channel` times out (the `.channel-list__save` affordance regressed or the
  seed rendered promoted). Clear locator-timeout naming the selector.
- **Scratch never promotes** → the "Channels" header assertion times out against the re-listed `.channel-list`;
  `ROUNDTRIP_TIMEOUT_MS` gives a cold runner headroom, a true miss surfaces expected-vs-actual.
- **Dedicated hangs in-flight** → if `promoteFake`'s `create_workspace_folder` arm is missing/wrong, Save stays
  disabled or the promote never fires → the "Channels" header assertion times out. (This is exactly the
  realizability gap the wrapper closes.)
- **`.save-as-channel__radio` ambiguity** — two radios share the class; select by accessible name
  (`getByRole('radio', { name })`), never by class alone (strict-violation).
- **Secret hygiene** (carry the sibling header verbatim): every assertion reads DOM text / visibility / counts
  only; `SEED.name` and `DEDICATED_PATH` are non-secret display literals; the pairing plumbing (synthetic token,
  fake static key) lives in `launchPairedApp` and is never echoed; no failure diagnostic serializes a token,
  key, or plaintext. (`DEDICATED_PATH` is a fixed fake path, not a real filesystem location, and is never
  resolved locally — the #380/#139 opaque-remote-path posture.)

---

## Testing strategy

This spec **is** the test — two end-to-end round-trips against the fake stack (renderer → IPC → main → Noise
wire → decode → render), one per location branch.

- **Runs under `npm run e2e`** — the filename `save-as-channel-promote.spec.ts` does **not** match the Playwright
  config's `real-*` `testIgnore`, so it's in the default suite (AC5).
- **QA gate:** `npm run e2e` green. `npm run build` still typechecks the app, but e2e is outside every tsconfig —
  the spec must simply compile under Playwright's own TS handling (relative imports, no `@shared`).
- **No unit tests, no fakes to write, zero production code (AC4).** `conversationStateFake` (#434) and
  `launchPairedApp` (#433) are the merged infrastructure; the `promoteFake` wrapper is spec-local test infra
  (single consumer), not a fixture. The verb semantics are already unit-covered by #434.

---

## Open questions

- **Reused vs per-test seed name.** The two tests are isolated, so one `SEED` literal works for both; per-test
  names ('Scratch discussion' / 'Dedicated discussion') only aid diagnostics. Developer's call at write time —
  not load-bearing for any assertion.
- **`DEDICATED_PATH` distinctness is documentary.** cwd is not surfaced in the Channel List DOM, so the returned
  path is proven structurally (only the created-effect, reading `roundTrip.path`, fires the dedicated promote) —
  not by a visible assertion. If a future ticket surfaces cwd in the list, tighten the dedicated assertion to
  read it; for now the section-move is the observable proof.
