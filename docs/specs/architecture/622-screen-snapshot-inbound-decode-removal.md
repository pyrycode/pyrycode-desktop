# #622 — Remove the inbound `screen_snapshot` decode arm and wire type

**Ticket:** [pyrycode-desktop#622](https://github.com/pyrycode/pyrycode-desktop/issues/622)
**Size:** S — 2 production files, ~70 production lines deleted, 0 added. Compile-atomic.
**Labels:** `enhancement`, `size:s`, `security-sensitive`

## Design source

N/A — transport-layer removal under `src/main/transport/` and `src/shared/wire/`. No renderer file is
touched and no rendered surface changes (the visible surface came out in #618, the store and bridge in
#619). The visual-fidelity check is intentionally skipped.

## Files to read first

- `src/main/transport/inboundMessage.ts:1227-1240` — `parseInboundMessage`'s prologue. **Read this
  first.** The `MAX_PLAINTEXT_BYTES` guard throws *before* `decodeEnvelope` and before the type
  switch. This ordering is the whole basis of Decision D below.
- `src/main/transport/inboundMessage.ts:1287-1300` — the `screen_snapshot` arm being deleted, and
  `:1301-1310` — the `session_settings` arm immediately below it, whose comment says *"Mirrors the
  screen_snapshot arm above"*. That comment is **not yours** (Decision B).
- `src/main/transport/inboundMessage.ts:1684-1695` — the `default` arm and its `inbound-unmodeled`
  emit. This is where a `screen_snapshot` frame lands after your change. Note the 64-char type cap.
- `src/main/transport/inboundMessage.ts:448-472` — `parseScreenSnapshotPayload` and its doc, both
  deleted. `:475-485` and `:499-508` — the two sibling parsers whose docs open *"Fail-closed like
  parseScreenSnapshotPayload"*. Also not yours.
- `src/shared/wire/types.ts:118-128` — `Envelope.type` is `EnvelopeType | string`, an **open** union.
  This is why the removal is behaviourally inert (Decision A).
- `src/shared/wire/types.ts:244-268` — `ScreenSnapshotPayload` and its doc, deleted.
  `:210-222` — `SessionSettingsPayload`'s doc cites it at `:217`; that citation stays.
- `src/main/transport/inboundMessage.test.ts:599-692` — the two describes you restructure. Read every
  `it`; `:680` is not what the block title says it is.
- `src/main/transport/inboundMessage.test.ts:1586-1594` — the "still returns null for a well-formed
  envelope of another unmodeled type" idiom, repeated seven times in the file. Follow it.
- `src/main/transport/inboundMessage.test.ts:3227-3252` — the two diagnostic-log `it`s you rewrite.
  The `not.toContain(SECRET_TEXT)` assertion in the first one is load-bearing (Decision E).
- `src/main/transport/inboundMessage.test.ts:4079-4092` — `logs an unmodeled envelope by type`. The
  existing `inbound-unmodeled` assertion shape; your new log pins mirror it.
- `src/main/daemonConnection.test.ts:1292-1337` — the parked describe. **It survives.** Its two `it`s
  need their prose corrected, not their bodies.
- `src/main/daemonConnection.ts:486-495` — the `try`/`catch` around `parseInboundMessage`. A thrown
  `WireDecodeError` is caught and dropped; no event, no throw. Explains why AC4's tests pass both
  before and after.
- `docs/knowledge/codebase/621.md:38-45` — records the malformed-frame `it` as deliberately parked
  for this ticket ("vacuous now but still passes").

## Context

`screen_snapshot` answered by photographing claude's terminal. That terminal was deleted upstream on
2026-08-16 ([pyrycode#1348](https://github.com/pyrycode/pyrycode/issues/1348)); the daemon now wires
`Snapshotter: nil`, so every request lands in the offline arm. The operator's 2026-08-20 call is
**remove**, consumer-first. This is the fifth and last slice: #618 took the visible surface, #619 the
renderer store and bridge, #620 the outbound envelope, #621 the daemon events.

The decode arm therefore produces a message kind with **no reader**. Measured on `dacdd52`, not
assumed — `grep -rn "'snapshot'" src/ e2e/ | grep -v screen_snapshot` returns six hits: its own
definition (`inboundMessage.ts:263`), its own production site (`:1299`), and four test assertions.
#621 deleted the `case 'snapshot':` that used to read it.

## Design

### Decision A — the removal is behaviourally inert; the *pin* is the deliverable

`Envelope.type` is `EnvelopeType | string` (`types.ts:120`) — an **open** union. Dropping
`screen_snapshot` from `EnvelopeType` therefore does not make an inbound `screen_snapshot` frame
throw, and does not make it unrepresentable. It makes it fall through the switch to the `default` arm,
which logs it content-free and returns `null`.

So the deletion changes nothing an attacker or a hostile daemon can observe *except* the diagnostic
record. The ticket's real product is the **test that pins that tolerance for this specific type** —
without it, a future contributor reading the diff has no evidence that removing a modeled type is
safe, and the next removal has to re-derive it.

**Non-obvious consequence, and AC3's subject.** After the removal the `default` arm never inspects the
payload. A *malformed* `screen_snapshot` becomes **indistinguishable** from a well-formed one in the
log — identical `event`, identical `code`, identical field set, differing only in `bytes` and `hash`.
The pre-existing pin at `inboundMessage.test.ts:3246` (*"does NOT log on a malformed throw path"*)
therefore **inverts**: the malformed frame now *does* log. That inversion is a required, deliberate
part of this change, not a regression.

### Decision B — comment triage: describes-it dies, cites-it stays

This removal strands comments in two distinct classes, and conflating them is the main way this
ticket collides with **#635** (the tail sweep, natively blocked by this ticket).

| Class | Rule | Sites |
|---|---|---|
| Comments that **describe the removed thing** | Delete with it — they are part of the removal | `inboundMessage.ts:97-99` (the `snapshot` kind in the `InboundDaemonMessage` doc), `:448-458` (the parser's own doc), `:1220` (`screen_snapshot → snapshot` in `parseInboundMessage`'s doc), `:1288-1291` (the arm's own comment), `types.ts:245-251` (the interface doc) |
| Comments that **cite the removed thing as precedent for surviving code** | **Leave dangling.** #635 sweeps the union of every name #618–#622 removed in one pass | `inboundMessage.ts:476`, `:500` (both *"Fail-closed like parseScreenSnapshotPayload"*), `inboundMessage.ts:1305` (*"Mirrors the screen_snapshot arm above"*), `types.ts:217` (cites `ScreenSnapshotPayload`) |

**`inboundMessage.ts:1305` is the highest collision risk in this ticket.** It sits on the
`session_settings` arm *immediately below* the one you delete, and once the deletion lands, "the
screen_snapshot arm above" points at nothing. It will be directly under your cursor and it will look
like your mess. It is not. Leave it. Re-anchoring it here re-opens the file twice and collides with
#635's single-pass sweep.

Three further sites are outside the files you edit and are also #635's — do not open these files:
`src/shared/ipc/events.ts:87`, `src/renderer/src/screens/conversation/runConfigSnapshot.ts:9` and
`:14`.

**Comments you *do* own:** any comment you author, and the docs on test helpers and fixtures you
*repurpose* (Decision C). A helper whose doc says it builds a `screen_snapshot` frame "(#180)" is
lying about its own job once that frame is unmodeled; correcting it is part of writing the new test,
not part of #635's sweep.

### Decision C — restructure the two `screen_snapshot` describes into one

Keep both vehicles rather than deleting and re-creating them:

- `encodeSnapshot` (`inboundMessage.test.ts:46-48`) — **keep**, re-doc. It no longer builds a modeled
  frame; it builds *the* unmodeled frame this ticket pins.
- `SNAPSHOT` (`:199-209`) — **keep**, re-doc. It is no longer "a well-formed payload"; it is the
  payload the daemon used to send, retained so the pins exercise a realistic frame (and, for the log
  pin, one that carries sensitive `text`).

Replace `screen_snapshot recognition` (`:599-634`) and `screen_snapshot fail-closed` (`:636-692`)
with a single describe — suggested title *"`parseInboundMessage` — `screen_snapshot` is no longer
modeled (#622)"*. Scenarios, as behaviour not code:

- A well-formed `screen_snapshot` envelope decodes to `null` and does not throw. *(AC2)*
- A malformed `screen_snapshot` payload — reuse `:660`'s `yolo: 'nope'` case — also decodes to `null`
  and does not throw, because the payload is never inspected. *(AC3)*
- A non-object `screen_snapshot` payload (`'nope'`, `['a']` — from `:676`) likewise decodes to `null`.
  Pins that even the `isRecord` gate is gone, not merely relaxed.
- **The oversize `it` from `:680` is retained here**, retitled per Decision D.
- Follow the seven-times-repeated idiom at `:1590`: one `it` confirming a modeled type still routes
  unchanged, so the describe carries its own no-widening regression. *(AC5)*

### Decision D — retain `:680`, and retitle it to say what it now uniquely proves

The ticket body says not to drop *"throws on an oversized snapshot plaintext even when the JSON is a
valid snapshot"* with the block that contains it, because the `MAX_PLAINTEXT_BYTES` guard is
frame-level. That is correct but understates it, and the sharper reason should be in the test's own
title.

There are ~12 sibling oversize `it`s in this file (`:903`, `:1000`, `:1096`, `:1190`, `:1246`,
`:1302`, `:1423`, `:1506`, `:2478`, `:2851`, `:3124`, `:4138`). **Every one of them uses a *modeled*
envelope type.** After this ticket, `:680` is the only oversize test whose envelope type is
**unmodeled** — so it is the only proof that the size guard runs *before* the type switch, and hence
that an oversized frame of an unrecognised type still fails closed rather than reaching the tolerant
`default` arm that now returns `null`.

That property is exactly what this ticket newly puts at risk: `screen_snapshot` is now routed down the
tolerant path, and "unmodeled types are tolerated" must not be readable as "unmodeled types are
unbounded". Retitle the `it` to state the guard-ordering claim rather than the snapshot claim. *(AC5)*

### Decision E — carry the anti-leak assertion forward onto the new path

`inboundMessage.test.ts:3227` asserts that a `screen_snapshot` whose `text` is `SECRET_TEXT` leaves a
record containing neither the text nor the model. That assertion is the repo's only proof that a
frame carrying **sensitive rendered terminal output** leaves no content in the diagnostic log.

The existing `default`-arm log tests (`:4079`, `:4095`) use `type: 'ack'` with `payload: {}` — there
is no sensitive content in them to leak. So deleting `:3227` with the arm would silently drop the
anti-leak coverage precisely as the sensitive frame moves onto a *different* logging path. **Rewrite
it onto the unmodeled path; do not delete it.** See the security review below.

Rewrite the two diagnostic `it`s (`:3227`, `:3246`) in place, inside the existing diagnostic-log
describe — this file asserts return values in the per-verb describes and log records in the
diagnostic describe, and that separation stays:

- A well-formed `screen_snapshot` carrying `SECRET_TEXT` produces exactly one record with
  `event: 'inbound-unmodeled'`, `code: 'screen_snapshot'`, the exact field set
  `['bytes','code','event','hash','seq','ts']`, and the line contains neither `SECRET_TEXT` nor
  `'claude-opus-4-8'`. *(AC2, and Decision E)*
- A malformed `screen_snapshot` produces a record too — the inversion of the old `:3246`. Assert
  AC3's *indistinguishability* directly: capture both records and assert they are equal on `event`,
  `code` and key set, and differ only in `bytes` and `hash`. Asserting the property by comparing the
  two records is stronger and more honest than asserting each in isolation. *(AC3)*

### Decision F — the parked connection-level describe survives; only its prose changes

`daemonConnection.test.ts:1292-1337` is compile-forced here (`:29` imports the deleted type) and is
the only coverage that a `screen_snapshot` frame reaching the **real connection** produces no renderer
event at all. Changes are surgical:

- `:29` — drop `type ScreenSnapshotPayload` from the import list.
- `:1293` — `SNAPSHOT` loses its type annotation and becomes a plain object literal. Values unchanged.
- Describe title and both `it` prose blocks — corrected. Specifically: delete the sentence *"The
  decode itself survives this slice and comes out in #622"* (`:1321`), and drop **"fail-closed"** from
  the malformed `it`'s name — nothing fails closed on that path any more; the frame is simply
  unmodeled. Both `it` **bodies** are unchanged: the call-count pin is already the right assertion.
  *(AC4)*

### Decision G — production diff is deletions only

Net production change is negative. No new production code, no new log statement, no new branch. This
is directly checkable and code-review should check it: outside comment rewraps, the production diff
for `src/main/` and `src/shared/` should contain **zero added statement lines**. Same shape as #621's
routed finding, which code review verified clean.

## State + concurrency model

Unchanged. `parseInboundMessage` is a synchronous pure function over a `Uint8Array`; this ticket
removes one `case` from its switch. No store, no async task, no subscription, no teardown path is
touched. `daemonConnection`'s read loop, its `try`/`catch` (`daemonConnection.ts:486-495`) and its
IPC emit are untouched — only that file's *test* changes.

## Error handling

| Frame | Before | After |
|---|---|---|
| Well-formed `screen_snapshot` | `parseScreenSnapshotPayload` → `{kind:'snapshot'}`, logged `inbound-decoded`; connection drops it, no emit | `default` arm → `null`, logged `inbound-unmodeled`; connection drops it, no emit |
| Malformed `screen_snapshot` | `WireDecodeError` thrown, **no log**; caught at `daemonConnection.ts:490`, dropped | `default` arm → `null`, logged `inbound-unmodeled`; dropped |
| Oversized `screen_snapshot` | Frame-level guard throws before the switch; caught, dropped | **Identical** — the guard precedes the switch |

User-visible behaviour is unchanged on all three rows: nothing reached the UI before and nothing does
now. The only observable delta is the diagnostic record on row 2. `WireDecodeError` remains the single
failure type at this boundary.

## Testing strategy

Unit (`npm test`, vitest) only — no renderer, no new e2e. Type-level coverage via **both** tsconfig
projects run **separately**: `npm run typecheck` is `node && web` and the `&&` short-circuits, hiding
the entire renderer half behind a node-side failure.

- `inboundMessage.test.ts` — the new describe (Decision C) and the two rewritten log pins
  (Decision E).
- `daemonConnection.test.ts` — prose-only corrections (Decision F); assertion bodies unchanged.
- Regression: the seven `still returns null for a well-formed envelope of another unmodeled type`
  `it`s and every modeled-verb describe must stay green untouched. *(AC5)*
- Gates: `npm test`, `npm run build`, fake-daemon e2e and real-daemon e2e all green, nothing skipped.

**Expected fan-out, measured.** Deleting `ScreenSnapshotPayload` from `types.ts` breaks exactly two
files — `inboundMessage.ts:31` and `daemonConnection.test.ts:29`, the only two `import` sites in the
tree. The interface, the union member, the parser, the `snapshot` kind and the decode arm all fall
together; both test files fail the moment the arm goes. That is why this is compile-atomic and not
splittable: a first child could deliver nothing green.

## Non-goals

- **Comment re-anchoring** — #635's, per Decision B. Including the four dangling sites inside the two
  files you edit.
- **The daemon's `screen_snapshot` verb** — separate repo, separate board. Mobile's literal-screen
  view is equally dead but is a separate decision.
- **`session_settings` decoding / the `runConfigReceived` path** — the settings sheet's live reply
  since #491. `ScreenSnapshotPayload` and `SessionSettingsPayload` share five field names for
  different reasons; remove only the former.
- **A raw-event view** to replace the feature — deliberately deferred by the operator.
- **Scoping by grepping `snapshot`** — the word appears across live run-config, workspace, pairing
  and conversation code. Scope by call site.

## Open questions

None blocking. One handoff note, recorded for #635 rather than resolved here: #635's Technical Notes
scope its grep to the removed renderer-store **export** names plus "whatever #620–#622 remove", and
explicitly warn off a bare `snapshot` grep. Three of the sites this ticket strands name the **wire
verb** `screen_snapshot` rather than an export — `inboundMessage.ts:1305`, `events.ts:87`,
`runConfigSnapshot.ts:9`/`:14` — so a name-scoped sweep could miss them. `runConfigSnapshot.ts:14`
(*"The live-screen view still uses `screen_snapshot`"*) is additionally a false fact rather than a
dangling name, matching #635's own third bullet. Flagged on #635.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. `parseInboundMessage` remains the single explicit
  untrusted→trusted boundary for decrypted daemon plaintext, and this change strictly *narrows* it:
  one narrowing arm is removed and its output had no consumer, measured (`kind: 'snapshot'` survives
  only in its own definition, its own production site and four test assertions — #621 deleted the
  consuming `case`). Strictly less data crosses the boundary after this ticket than before.
- **[Tokens, secrets, credentials]** No findings, and a net reduction. `ScreenSnapshotPayload.text` is
  sensitive — rendered terminal output, decoded at the transport boundary and never surfaced past it
  (#180). After this ticket the desktop never materialises it into a typed object at all. No token,
  key or credential path is in the blast radius.
- **[File / storage operations]** Not applicable — the diff's blast radius (`inboundMessage.ts`,
  `types.ts`, two test files) contains no filesystem call, no path construction and no persisted
  state.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, `contextBridge` API or
  `webPreferences` value is touched; `daemonConnection.ts` itself is not edited. The removal can only
  *reduce* what crosses IPC. Routed to code-review as Decision G: confirm the production diff adds
  zero statement lines, so no `webContents.send` is introduced. AC4's existing call-count pin is the
  behavioural backstop.
- **[Cryptographic primitives]** No findings. `hashPlaintext` (blake2s) and the Noise path are
  untouched. Considered and dismissed: the malformed path now emits a `blake2s` hash where it
  previously emitted nothing — but it is a hash of the sender's *own* frame, so it is no oracle for
  anything the sender does not already hold, and the `default` arm already hashes every other
  unmodeled frame, so no new capability is introduced.
- **[Network & I/O]** **SHOULD FIX — addressed in spec (Decision D).** The `MAX_PLAINTEXT_BYTES`
  guard is the only thing bounding an oversized-but-valid-JSON frame at this boundary
  (`inboundMessage.ts:1231-1236`). This ticket routes `screen_snapshot` onto the tolerant `default`
  path, and the natural way to write the change — deleting the `screen_snapshot fail-closed` describe
  wholesale — takes `:680` with it. Post-removal, `:680` is the **only** oversize test using an
  unmodeled envelope type; all ~12 siblings use modeled types, so if the guard ever moved into the
  per-type arms, every sibling would still pass while unmodeled frames became unbounded — a
  memory-exhaustion vector from a hostile relay or daemon on the exact path this ticket newly opens.
  The spec requires retention plus a retitle stating the guard-ordering claim. Code-review must
  verify the `it` survived and that its title names the ordering, not the snapshot.
- **[Error messages, logs, telemetry]** **SHOULD FIX — addressed in spec (Decision E).** A well-formed
  `screen_snapshot` carries sensitive `text` and, after this change, is logged by a *different* arm.
  `inboundMessage.test.ts:3227` is the repo's only assertion that such a frame leaves no content in
  the log; the existing `default`-arm log tests use `type:'ack'` with `payload:{}` and have no
  sensitive content to leak. Deleting `:3227` with the arm would drop anti-leak coverage exactly as
  the sensitive frame changes paths. The spec requires it be rewritten onto the unmodeled path with
  its `not.toContain` assertions intact. Verified content-free by construction: the `default` arm logs
  `envelope.type.slice(0, 64)` — a constant for this frame — plus `bytes` and `hash` only, and never
  reads the payload. Separately, AC3's inversion (the malformed frame now leaves a record where it
  left none) adds no payload field and is the pre-existing behaviour for every unmodeled type; not a
  new disclosure class.
- **[Concurrency]** Not applicable — `parseInboundMessage` is synchronous and pure; the change adds no
  task, timer, listener or shared-state mutation, and no `await` is introduced or removed.
- **[Threat model alignment]** No findings. *Hostile daemon response:* the client becomes more
  tolerant of one malformed type — it returns `null` instead of throwing. This is the correct
  direction: `daemonConnection.ts:490` already caught and dropped that throw, so no user-visible
  behaviour changes, and a client that crashes on an unexpected type is a worse failure than the one
  being removed. Every other type's fail-closed parsing is untouched. *Malicious relay:* content-blind
  and on-path only; unaffected. *Renderer compromise:* unaffected — this removes renderer-reachable
  data rather than adding any.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
