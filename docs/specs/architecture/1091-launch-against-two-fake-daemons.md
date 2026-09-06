# 1091 — launch the paired app against more than one fake daemon

Ticket: [#1091](https://github.com/pyrycode/pyrycode-desktop/issues/1091) · size `s` · `security-sensitive`

## Files read

- `e2e/fixtures/launchPairedApp.ts` → `test` (the factory fixture), `PairedApp`, `LaunchControl`,
  `LaunchPairedAppOptions`, `SEEDED_ROW`, `seedConversationsFrame`, `encodePairingPayload`,
  `DUMMY_TOKEN` — the whole surface this ticket extends; its LIFO teardown drain and its
  "start the fake before the launch" ordering are both load-bearing below.
- `e2e/fixtures/pairingArrival.ts` → `pairFromUnpairedLaunch` — the shared arrival step. Its three
  invariants (import only `@playwright/test`; never assert on / log / interpolate the payload; end at
  Confirm) bind the second entry point this ticket adds.
- `e2e/paired-shell-navigation.spec.ts` → its `Settings` and `Pair another server` clicks and its
  `section[aria-label="Conversations"]` / `section[aria-label="Settings screen"]` locators — the
  already-driven navigation the second pairing's entry reuses verbatim.
- `src/main/serverRouter.ts` → `createServerRouter`, its `resolve` — **the finding that shapes this
  plan**: an absent `serverId` resolves only through `soleConnection()`, so with two servers held it
  refuses `ambiguous-server`.
- `src/renderer/src/store/conversationListBridge.ts` → `requestConversationList`,
  `ConversationListData`, `subscribeConversations`, `originOf` — the renderer's list request is bare
  (no `serverId`) and fires on the app-wide `connected` rising edge only.
- `src/renderer/src/store/conversationListStore.ts` → `flattenByServer`, `compareOrigins`,
  `setConversations` — how two servers' rows concatenate, in which order, and that a write replaces
  exactly one server's slot.
- `src/main/daemonConnection.ts` → its inbound `conversations` arm — emitted on the inner frame's
  `type`, with no correlation-id match, which is what makes a server-initiated push land as rows.
- `src/main/transport/fakeDaemon.ts` → `startFakeDaemon`, `FakeDaemon.pushFrame`,
  `FakeDaemon.whenSettled`, its `DaemonState` — `pushFrame` is a no-op outside `transport`, and
  `whenSettled` resolves only on a first *reply*, never on the handshake alone.
- `src/main/transport/fakeRelayForwarder.ts` → `FakeRelayForwarder`, `whenReady`, `closeClientLeg` —
  one client leg and one server leg per forwarder, so one forwarder per daemon.
- `src/main/connectionRegistry.ts` → `runReconcile`, `soleConnection`, `Entry` — one connection per
  stored record; a fresh record is adopted and dialled without a relaunch.
- `src/main/pairedServerStore.ts` → `save`, `decodeCollection` — `save` adds to the collection keyed
  by `server`, and a repeated id makes the whole collection malformed (so the two ids must differ).
- `src/main/serverInfoHandler.ts` + `src/renderer/src/store/serverInfoLoader.ts` +
  `src/renderer/src/screens/settings/ServerRow.tsx` → `registerServerInfoHandler`, `loadServerInfo`,
  `ServerInfoData`, `ServerRows` — one Settings row per paired server, refetched on each Settings
  mount, so AC1 is observable by opening Settings after both pairings.
- `src/renderer/src/PairedShell.tsx` → `PairedShellView`'s `pairServer` case,
  `onPairServerPaired` → `applyPairingChange('pairedAnotherServer')` → `navigateToNewServerList` —
  the second pairing lands back on the list and clears nothing the first pairing's session put up.
- `docs/knowledge/features/e2e-harness.md` § the `launchPairedApp` contract — the fixture's teardown
  and secret-hygiene conventions this change must not bend.

## Design source

**Figma:** N/A — this ticket adds an end-to-end fixture and one spec under `e2e/`. It renders no UI
and changes no rendered markup, so the visual-fidelity check is intentionally skipped.

## Context

Every downstream multi-server criterion — the per-server sidebar grouping (#1070), the unpair-scoped
renderer clear (#1150), the per-server unpair (#1152) — needs the paired app running against two fake
daemons at once. `launchPairedApp` starts exactly one forwarder, one daemon and one pairing drive, and
54 spec files import it. This ticket makes the second daemon an **opt-in** extension of that fixture
and proves it with one spec.

Nothing under `src/` changes. There is no ADR here: the fixture's own contract is the artefact, and it
belongs in the `e2e-harness` package overview, which the documentation phase owns.

### The one finding that shapes the design

With two servers paired, the app asks the second daemon **nothing at all**.

`ConversationListData` fires `requestConversationList`, which sends the bare
`{ type: 'requestConversations' }` — no `serverId`. Main-side, `src/main/index.ts` routes it through
`servers.route(command.serverId)`, and `createServerRouter`'s `resolve` takes the absent-id branch:
that branch resolves only through `soleConnection()`, which is `null` whenever the registry holds more
than one entry, so the command refuses with `ambiguous-server` and puts no frame on any wire. The same
is true of every other renderer command today — none carries a `serverId`; per `serverRouter.ts`'s own
header, the window's senders acquire a per-server surface to name in #1070/#1085/#1086, one at a time,
and the list sender has not acquired one yet.

So the first daemon's seeded row still arrives the way it does today (it *is* the sole connection at
the moment the first pairing connects, so the bare request reaches it and the fixture's default
`buildReply` answers). The second daemon's row cannot arrive as a reply, because there is no request
to reply to.

**The design consequence:** the second server's rows arrive as a *server-initiated push*
(`FakeDaemon.pushFrame`) rather than a reply. That is faithful rather than a shortcut — `pushFrame`
seals under the live send cipher, so it can only succeed after that daemon's handshake has split, and
`daemonConnection`'s inbound `conversations` arm dispatches on the inner frame's `type` with no
correlation-id match, so an unsolicited `conversations` envelope lands exactly like a solicited one,
stamped with the server it came from.

**This is a product observation, not a product change.** Widening the renderer's list request to name
a server is #1070/#1085's work; nothing under `src/` is touched here.

## Design

Three files, all under `e2e/`.

### `e2e/fixtures/pairingArrival.ts` — a second entry, one shared tail

The first pairing enters at the welcome CTA; the second enters at Settings → "Pair another server".
Only paste → Pair → fingerprint → Confirm is common.

- Extract the common tail into a module-private helper — signature
  `driveePairingForm(page: Page, payload: string, label?: string): Promise<void>` — holding today's
  `pairFromUnpairedLaunch` body from the `pasteBox` locator through the Confirm click, unchanged.
- `pairFromUnpairedLaunch` keeps its exported signature and body shape: the welcome CTA click, then
  the shared tail. Its ten call sites are untouched.
- New export `pairAnotherServerFromSettings(page: Page, payload: string, label?: string):
  Promise<void>` — clicks `Settings`, clicks `Pair another server`, then the shared tail.

Both entries end at Confirm (invariant 3), neither introduces a timeout, and the payload stays opaque:
it is filled and referenced nowhere else (invariant 2), which is now enforced in **one** place instead
of two. The module still imports only `@playwright/test` (invariant 1).

### `e2e/fixtures/launchPairedApp.ts` — an opt-in second server

New and changed exports:

- `SEEDED_ROW` unchanged. New `SECOND_SEEDED_ROW: ConversationSummary` — the same fixed-literal shape
  with a **distinct `id`** (`ChannelList` keys rows by `c.id` alone, so a shared id would collide on
  the React key) and its own name and `cwd`.
- `FIRST_SERVER_ID` / `SECOND_SERVER_ID` string constants. The first replaces today's inline
  `server: 'fake-daemon'` literal in the pasted payload so the two ids are declared side by side and
  visibly differ — `decodeCollection` rejects a repeated `server` id as a *malformed collection*, and
  a malformed collection collapses to "unpaired" rather than raising, so a collision would fail
  silently.
- `seedConversationsFrame(row: ConversationSummary = SEEDED_ROW): Uint8Array` — the default keeps
  every existing caller byte-identical; the parameter lets the fixture and a spec seed the second
  server's row from the same builder.
- New exported type `PairedServerHandle { serverId: string; daemon: FakeDaemon; forwarder:
  FakeRelayForwarder }`.
- `PairedApp` gains `servers: readonly PairedServerHandle[]` — one entry by default, two when the
  second server is opted into, in pairing order. `daemon` and `forwarder` stay exactly as they are and
  alias `servers[0]`'s, so the 54 importing spec files need no edit (AC4).
- `LaunchControl` gains `secondServer?: LaunchPairedAppOptions` — **absent is today's behaviour**;
  `{}` opts in with default daemon options; a populated object scripts the second daemon's replies the
  way the top-level `options` argument scripts the first's (AC3). Documented INERT alongside
  `reuseUserDataDir`, which returns before any pairing drive — the same posture `hostLabel` already
  has, and for the same reason: no runtime guard for a combination no caller has reason to write.

Internal shape:

- A module-private helper starts one fake server — `startFakeServer(...): Promise<{ forwarder,
  daemon }>` — running today's `startFakeRelayForwarder()` → push its teardown thunk →
  `startFakeDaemon({ url: forwarder.url, buildReply: default, ...options })` → push its teardown
  thunk. Both servers go through it, so the two are constructed identically and the drain order falls
  out of the call order.
- **Both fake servers start before `launchIsolatedApp`.** Nothing forces the second one to start late
  — its coordinates are only *pasted* later — and starting it early buys two things: the drain order
  stays `app → daemon 2 → forwarder 2 → daemon 1 → forwarder 1 → user-data-dir` (app first, so the
  supervisor cannot churn-reconnect against a dropped fake socket), and daemon 2's `/v1/server` leg is
  open long before its client leg dials, so its msg1 is never dropped — the same reason daemon 1
  already starts before the launch. Thunks are still pushed as each resource comes up, so a mid-drive
  failure leaks nothing, and each keeps its fixed-literal step label (#1127).
- The second pairing runs **after** the existing row click. The click's `.channel-list__row-open`
  locator is unfiltered and runs in Playwright strict mode, so a second row existing at that moment
  would break it outright.
- The pasted payload is built from a whole `PairedServerHandle`, not from loose values — signature
  `pairingPayloadFor(server: PairedServerHandle, token: string): string`. The relay URL and the
  pinned static key are the two halves of one server's identity, and taking them from one object
  makes it structurally impossible to paste daemon 1's key against forwarder 2's URL (a mismatch
  whose only symptom would be a handshake that never completes). Both pairings go through it.
- The two servers paste **distinct** synthetic tokens (`DUMMY_TOKEN`, `SECOND_DUMMY_TOKEN`). Neither
  is a credential and the relay ignores the value under v2, so this changes no behaviour — it exists
  so that a later spec asserting per-server credential isolation cannot pass vacuously against two
  servers that happened to share one literal.
- Second-pairing sequence, after today's Send-enabled wait: build payload 2 from server 2's handle
  and `SECOND_DUMMY_TOKEN` → `pairAnotherServerFromSettings` → wait for
  `section[aria-label="Conversations"]` (the shell's own post-Confirm landing, via
  `navigateToNewServerList`) → land daemon 2's row.

**Landing daemon 2's row is also the handshake gate.** `pushFrame` is a documented no-op outside the
daemon's `transport` state, and `whenSettled()` resolves only on a first *reply*, which daemon 2 will
never receive — so neither the daemon nor the app exposes a "server 2 connected" signal today (the
sidebar's two dots read app-wide singleton selectors; per-server dots are #1070's AC4). The fixture
therefore polls: push daemon 2's seed and read the row count, until the count reaches two. Before the
handshake splits, the push is inert and the count stays one; the first push after the split lands the
row. Re-pushing is harmless — `setConversations` replaces that server's whole slot — so the poll
converges rather than accumulating. The poll's own timeout is the handshake budget, exactly as the
first server's row click doubles as *its* connected gate.

Row order is deterministic: `flattenByServer` sorts slots by `compareOrigins` (ascending code unit),
and `FIRST_SERVER_ID` sorts before `SECOND_SERVER_ID`.

### `e2e/multi-server-launch.spec.ts` — the proof

One spec file, launching with `{}, { secondServer: {} }`:

- **AC2** — two `.channel-list__row-open` rows, one carrying each daemon's seeded name.
- **AC1** — click `Settings`; `ServerRows` renders one row per paired server, so assert the two
  `.settings__server-row-id` texts are exactly the two pasted ids, in store order.
- **AC3** — `servers` has two entries with distinct `serverId`s and distinct `forwarder` objects (one
  forwarder per daemon is what makes `closeClientLeg` per-server by construction). Then the executable
  half: push a *renamed* row through `servers[1].daemon` only, and assert the second server's row
  changes while the first server's row is untouched — one server's replies scripted without touching
  the other's.
- **AC5** — inherent in the fixture: both pairings are real clicks and a real fill through the product
  UI, with no test hook, no forced route dispatch and no store mutation. The spec asserts nothing
  extra for it; it is a construction property, visible in the fixture's diff.

**Deliberately not asserted:** two sidebar *host* rows and per-server *dots*. `ChannelList` renders a
single `.channel-list__host` row off a single-valued `hostLabelStore`, and its two dots read app-wide
singleton selectors — both are #1070's AC1/AC4, and the ticket body records that those criteria belong
to #1070's own spec riding this fixture.

## State + concurrency model

No store, no React and no production async work is added; this is Playwright test infrastructure.

- **Resource ownership.** Every resource is owned by the `launchPairedApp` fixture's epilogue. Each
  thunk is pushed as its resource comes up and drained LIFO — `app → daemon 2 → forwarder 2 →
  daemon 1 → forwarder 1 → user-data-dir` — so a failure part-way through the drive leaks nothing,
  and the app closes before either fake socket drops. Each step keeps its fixed-literal label; the
  catch stays bindingless, so a close error carrying the launch argv (which embeds `--user-data-dir`)
  is never in scope. One failing step still does not abort the rest of the drain.
- **Cancellation.** The fixture adds no timer, no listener and no long-lived async job of its own. Its
  only unbounded wait is the row-count poll, bounded by the existing handshake timeout constant.
- **Ordering.** The one ordering constraint inside the drive is that the second pairing runs strictly
  after the first drive's row click, for the strict-mode reason above. The two fake servers are
  otherwise independent: separate forwarders on separate ephemeral ports, separate responder statics.
- **Renderer-side races.** Two `conversations` writes cannot interleave destructively:
  `setConversations` reads the map inside zustand's `set` updater and copies on write, and it replaces
  one server's slot, returning every other slot by reference.

## Error handling

- **A pairing-drive step that never lands** (a missing CTA, a missing Settings button, a fingerprint
  card that never appears) surfaces as a Playwright locator timeout naming the *selector*, never the
  filled value — which is `pairingArrival.ts`'s invariant 2 and is why the shared tail lives in one
  place.
- **A second handshake that never completes** surfaces as the row-count poll timing out, reporting the
  last observed count (`1`). The count is a small integer — no payload, no key, no URL.
- **A colliding server id** would be silent, not loud: `decodeCollection` treats a repeated `server`
  as a malformed collection and the app reads as *unpaired*. Two module constants declared beside each
  other are the guard; the spec's AC1 assertion on the two distinct ids is the detector.
- **Teardown failures** keep today's behaviour: recorded as a fixed step label on the launch-fate log
  and attached only on a failing test.

## Testing strategy

- **Playwright, fake-transport tier** — the only tier that can prove any of this. `e2e/multi-server-launch.spec.ts`,
  run with `npx playwright test e2e/multi-server-launch.spec.ts` after `npm run build` (the fixture
  launches the built app from `out/`).
- **No vitest.** Nothing under `src/` changes, and renderer specs are static server renders with no
  DOM and no event handlers, so a two-pairing navigation is not expressible there.
- **The AC4 regression** — that the 54 existing importers still pass — is the dispatcher's full fake
  tier, run after the PR opens. My own gate re-runs one representative existing consumer
  (`paired-shell-navigation.spec.ts`, which exercises the default drive plus the Settings and
  "Pair another server" navigation this change reuses) to prove the default path is byte-unchanged.
- **`e2e/` is type-checked by nothing** — no tsconfig includes it and Playwright strips types with
  esbuild, so `npm run build` proves nothing about these files. Typecheck them by hand with an ad-hoc
  `tsc --noEmit` before the PR, reading the output *by filename*.

## Open questions

1. **Does the second connection's arrival flip the app-wide session status, and does that flip matter?**
   It cannot re-fire a useful list request either way (the bare request refuses as `ambiguous-server`
   with two servers held), and #1141 established that pairing another server clears nothing. To be
   confirmed by observation during the drive: the first server's row must still be present when the
   second lands.
2. **How many pushes does the poll actually take?** Expected: a handful, the split landing within a
   few hundred ms of the Confirm. If it turns out to be one every time, the poll is still the right
   shape (there is no exposed readiness signal), but the plan should say so.

Each is resolved in Phase B and recorded under `## Revisions` if it changed the design.

## Security review

**Verdict:** PASS

**Findings:**

### 1. Trust boundaries — no new boundary, one boundary crossed twice

The pasted payload crosses from the test into the app's real `parsePairingPayload`, which is the
point of driving the pairing UI. This ticket **relaxes nothing**: the second pairing runs the same
`PairingScreen` → same parse → same `pairedServerStore.save` as the first, and no third
`isPackaged`-gated dev flag is introduced. The two already-merged flags the fixture consumes
(`LOOPBACK_RELAY_ENV_FLAG` for the loopback `ws://` relay, `TEST_SECRET_BACKEND_ENV_FLAG` for the
keychain-free backend) are set exactly once for the launch, unchanged, and cover both pairings
because they are process-wide. What doubles is the number of loopback relay URLs a run pastes, not
the class of input the app accepts.

### 2. Tokens, secrets, credentials — SHOULD FIX (folded into the design)

Both payloads carry a synthetic literal, never a real credential, and every persisted secret lands
in the throwaway `--user-data-dir` that teardown removes. The second record joins the first in the
same encrypted collection blob in that same dir, so no new storage path, no new file and no second
`rm` thunk is introduced.

**Finding (SHOULD FIX, applied):** the first draft pasted the *same* `DUMMY_TOKEN` for both servers.
Not exploitable — the relay ignores the token's value under v2 and the Noise static-key handshake is
what gates — but it would silently make a future per-server credential-isolation assertion
(#1152's natural territory) pass against two servers that share one literal. The design now pastes
two distinct synthetic tokens.

### 3. File / storage operations — no new path construction

No untrusted value reaches a filesystem path. `mkdtemp` is untouched, and the second server adds a
forwarder and a daemon thunk only, so the dir is still minted once and removed once; the
`reuseUserDataDir` path still registers no second `rm` (verified in Phase B). No `existsSync`-then-
open, no path concatenation, no world-readable location.

### 4. Inter-process / Electron attack surface — nothing added

No IPC channel, no `contextBridge` member, no `BrowserWindow`, no protocol handler, no navigation
guard and no `webPreferences` value is added or changed. The launch still goes through
`launchIsolatedApp`, which owns the isolation switches. Critically: `fakeDaemon.ts` and
`fakeRelayForwarder.ts` hold a Noise static and a permissive `ws://` dialer and must never enter the
production graph — this ticket adds importers **only** under `e2e/`, so that discipline holds. The
second forwarder + daemon are constructed only when `control.secondServer` is present, so a default
launch starts exactly what it starts today.

### 5. Cryptographic primitives — two independent statics, by construction

Nothing is hand-rolled: the second server is a second `startFakeDaemon` call, which generates its own
responder static through the noise-c CSPRNG (`lib.CreateKeyPair`), never `Math.random()`. That is
why the design starts a *second daemon* rather than reusing or cloning the first handle — two
sessions sharing one static would leave the client with nothing to pin them apart and would make any
later per-server key assertion vacuous. Key/nonce reuse is structurally impossible: two sockets, two
handshakes, two `Split`s, and `pushFrame` seals under its own session's send cipher, whose nonce is
that session's per-direction counter.

**Related finding (SHOULD FIX, applied):** building the pasted payload from loose values invited a
mismatch — daemon 1's pinned static against forwarder 2's URL — whose only symptom is a handshake
that never completes. The design now builds it from a whole `PairedServerHandle`.

### 6. Network & I/O — loopback only, no production knob touched

Two forwarders bind loopback ephemeral ports for the test's lifetime; today's one already does. No
TLS setting, `maxPayload`, timeout, backoff or `rejectUnauthorized` decision is touched — every one
of those lives in production code this ticket does not open. `ws://` is accepted only because of the
pre-existing `isPackaged`-gated loopback flag; a packaged build never reads it.

### 7. Error messages, logs, telemetry — every failure surface is a selector or an integer

No `console.*` is added. The row-count poll's failure prints the last returned value, an integer.
The pairing tail's failures are Playwright locator timeouts naming the selector and the timeout,
never the filled value — the reason the shared tail lives in one place is that
`pairingArrival.ts`'s invariant 2 is then enforced once instead of twice. The AC1 assertion prints
*server ids* on failure, which `serverInfoHandler` already vets as non-secret; the spec deliberately
does not assert on `relayUrl`, so no URL reaches a report either. No payload, token or key is
interpolated into an assertion message, a `test.step` title, an attachment or a log.

### 8. Concurrency — no new owner, no new timer

The fixture adds no timer, listener or long-lived job. Its one unbounded wait is the row-count poll,
bounded by the existing handshake timeout constant. `pushFrame` on a daemon that is already
`closed` is a documented no-op, so a poll racing a failed drive cannot throw into the teardown
drain. Two `conversations` writes cannot interleave destructively: `setConversations` reads the map
inside zustand's `set` updater and copies on write.

### 9. Threat model alignment — strengthened, and one thing named out of scope

Malicious relay, token theft from disk, hostile daemon response and renderer compromise are all
unchanged: no production code path is opened. If anything this fixture *strengthens* the observable
surface, by putting the client in a state it could not previously be driven into — two independent
Noise sessions against two independently-pinned server statics — which is what makes #1150's and
#1152's isolation criteria testable at all.

**OUT OF SCOPE, named:** per-server credential isolation (that server A's token never reaches server
B) is a main-process property with no end-to-end observable today, and this ticket asserts nothing
about it. #1152 (per-server unpair) is its natural home; distinct tokens per server (finding 2) is
the groundwork so that assertion cannot be written vacuously. Per-server sidebar host rows and
per-server connection dots are #1070's AC1/AC4 and are deliberately not asserted here.
