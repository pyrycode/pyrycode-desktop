# #620 — Remove the outbound `request_snapshot` command and envelope

Spec for [#620](https://github.com/pyrycode/pyrycode-desktop/issues/620). Size **S** (held; see
[Scope & sizing](#scope--sizing-note)). `security-sensitive`: **yes** — the ticket removes a member
from the untrusted renderer→main boundary guard, so the security-review pass at the end of this doc
is mandatory and ran.

Fourth of the `#604` removal family, consumer-first: **#618** (surface, merged) → **#619** (store +
bridge, merged) → **#621** (IPC events) → **#622** (inbound decode). **#620** runs parallel, unblocked
now that #618 landed. **#637** (the comment sweep across files this ticket never opens) is blocked by
this one.

## Design source

N/A — this ticket touches no file under `src/renderer/`. The screen-snapshot UI was removed whole in
#618; what remains here is the outbound transport half, which has no visual surface. The
visual-fidelity check is intentionally skipped.

## Files to read first

Line numbers are as of `10c1fa4` and were re-verified against the worktree while writing this spec.
Expect small drift; the greps in [Comment sweep](#comment-sweep-ac5) are the authoritative locator.

| Path | What to extract |
| --- | --- |
| `src/main/transport/requestSnapshotEnvelope.ts` (whole, 44 lines) | The module being deleted. Read it once so you recognise what the `daemonConnection.ts` import at `:33` pulls in; nothing else imports it. |
| `src/main/transport/requestSnapshotEnvelope.test.ts` (whole, 31 lines) | Deleted with it. |
| `src/main/daemonConnection.ts:145-175` | The `send` / `requestSnapshot` / `requestSessionSettings` / `requestConversations` interface docblocks — `send`'s "Idempotent no-op when not connected" is the re-anchor origin for `:162`. |
| `src/main/daemonConnection.ts:1160-1195` | `requestSnapshot`'s body and the `send` twin above it; shows the exact "inert no-op → try/build/advance/send → swallow" shape that is going. |
| `src/main/daemonConnection.ts:1688-1700` | The returned-object literal; `requestSnapshot,` at `:1693` is one line out. |
| `src/shared/ipc/commands.ts:200-230` | `isRendererCommand`'s switch — the `case 'requestSnapshot'` at `:217-218` and the default-deny fallthrough that AC1's new assertion proves. |
| `src/shared/ipc/commands.ts:280-290`, `:348-385` | `isRequestSnapshotPayload` (deleted) and the three surviving `conversation_id` guards that cite it. `isUnarchiveConversationPayload:365-368` becomes the new origin. |
| `src/shared/ipc/commands.test.ts:148-153` | `rejects a missing, empty, or unknown type` — the home for AC1's new rejection assertion. |
| `src/shared/ipc/commands.test.ts:186-205` | The two `requestSnapshot` `it`s that go. |
| `src/main/index.ts:295-350`, `:400-408` | The command-dispatch switch: the `case` at `:301-304` goes; six sibling comments cite `requestSnapshot` and re-anchor. `case 'sendMessage':` at `:297-299` is the re-anchor origin. |
| `src/main/daemonConnection.test.ts:1293-1436` | **The one real judgement call.** A mixed `describe`: four outbound `it`s at `:1315/:1322/:1335/:1345`, then five inbound-only `it`s from `:1354` to `:1435`. Read the seam before editing. |
| `src/main/daemonConnection.roundtrip.test.ts:521-619` | The block that goes whole (header comment at `:521-527` included). Confirm `SECRET_SCREEN` and `snapshotFrame` are `describe`-local. |
| `src/shared/wire/types.ts:40-60`, `:172-181` | The `EnvelopeType` union member and the `RequestSnapshotPayload` interface + docblock. |
| `docs/knowledge/codebase/618.md` | §Patterns — the three re-anchoring rules this ticket inherits (grep the deleted names, verify the cited *property*, check direction words). |
| `docs/knowledge/codebase/619.md` | The immediately preceding slice; confirms the renderer/bridge half is already gone. |

## Context

The screen-snapshot feature answered by photographing claude's terminal. That terminal was deleted
upstream on 2026-08-16 (pyrycode#1348) and the daemon now wires `Snapshotter: nil`, so every
`request_snapshot` lands in the offline arm. The operator's call on 2026-08-20 is **remove**.

#618 removed the only caller (the conversation surface's request button). #619 removed the renderer
store and bridge. `requestSnapshot` is therefore already caller-less — grep confirms **zero** hits
under `src/renderer/` (bar one comment in `runConfigSnapshot.ts`, which is #637's) and **zero** under
`src/preload/` (the bridge forwards `RendererCommand` generically and names no verb, so no preload
edit exists in any slice of this family).

What is left is the outbound half, and it is **compile-atomic**: dropping the union member is an
immediate type error in `index.ts`'s dispatch switch, and dropping the connection method is an
immediate type error in two test files. Nine files, one commit.

A raw-event view to replace the feature was discussed and **deliberately deferred**. Do not build one.

**Scope by call site, not by the word `snapshot`.** `snapshot` appears across run-config, workspace,
pairing and conversation code that has nothing to do with the screen snapshot — `snapshotReceived`,
`ScreenSnapshotPayload`, `runConfigSnapshot.ts` and the whole inbound decode path all survive this
slice. A name-scoped deletion here takes live code with it.

## Design

Pure deletion. No new types, no new files, no behaviour added. Three seams.

### Seam 1 — the compile-forced deletion (nine files)

| File | What goes | Notes |
| --- | --- | --- |
| `src/shared/wire/types.ts` | `'request_snapshot'` member (`:50`); `RequestSnapshotPayload` + its docblock (`:172-181`) | The `EnvelopeType` union is the wire vocabulary. Removing an **outbound** member cannot break inbound decode — nothing switches on it inbound. `'screen_snapshot'` (`:58`) **stays**; it is #622's. |
| `src/shared/ipc/commands.ts` | type import (`:20`); union member (`:130`); guard `case` (`:217-218`); `isRequestSnapshotPayload` + docblock (`:281-287`) | After the `case` goes, `{ type: 'requestSnapshot', … }` falls through to the switch's default-deny. That is the behaviour AC1 asserts. |
| `src/shared/ipc/commands.test.ts` | the two `it`s (`:186-205`) | Plus **one added assertion**, see [Testing](#testing-strategy). |
| `src/main/daemonConnection.ts` | `buildRequestSnapshot` import (`:33`); `RequestSnapshotPayload` type import (`:65`); interface member + docblock (`:151-159`); the `requestSnapshot` function (`:1173-1188`); the returned-object entry (`:1693`) | Five edits. The interface member and the returned-object entry must go together or the object literal stops satisfying `DaemonConnection`. |
| `src/main/index.ts` | `case 'requestSnapshot':` (`:301-304`) | One edit. The switch is exhaustive over `RendererCommand`; removing the union member without this is a type error, and vice versa. |
| `src/main/daemonConnection.test.ts` | `RequestSnapshotPayload` type import (`:29`); the `PAYLOAD` const (`:1294`); four `it`s (`:1315`, `:1322`, `:1335`, `:1345`); rename the `describe` | **Partial** — see Seam 2. |
| `src/main/daemonConnection.roundtrip.test.ts` | the header comment + whole `describe` (`:521-619`) | Whole. `SECRET_SCREEN` and `snapshotFrame` are `describe`-local and go with it; every module-level import it uses (`encodeEnvelope`, `decodeEnvelope`, `UNUSED_BUILD_REPLY`, `standUpRoundTrip`, `findEvent`, `types`, `FIXED_TS`, `MESSAGE_TIMEOUT_MS`) has other live users — verified, no orphaned import. |
| `src/main/transport/requestSnapshotEnvelope.ts` | deleted | Sole importer is `daemonConnection.ts:33`. |
| `src/main/transport/requestSnapshotEnvelope.test.ts` | deleted | |

### Seam 2 — the two test files split differently

This is the one real judgement call, and getting it wrong costs a whole slice of rework.

**`daemonConnection.test.ts:1293-1436` is a MIXED `describe`.** Its first four `it`s drive
`connection.requestSnapshot`. From `:1354` to `:1435`, five `it`s emit an inbound `screen_snapshot`
plaintext directly via `drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext(…) })` and
never call the request at all.

- **Take** the four outbound `it`s and the `PAYLOAD` const.
- **Keep** the five inbound `it`s, the `connected()` helper (`:1306-1312`) and the `SNAPSHOT` fixture
  (`:1295-1304`) — both are shared by the surviving half. They are #621/#622's to remove.
- **Rename** the `describe` so it no longer promises a request/reply pair:
  `'createDaemonConnection — requestSnapshot (screen_snapshot request/reply, #180)'` →
  `'createDaemonConnection — inbound screen_snapshot decode (#180, #316)'`.

**`daemonConnection.roundtrip.test.ts:521-619` has no inbound-only half.** *Both* its `it`s call
`connection.requestSnapshot` to provoke the reply, so the block goes whole, header comment included.

> **Do not rescue it.** This block is the only real-handshake coverage of the inbound `screen_snapshot`
> decode, and losing it one slice before #622 deletes that decode anyway is the **intended trade**. Do
> not rewrite the tests to inject a `screen_snapshot` frame without a request; do not `it.skip` them;
> do not comment them out. That is turns spent on code #622 deletes. AC4 asserts nothing is left
> skipped, commented out, or rewritten.

### Seam 3 — the shared envelope-id counter needs no replacement

The deleted `daemonConnection.test.ts:1335` is one of **fifteen** identical
`shares the one envelope-id counter with send (no second counter)` `it`s in that file. Fourteen
survive this removal, so the invariant stays guarded live. **Do not write a replacement test.**

## Comment sweep (AC5)

AC5 scopes the sweep to the nine files this ticket opens: after the deletion, no comment in them may
name `requestSnapshot`, `request_snapshot`, `RequestSnapshotPayload` or `requestSnapshotEnvelope.ts`.
The ~11 citations in the nine files this ticket *never* opens (seven transport builders,
`runConfigSnapshot.ts`, `e2e/run-config-settings.spec.ts`) are **out of scope** — they are #637's,
which is blocked by this ticket so its tree-wide grep can pass.

**Locate them by grep, not by this table** — per #618's lesson, a list is a starting point, not the
boundary of the search:

```bash
grep -rn 'requestSnapshot\|request_snapshot\|RequestSnapshotPayload\|requestSnapshotEnvelope' \
  src/shared/wire/types.ts src/shared/ipc/commands.ts src/shared/ipc/commands.test.ts \
  src/main/daemonConnection.ts src/main/index.ts src/main/daemonConnection.test.ts \
  src/main/daemonConnection.roundtrip.test.ts
```

The count as of `10c1fa4` is **34 comment sites**, but they reduce to **seven decisions**. Each target
below was checked against the *property actually cited*, not just the relationship — the #618 trap.

**A. Envelope-id-counter lists — pure drops (11 sites).** `daemonConnection.ts:1196, 1213, 1231, 1251,
1284, 1315, 1341, 1364, 1393, 1421, 1449`. Each reads
`Shares the one monotonic nextEnvelopeId with send / … / requestSnapshot / … — no second counter`.
Drop `requestSnapshot` from the list. Verified: every one of the eleven still names at least one live
sibling afterwards (`send`, `requestDebugBundle`, `requestConversations`, `createConversation`,
`unarchiveConversation`, `promoteConversation`). No re-anchor needed.

**B. `daemonConnection.ts:1538` — the one two-name list.**
`Shares the one monotonic nextEnvelopeId with send / requestSnapshot — no second counter`. Dropping
leaves `with send`, which is still a live sibling and still states the invariant. Plain drop; do not
substitute a name.

**C. `index.ts` "direct to the connection method" ×6 → `sendMessage`.** Sites `:307, :312, :324, :333,
:346, :402` read `Direct to the connection method (mirrors requestSnapshot), no orchestrator/facade`.
Re-anchor **all six to `sendMessage`**, i.e. `(mirrors sendMessage)`.

> The ticket body suggests `requestSessionSettings`. **Do not use it.** Two reasons, both verified:
> `:307` *is* `requestSessionSettings`'s own comment (self-citation), and `requestSessionSettings` is
> bare, while four of the six sites (`answerModal`, `createConversation`, `dequeueMessage`,
> `setSessionSettings`) are payload-carrying. `case 'sendMessage': connection.send(command.payload)`
> at `:297-299` is the file's first case, carries a payload, sits above all six sites (no direction-word
> hazard), and is what the deleted `requestSnapshot` comment itself cited. It is the origin.

**D. `commands.ts` boundary-guard precedent ×4 → `isUnarchiveConversationPayload`, made the origin.**
Four guards cite `isRequestSnapshotPayload`. Apply in this order so no name dangles and no cycle forms
(the `.unrecognized-row__raw` move from #618):

1. `isUnarchiveConversationPayload:361-364` — **becomes the origin.** Drop
   `Mirrors isRequestSnapshotPayload (the single-conversation_id-string precedent):` and let the
   sentence state the property directly. Verified it carries it: `:367` is exactly
   `'conversation_id' in value && typeof value.conversation_id === 'string'`, type-not-emptiness.
2. `isArchiveConversationPayload:349-354` — already calls itself
   `the mirror-image twin of isUnarchiveConversationPayload`. Drop only the
   `, mirroring isRequestSnapshotPayload (…)` clause; the twin citation carries it.
3. `isDeleteConversationPayload:374-378` — already
   `An exact clone of isUnarchiveConversationPayload`. Same: drop the `mirroring …` clause only.
4. `isCancelModalPayload:303-306` — `Mirrors isRequestSnapshotPayload: one modal_id string check`.
   Re-anchor to `isUnarchiveConversationPayload`. The cited property is *one present-and-string check*,
   not the field name, and unarchive carries it. No direction word in the sentence, so no fix needed
   (unarchive sits below it).

**E. `commands.ts` prose ×4.** `:10` — drop `, requestSnapshot` from
`The payload-bearing members (sendMessage, requestSnapshot)`. `:75-76` — delete the whole
`requestSnapshot (#180), whose payload reuses …` clause from the union docblock (it describes the
member being removed; there is nothing to re-anchor). `:172` and `:182` —
`the sendMessage / requestSnapshot "reuse wire types, no remapping" convention` → drop
`/ requestSnapshot`; `sendMessage` reuses `SendMessagePayload` verbatim and carries the property.

> Leave the docblock's stale `Ten members today:` count alone. It was already wrong before this ticket
> (the union has twenty members) and fixing it is adjacent-code drift, not this ticket's.

**F. `daemonConnection.ts` interface docblocks ×4.**

| Site | Cited property | Action |
| --- | --- | --- |
| `:162` `Inert no-op when not connected, like requestSnapshot` | inert-no-op-when-disconnected | → `like send`. Verified: `:146` reads `Idempotent no-op when not connected`, and the deleted `requestSnapshot` doc itself called it "The `send` TWIN". |
| `:172` `#208 triggers it via sendCommand on connect (as #181 triggered requestSnapshot)` | a historical claim about #181 | **Delete the parenthetical.** Do not invent a substitute — #181's trigger no longer exists, so there is no live precedent to point at. The sentence stands alone. |
| `:312` `no main-side guard, like requestSnapshot` | *no* main-side empty-string guard on the id | → `like archiveConversation`. Verified at `:1389-1402`: it passes `payload.conversation_id` straight into the fresh literal with no emptiness check. |
| `:1529` `mirrors requestSnapshot's empty conversation_id` | same | → `mirrors archiveConversation's empty conversation_id`. |

**G. `commands.test.ts` prose ×4.** Same origin-first ordering as D:

1. `:380` (the unarchive `it`) — `Mirrors requestSnapshot: a single required-string field, no
   constructor (…)` → **becomes the origin**; drop `Mirrors requestSnapshot:` and state it directly.
2. `:306` (createConversation) — `No constructor exists (requestSnapshot precedent)` →
   `(the unarchiveConversation precedent)`. Verified: `unarchiveConversation` has no constructor
   function in `commands.ts`; the renderer builds the literal inline.
3. `:664` (notify) — `No constructor exists (the requestSnapshot precedent)` → same substitution.
4. `:291` (cancelModal) — `A structurally-extra field is harmless (structural minimum), like
   requestSnapshot.` → `like sendMessage`. Verified: `commands.test.ts:131-139` is exactly the
   `sendMessage` extra-harmless-field assertion.

Finish by re-running the grep above; it must return zero. Re-running it across the whole tree will
still show the ~11 out-of-scope hits — that is expected and is #637's AC.

## State, concurrency, error handling

Nothing to design; this is subtractive.

- **State.** No store touched. `requestSnapshot` held no state — it read `driver` and `nextEnvelopeId`
  and wrote only the latter, both of which are shared with every other verb and survive.
- **Concurrency.** No async task, timer, listener or `AbortController` is created or destroyed. The
  envelope-id counter stays monotonic and single-source; removing one of its writers cannot make ids
  collide.
- **Error handling.** The `try { … } catch { }` in `requestSnapshot` (`:1178-1187`) that swallowed
  `WireEncodeError` and driver throws goes with the function. Every sibling keeps its own; the
  never-throw-out-of-the-module parity (#490) is per-method and unaffected.
- **Boundary behaviour change (the one real behavioural delta).** `isRendererCommand` gains one more
  rejected shape. A `{ type: 'requestSnapshot', … }` message arriving on `COMMAND_CHANNEL` — from a
  stale renderer bundle, a replayed message, or a compromised renderer — now hits the switch's
  default-deny and is dropped at the boundary instead of dispatched. That is fail-closed and is the
  desired direction; AC1 asserts it.

## Testing strategy

`npm test` (vitest) plus the fake-daemon e2e gate. No new test file. Net test delta is **-8 `it`s and
+1 assertion**.

**Deleted:** the two `commands.test.ts` `it`s; the four outbound `daemonConnection.test.ts` `it`s; both
`roundtrip.test.ts` `it`s; both `requestSnapshotEnvelope.test.ts` `it`s (with the file).

**Added — exactly one assertion**, appended to the existing
`it('rejects a missing, empty, or unknown type')` at `commands.test.ts:148-153`:

- Input: a structurally well-formed `{ type: 'requestSnapshot', payload: { conversation_id: 'c1' } }`
  — the exact shape that was valid before this commit.
- Expected: `isRendererCommand(...)` returns `false`.
- Why here and not a new `it`: the retired verb is now just another unknown type, and that `it` is
  where unknown types are proven rejected (`{ type: 'connect', payload }` already sits in it). This
  turns "the member is gone" from an absence into a positive, executable assertion — which is what
  makes AC1 verifiable at all, and is the security-relevant half of this ticket.

**Deliberately not added:** an envelope-id-counter replacement (Seam 3 — fourteen survive), and any
rescue of the roundtrip coverage (Seam 2 — the trade is intended).

**Gates.** `npm run build` (typecheck + electron-vite) is the real proof of the compile-atomicity
claim: it is the thing that fails if any of the nine edits lands without its siblings. Then `npm test`
green with nothing skipped, then the fake-daemon e2e run. Note that `e2e/` is outside both tsconfigs,
so `npm run typecheck` does not cover Playwright specs — but this ticket edits none, so there is no
gap to close here.

## Scope & sizing note

Held at **S**. The § 4 commit-time gate counts **5 production `.ts` files** (`wire/types.ts`,
`ipc/commands.ts`, `daemonConnection.ts`, `index.ts`, and the deleted `requestSnapshotEnvelope.ts`),
which trips the "≥ 5 → do not commit" threshold. This is the **documented outbound-wire-verb
false positive**, and the § 1 red lines all pass on the raw counts:

| Red line | Count | |
| --- | --- | --- |
| > 3 new files | **0** new (2 deleted) | pass |
| > ~600 lines total written | ~270 out, ~45 comment lines rewritten | pass |
| > 5 new exported types | **0** | pass |
| > 10 consumer call sites | **7** — `index.ts:304`, `daemonConnection.test.ts` ×4, `roundtrip.test.ts` ×2 | pass |
| > 5 acceptance criteria of work | 5 (AC6 is the gate, not work) | pass |
| ≥ 10 reject branches | N/A — subtractive | pass |

The 34 comment sites are **not** call sites and do not cascade — but they are real turns, which is why
this spec pre-resolves all seven decisions with verified targets above rather than leaving thirty-four
independent judgement calls to the implementation. That conversion is the main thing this spec buys.

No Strangler-Fig seam exists: a single verb's union member, dispatch arm, interface method,
returned-object entry, builder and wire type do not typecheck apart, so any split yields non-compiling
children and fails `npm run build` — the QA gate. The splittable half (comment-only, zero compile
dependency) was already carved out into **#637**. Direct precedent: **#618**, the immediately
preceding slice of this same family, shipped six files / 436 lines out at S with a code-review PASS.

**File-overlap check:** run at `10c1fa4` against every `origin/feature/<n>` branch (branch-based, not
PR-based, so in-flight work without an open PR is visible). **No overlap** on any of the nine files.
No `addBlockedBy` needed.

## Open questions

None blocking. Two things the implementation will confirm rather than decide:

1. **Line drift.** Every line number here was verified at `10c1fa4`, but `daemonConnection.ts` is 1712
   lines and `daemonConnection.test.ts` is 5377. Locate by symbol and by the grep in
   [Comment sweep](#comment-sweep-ac5), not by line number.
2. **Grep residue after the sweep.** The tree-wide grep will still show ~11 hits in the nine files this
   ticket never opens. That is correct and expected — confirm they are all in the out-of-scope set
   (seven transport builders, `runConfigSnapshot.ts`, `e2e/run-config-settings.spec.ts`) and leave
   them for #637. In particular, `e2e/run-config-settings.spec.ts:192` carries a claim that
   `RunConfigData` mounts `request_snapshot`; that claim has been **false since #491/#500** and
   predates this removal. Do not "fix" it here and do not let it make you doubt the scope.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The one boundary this ticket touches is the untrusted renderer→main command
  boundary at `src/shared/ipc/commands.ts`'s `isRendererCommand`. The change is subtractive and
  **fail-closed**: removing `case 'requestSnapshot'` moves that shape from accept to the switch's
  default-deny, so the boundary strictly narrows. Verified the switch has no permissive fallthrough —
  `isRendererCommand:210` returns `false` for a non-object, a null, or a missing `type`, and unmatched
  `type` values fall out of the switch to `return false`. The one added assertion in
  `commands.test.ts:148` is what makes that narrowing executable rather than assumed, which is why this
  spec insists on it rather than treating "the tests are gone" as sufficient.
- **[Trust boundaries — the negative check]** No *surviving* guard's behaviour changes. The three
  re-anchors in decision **D** are comment-only; `isUnarchiveConversationPayload`,
  `isArchiveConversationPayload`, `isDeleteConversationPayload` and `isCancelModalPayload` keep their
  bodies byte-for-byte. A reviewer must confirm the sweep touched only docblocks in that file — a
  stray edit inside a guard body is the one way this ticket could weaken the boundary, and it would be
  invisible to the type checker since all four return `boolean`.
- **[Tokens, secrets, credentials]** Not applicable by construction. `RequestSnapshotPayload` was a
  single `conversation_id: string` — a routing id, not a secret (`commands.ts:281-283` says so
  explicitly). Nothing removed here generated, stored, rotated or logged a token. The device keypair,
  the pairing token and `safeStorage` are untouched.
- **[File / storage operations]** Not applicable — no path is constructed, read or written. The two
  deleted files are source, not runtime state; no on-disk format, cache or migration is involved.
- **[Inter-process / Electron attack surface]** No `webPreferences`, `contextBridge` API,
  `ipcMain.handle`, custom protocol or navigation guard is added or altered. The preload bridge
  forwards `RendererCommand` generically and names no verb, so the IPC *surface* is unchanged while
  the accepted *vocabulary* shrinks by one — the safe direction. Process placement is preserved: the
  deletion removes main-process code only and moves nothing toward the renderer.
- **[Cryptographic primitives]** Not applicable. `buildRequestSnapshot` called `encodeEnvelope` and
  handed opaque bytes to the driver; it performed no key, nonce or AEAD operation. Removing one writer
  of the shared monotonic `nextEnvelopeId` cannot cause id or nonce reuse — the counter is
  single-source and only ever advances (`daemonConnection.ts:1182`), and Noise nonces are the session's
  per-direction counters, entirely separate from envelope ids.
- **[Network & I/O]** No socket, timeout, `maxPayload`, TLS setting or reconnect policy is touched.
  The client's outbound vocabulary shrinks by one verb, which strictly reduces what it can emit. The
  daemon keeps its `request_snapshot` verb (explicitly out of scope), so no protocol negotiation
  breaks and no version skew is introduced — an older desktop build talking to the same daemon is
  unaffected, and a newer one simply never sends it.
- **[Error messages, logs, telemetry]** The deleted `catch { }` swallowed its caught object without
  logging — the classify-don't-forward posture inherited from #62 — so nothing that previously
  suppressed a leak is being removed. No new log call, error message or telemetry field is added.
  Worth noting for the developer: the deleted `roundtrip.test.ts` block asserted
  `JSON.stringify(snap)).not.toContain(SECRET_SCREEN)`, i.e. that rendered screen text never rode the
  run-config event. That assertion is **not lost silently** — its twin lives on in the surviving
  `daemonConnection.test.ts` inbound half (`:1375-1377`), which Seam 2 explicitly keeps. Had the seam
  been drawn the other way, this ticket would have deleted the last guard against that leak.
- **[Concurrency]** No async task, timer, listener or `AbortController` is created or destroyed. The
  removed function was synchronous and fire-and-forget. No shared-state check-then-act is introduced.
  Shutdown and teardown paths are untouched.
- **[Threat model alignment]** *Malicious relay* — unchanged; the client sends one fewer frame type.
  *Hostile daemon response* — unchanged and explicitly **out of scope**: the inbound `screen_snapshot`
  decode path survives this slice intact and comes out in #621/#622. Between this merge and #622, the
  client can still parse an unsolicited `screen_snapshot` it will never have asked for; that is a
  transient, deliberate state of the removal sequence, the decode is already defensive
  (`drops a malformed screen_snapshot without emitting or throwing (fail-closed)`,
  `daemonConnection.test.ts:1427`), and the events it emits now have no renderer consumer after #619.
  *Renderer compromise reaching the transport* — improved: a compromised renderer has one fewer
  accepted command shape and can no longer reach `driver.sendMessage` through this verb at all.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
