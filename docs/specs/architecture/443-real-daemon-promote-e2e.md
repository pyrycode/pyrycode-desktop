# 443 — real-daemon e2e: save-as-channel promote (`promote_conversation`) over the real wire

**Ticket:** [#443](https://github.com/pyrycode/pyrycode-desktop/issues/443) · Size **S** · split from #430
**Labels:** `enhancement`, `size:s` — **not** `security-sensitive`, no `## Figma` section.

## Design source

N/A — drives already-shipped UI (`SaveAsChannelDialog` #274/#288); asserts existing DOM, changes nothing on screen, so no Figma reference. AC5 (secret hygiene) is a spec-content requirement (assertions read DOM only), **not** the `security-sensitive` review gate — that label is absent, so no security-review pass applies (the #440 / #441 / #452 ruling: the underlying #949 *daemon* verb carries the label, this desktop e2e does not).

This is a **test-only** ticket: one new Playwright e2e spec `e2e/real-daemon-promote.spec.ts`, **zero production code**, **no fixture change**. It is the real-daemon twin of the merged fake-stack spec #423 (`save-as-channel-promote.spec.ts`), keeping only its **scratch** branch and swapping the in-process `conversationStateFake` for the #439 `realDaemon` fixture (a real spawned claude-less `pyry` on #251's content-blind routing relay). It is the **marquee case** of this tier: pyrycode/pyrycode#949 defined the `promote_conversation` type + payload + registry op but registered **no handler**, so save-as-channel answered `unsupported` on the real wire while the entire fake suite stayed green (a fake answers anything). #949 shipped the handler (Option B: it flips `is_promoted` + `name`, ignores the payload `cwd`, and replies `conversation_updated { is_promoted: true }` correlated). This spec pins that fix so the gap can never regress silently.

---

## Files to read first

Codegraph is not initialized for this repo (see the `codegraph-not-initialized` project memory), so this list was built by Read/grep + QMD, not `codegraph_context`. Like its real-daemon siblings this spec captures **no** outbound wire frame (the daemon is a separate process behind the content-blind relay — the fake twin's in-process capture is unavailable) and imports **only** `./fixtures/realDaemon`. Every assertion is DOM text / visibility / count.

- `e2e/real-daemon-workspace.spec.ts` (whole, ~145 lines, #441) — **the closest real-daemon sibling; clone its skeleton.** Take verbatim: the imports (`test, expect, encodePairingPayload` from `./fixtures/realDaemon`), the secret-hygiene header, the pairing drive (paste payload → Pair → wait fingerprint → Confirm), the three timeout constants (`HANDSHAKE_TIMEOUT_MS = 45_000`, `ROUNDTRIP_TIMEOUT_MS = 15_000`, `SPEC_TIMEOUT_MS = 120_000`), and the `.channel-list__save` readiness gate under `HANDSHAKE_TIMEOUT_MS`. **This spec is *simpler* than #441:** there is **no** `.channel-list__row-open` (Save-as lives on the list row, not thread-scoped — see ChannelList below) and **no** picker/create-folder drive.
- `e2e/save-as-channel-promote.spec.ts:102-144` (#423 — **the fake twin's scratch test**) — clone the scratch-branch drive and the section-header assertion shape: the `channelsHeader` / `recentHeader` locator helpers (`.channel-list__section-header` filtered by `hasText`), `getByRole('radio', { name: 'Keep in scratch' }).check()`, `.save-as-channel__save`. **Diverge in two places:** (a) **drop** the `promoteFake` / `decodeEnvelope` / `encodeEnvelope` machinery entirely — the real daemon answers `promote_conversation` itself; (b) **drop** the fake twin's `getByText('<name>')` title check (Name wrinkle / assertion note below).
- `e2e/real-daemon-conversation-lifecycle.spec.ts` (whole, #440) — a second real-daemon reference for the pairing block, the `test.use({ spawnClaude: false, seedPromoted: … })` fixture usage, and the **name-less "Untitled" seed** handling (its comment at :34-39 documents the affordance-not-title scoping this spec's assertion also relies on).
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx:151-162` — the "Keep in scratch" radio (accessible name `Keep in scratch`, no preview span); `:173-181` — the `.save-as-channel__save` button (disabled only while name blank OR in-flight); `:248` — `name` seeded from `titleFor(row.name)` on mount; `:287-295` — the **scratch `onSave` arm**: `requestPromoteConversation(sendCommand, row.id, name, row.cwd)` then `onPromoted()` — it sends `promote_conversation` **alone** and **never touches the list store** (the no-optimism proof; the dedicated arm's `createRequested` path is never entered).
- `src/renderer/src/screens/channels/ChannelList.tsx:72, 80-87` — `onSaveAsChannel={(row) => setSaveRow(row)}` and `{saveRow && <SaveAsChannelDialog row={saveRow} …/>}`: clicking `.channel-list__save` mounts the dialog with the **clicked list row directly**, so **no `activeConversation`, no thread-open is needed**. `:244-266` — the section headers are **conditionally rendered** (`channels.length > 0 && … "Channels"`; `discussions.length > 0 && … "Recent discussions"`), so a zero-row section renders **no** header → with exactly one seed the two headers are mutually exclusive. A `seedPromoted:false` seed renders `.channel-list__save` under "Recent discussions".
- `src/renderer/src/screens/channels/channelListViewModel.ts:16-19` — `titleFor(null) → UNNAMED_LABEL = 'Untitled'` (non-blank), which is why Save is enabled with **no** typing on the name-less seed.
- `src/main/daemonConnection.ts:741` — the wire `conversation_updated` decodes to a `conversationUpdated` event emitted **by type** (`in_reply_to`-agnostic; the comment calls it an "unsolicited broadcast", but the #949 daemon correlates it — the decode does not care). `src/renderer/src/store/conversationListBridge.ts:47-48` — `shouldRefreshList` returns `true` for `conversationUpdated`, re-requesting `list_conversations`; `:84` — the refresh fires on every such event. This is the reply-gated re-list path that moves the row (the same path #440's archive/restore live-passed on the real daemon).
- `e2e/fixtures/realDaemon.ts:86-92, 111` — the `spawnClaude` / `seedPromoted` option fixtures (both additive; `seedPromoted:false` default = a non-promoted "Recent discussion" seed). `:430-448` — `seedRegistry` writes the single bound conversation with `is_promoted:<seedPromoted>` and **no `name` field** (renders "Untitled"). **Confirm: no fixture change needed.**
- `playwright.config.ts` (`testIgnore: /real-.*\.spec\.ts$/`) + `playwright.real-claude.config.ts` (`testMatch: /real-.*\.spec\.ts$/`, `timeout: 300_000`) + `package.json` (`e2e` / `e2e:real-claude` scripts) — the filename **must** start with `real-` so the default `npm run e2e` ignores it and `npm run e2e:real-claude` selects it (AC4).

**Lessons / environment (grep/Read won't surface these):** e2e is **not** typechecked by any project tsconfig; a fresh worktree needs `npm install` before `npm run e2e:real-claude`; run the built binary via `./node_modules/.bin/playwright`, never `npx`. This spec imports **only** from `./fixtures/realDaemon`, so the "`@shared` unavailable in e2e" hazard does not bite (no `../src/...` wire-type imports — unlike the fake twin, which imported `codec` + wire types to build the create-folder reply).

---

## Context

Tier-2 real-daemon UI e2e for the one verb this tier exists to catch. Save-as-channel promotes a Recent discussion into a saved Channel; on the fake stack (#423) this is green in two branches, but a fake cannot expose a daemon that declares the verb yet registers no handler — pyrycode/pyrycode#949's exact shape, the reason a real daemon is required here.

**Scope: scratch branch only — drop the dedicated ("Move to dedicated channel folder") branch.** The dedicated branch first sends `create_workspace_folder`, which is **already real-wire-proven** by sibling #441 (the workspace-picker create-folder round-trip), and under #949's Option B the daemon **ignores** the promote payload `cwd` entirely — so the dedicated leg's "promote with the daemon-returned path" contract has **no real-wire DOM surface** here; its correctness is a client concern covered by the fake twin #423. The dedicated branch would also **couple two verbs** (a failure could not be attributed to the promote handler) and cost a second ~180s claude-less launch for redundant coverage. Scratch sends `promote_conversation` **alone**, isolating the #949 gap cleanly. (Same rescope shape as #441 dropping change-workspace.)

**Why it is provable on this tier.** The claude-less real-daemon tier has one observable — the DOM (it captures no outbound frame). A verb is provable here only if its daemon reply gates a **visible DOM transition with no optimistic pre-render**. Promote qualifies: the scratch `onSave` arm dispatches `promote_conversation` and closes the dialog — it **never touches the list store** (`SaveAsChannelDialog.tsx:287-295`). The seeded row moves "Recent discussions" → "Channels" **only after** the daemon's reply drives the re-list:

```
promote_conversation → daemon conversation_updated { is_promoted: true }
  → daemonConnection decodes conversationUpdated (:741)
  → conversationListBridge.shouldRefreshList = true (:47-48) → re-list_conversations
  → partitionByPromotion re-buckets the row by is_promoted → it renders under "Channels"
```

Nothing moves the row optimistically. On a **pre-#949 binary** the daemon answers `unsupported`: no `conversation_updated` fires, no re-list happens, the row stays in "Recent discussions", and the "Channels appears / Recent disappears" assertion **times out**. That timeout **is** the intended loud regression signal — never something to paper over with a longer timeout or a softened assertion. (This is the same `conversation_updated` → re-list path #440's archive/restore already live-passed against the real daemon — strong precedent it works claude-lessly.)

---

## Design

One new file: `e2e/real-daemon-promote.spec.ts`. **No production code, no fixture change.** Imports `test, expect, encodePairingPayload` from `./fixtures/realDaemon` (nothing else). Filename starts with `real-` (AC4).

### Fixture selection + timeouts (contract)

- `test.use({ spawnClaude: false, seedPromoted: false })` — claude-less (gates on the `pyry` binary **alone**; no `claude`, no Anthropic credential — AC4); the single seed is a **non-promoted** Recent discussion carrying `.channel-list__save`.
- `HANDSHAKE_TIMEOUT_MS = 45_000` — readiness gate: async relay registration + a handshake re-dial or two.
- `ROUNDTRIP_TIMEOUT_MS = 15_000` — the promote real-wire round-trip (AC3: ≥ the siblings' value, **not** Playwright's 5s default).
- `SPEC_TIMEOUT_MS = 120_000` — handshake + one round-trip + dialog open + headroom; well under the config's 300s default. Set via `test.setTimeout(SPEC_TIMEOUT_MS)` at the top of the test.

### Drive (single `test`, one launch — sequence + selectors)

Clone the #441 pairing block verbatim, then:

1. **Pair against the real daemon.** Build the payload with `relay: `${relay.url}/v1/client``, fill `textarea[aria-label="Pairing code"]`, click `Pair` (exact), wait `[aria-label="Server key fingerprint"]`, click `Confirm` (exact).
2. **Readiness gate.** `await expect(page.locator('.channel-list__save')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })`. The non-promoted seed's save affordance renders only after handshake → session `connected` → the auto-fired `list_conversations` returned the seeded discussion into "Recent discussions". The real-daemon path lands on `route='list'`, so this stands in for the fake twin's land-in-thread + back-nav.
3. **Baseline (optional but recommended, mirrors #423).** `await expect(recentHeader(page)).toBeVisible()` and `await expect(channelsHeader(page)).toHaveCount(0)` — pins that the seed starts under "Recent discussions" with no "Channels" section, so the post-Save assertion proves a *transition*, not a pre-existing state. (`recentHeader` / `channelsHeader` are the `.channel-list__section-header` `hasText` helpers cloned from #423:108-111.)
4. **Open the Save-as-channel dialog.** `await page.locator('.channel-list__save').click()` (exactly one non-promoted row → unique) → `await expect(page.locator('.save-as-channel')).toBeVisible()`. This mounts `SaveAsChannelDialog` with the clicked list row (`setSaveRow(row)`); its Name field auto-seeds to `titleFor(null) = "Untitled"` (non-blank → Save enabled — see the Name wrinkle).
5. **Choose scratch + Save.** `await page.getByRole('radio', { name: 'Keep in scratch' }).check()` (default is `dedicated`; the two radios share `.save-as-channel__radio` so target by accessible name), then `await page.locator('.save-as-channel__save').click()`. The scratch arm fires `promote_conversation { conversation_id, name: "Untitled", cwd: seedCwd }` and closes the dialog — no round-trip store, no optimistic list mutation.
6. **Assert the reply-gated promotion (AC3).** The row moves only after the daemon's `conversation_updated` drives the re-list:
   ```
   await expect(channelsHeader(page)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
   await expect(recentHeader(page)).toHaveCount(0)
   ```
   A pre-#949 binary answers `unsupported`, no re-list fires, the row stays in "Recent discussions", and `channelsHeader` never appears → this times out (the intended regression signal).

### Assertion = the #423 section-header trio MINUS the title-text check

With exactly one seeded row, a non-promoted row renders **only** the "Recent discussions" header and a promoted row renders **only** the "Channels" header (a zero-row section renders no header — `ChannelList.tsx:250, 264`). So "Channels appears AND Recent disappears" fully captures "the row promoted in place." **Drop** the fake twin's `getByText('<name>')` check: the name-less "Untitled" is neither unique nor meaningful, and `partitionByPromotion` keys on `is_promoted` (title-independent), so the two mutually-exclusive headers are the sound proxy. (`hasText` is a substring match, but "Recent discussions" does not contain "Channels" nor vice versa, so each locator resolves only its own header.)

---

## State + concurrency model

- **No production state change; no new fixture state.** The #439 `seedRegistry` already binds one non-promoted conversation; this spec adds only a test file.
- **One launch, one store lifetime.** A single promote round-trip against the app-singleton stores (conversation-list; the dialog's own `newFolderStore` is never engaged on the scratch arm) — no reseed, no relaunch.
- **Async confirmation, Playwright auto-wait.** The promote round-trip traverses renderer → preload → main → Noise → relay → real daemon and back, so the store update arrives after the Save click resolves. Each assertion auto-waits with `ROUNDTRIP_TIMEOUT_MS` (or `HANDSHAKE_TIMEOUT_MS` for the readiness gate) headroom — no manual sleeps, no `expect.poll` (nothing in-process to poll; all observables are DOM).
- **Teardown** is owned entirely by the `realDaemon` fixture chain (LIFO: page → daemon subprocess group → relay, plus `rm(userDataDir)` / `rm(daemonHome)`), firing on setup failure, test failure, and success. This spec adds nothing.

---

## Error handling / failure modes

- **Missing / broken `promote_conversation` handler (a pre-#949 binary)** → the daemon answers `unsupported`, no `conversation_updated` fires, `shouldRefreshList` never triggers, the row stays under "Recent discussions"; step 6's `channelsHeader` visibility assertion times out. `ROUNDTRIP_TIMEOUT_MS` gives a cold runner headroom; a true miss is **the #949-class regression this spec exists to catch** — that is the intended signal, not a flake to widen the timeout around.
- **Name-less seed rejected by the handler (should not occur)** → the #949 handler requires a non-empty name and enforces promoted-name uniqueness; `"Untitled"` is non-empty and the seed is the sole conversation, so uniqueness passes. If the daemon ever rejects it, the promote yields no `conversation_updated` and step 6 times out — treat as a handler regression, not a flaky timeout.
- **Save affordance absent (readiness/list regression)** → step 2's `.channel-list__save` visibility assertion fails at `HANDSHAKE_TIMEOUT_MS` with a clear "not found" signal, before the promote drive — the explicit guard that the seed listed as a non-promoted Recent row.
- **Skip-clean (AC4).** On a machine without `pyry`, the `realDaemon` daemon fixture calls `testInfo.skip` **before** creating any resource — an unrun test, never a hard failure. No `claude`, no credential required in `spawnClaude:false` mode.
- **Secret hygiene (AC5, carry the sibling header verbatim).** Every assertion reads DOM text / visibility / counts only. The pairing payload is built exactly as the sibling real-daemon specs build it and is never echoed into a message; the transport is content-free by construction (#62). No failure diagnostic serialises the pairing token, keys, or a transcript; the promoted `name` ("Untitled") is a non-secret display literal.

---

## Testing strategy

This spec **is** the test — one end-to-end scratch-promote drive against the real daemon.

- **Runs under `npm run e2e:real-claude`** (`playwright.real-claude.config.ts`, `testMatch: /real-.*\.spec\.ts$/`, 300s per-test timeout) and is **excluded from `npm run e2e`** by the default config's `testIgnore: /real-.*\.spec\.ts$/` (AC4) — purely by the `real-` filename prefix, which cannot be forgotten the way a per-test tag can.
- **QA / salvage gate:** `npm run build` (typecheck + build) is part of `e2e:real-claude`; e2e is outside every tsconfig, so the spec must compile under Playwright's own TS handling (only `./fixtures/realDaemon` is imported — no `@shared`, no relative `../src/...`).
- **No unit tests, no fakes to write.** The dialog / bridges / partition are already unit-covered (#274 / #288 / list-bridge tests); the `realDaemon` harness is #439; the daemon handler is proven daemon-side (pyrycode/pyrycode#949). This spec proves the verb traverses the *real wire* end-to-end.

---

## Open questions

Both resolved before writing (the #440/#441 discipline — resolved, not deferred; no fallbacks pre-built). Documented so the developer understands *why* the assertions take their shape.

- **The name-less seed — does Save enable and does the daemon accept the promote?** **Resolved: yes on both.** `seedRegistry` writes **no `name`** (`realDaemon.ts:430-448`), so the row renders `titleFor(null) = "Untitled"`. `SaveAsChannelDialog` seeds its Name field from `titleFor(row.name)` (`:248`) = `"Untitled"` — non-blank, so Save is enabled and the scratch arm sends `name: "Untitled"`; **no name needs to be typed.** The #949 handler accepts it (non-empty, and it is the sole conversation so the promoted-name-uniqueness check passes). Do **not** assume a pre-named seed, and do **not** type into the Name field.
- **Is the promote reply-gated with no optimistic pre-render (the whole provability premise)?** **Resolved: yes.** The scratch `onSave` arm (`SaveAsChannelDialog.tsx:287-295`) calls `requestPromoteConversation` + `onPromoted()` (closes the dialog) and **never touches the list store**; the row re-buckets only when the daemon's `conversation_updated` decodes to `conversationUpdated` (`daemonConnection.ts:741`) and `shouldRefreshList` (`conversationListBridge.ts:47-48`) re-lists. This is the exact path #440's archive/restore live-passed against the real daemon, so the "Channels appears / Recent disappears" assertion is a sound, non-optimistic proxy for a real-wire promote — and its timeout on a pre-#949 binary is the intended regression signal.
