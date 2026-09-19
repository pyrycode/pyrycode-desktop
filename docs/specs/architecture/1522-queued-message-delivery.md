# Queued-message delivery (#1522)

## Context and scope

The report establishes enqueue without a subsequent answer, but does not localize
the failure. The existing live queue-drop test cancels its only follow-up and
cannot detect failed delivery. Add the missing real-stack oracle before selecting
a repair. No production defect has been reproduced in this builder environment;
the credentialed reproduction belongs to the dispatcher's live gate. Do not add a
desktop queue, resend accepted messages, or assert that this test-only change fixes
the reported failure. A confirmed daemon defect needs a linked upstream prerequisite.

Sizing: one deliverable (queued delivery regression proof), four acceptance
criteria, zero production files, no production exports or consumer changes, no
production reject branches, approximately 600 total written lines including this
plan and oracle tests. The #446 analogue added 226 test and 133 plan lines.
Remote feature branches were refreshed and checked for all four intended e2e
paths; none overlaps. Codegraph reported an uninitialized index, so the reading
list below comes from repository search and direct reads.

## Files read

- `src/renderer/src/screens/conversation/composerSend.ts` — `submitMessage` mints one message id and sends synchronously.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `sendText` gates on the connected conversation host, not turn idleness.
- `src/main/index.ts` — `onCommand` routes `sendMessage` through the conversation router once.
- `src/main/daemonConnection.ts` — `createDaemonConnection` forwards typed queue, delta, and turn-end events.
- `src/main/transport/inboundMessage.ts` — `parseInboundMessage` decodes queue snapshots; generic acknowledgement does not drive a renderer resend.
- `src/preload/index.ts` — `onDaemonEvent` returns an unsubscribe handle; command and observation paths are separate.
- `src/renderer/src/store/queueBridge.ts` — `subscribeQueue` only replaces daemon-reported backlog.
- `src/renderer/src/screens/conversation/foldQueuedRows.ts` — `foldQueuedRows` correlates queue items with optimistic echoes by message id.
- `src/renderer/src/store/timelineBridge.ts` — `translateTimelineEvent` and `timelineTargetFor` preserve turn and conversation identity.
- `e2e/real-claude-queue-drop.spec.ts` — existing foreground Bash gate and cancellation coverage.
- `e2e/fixtures/realDaemon.ts` — `test`, `withIsolatedElectronApp`, and `encodePairingPayload` own isolation and process teardown.
- `e2e/real-claude-question-answer.spec.ts` — typed event observation without raw-frame capture.
- `docs/knowledge/features/composer-send.md` — Enter keeps its submit behavior during a running turn.
- `docs/knowledge/features/queue-store.md` — snapshots are replacement truth, scoped by conversation.
- `docs/knowledge/features/outbound-send-path.md` — main-process send has no retry queue.
- `docs/knowledge/features/development-verification.md` — assistant bubbles are not turn counters; e2e needs its own typecheck.
- `docs/knowledge/features/real-claude-liveness-e2e.md` — foreground file gate avoids fast-model timing races.
- `docs/knowledge/features/live-e2e-runbook.md` — actual executed specs and daemon revision are required live evidence.
- Upstream `internal/e2e/relay_v2_stream_queue_drain_test.go` — `TestRelayV2_StreamMidTurnHoldDropAndDrainInOrder` proves fake-Claude FIFO, not live-Claude delivery.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot: a fixed left tree beside a dark blue chat
pane, alternating assistant/user bubbles, and a bottom composer with action and
model controls. Keep the existing `ConversationScreen` row components, tokens,
queued marker, and drop control. This slice changes tests only, so no visual
implementation or new assets are prescribed.

## Design

Add `e2e/real-claude-queue-delivery.spec.ts` using the existing isolated real daemon
and built Electron fixture, explicitly selecting `stream-json`. Three scenarios:
one follow-up; two follow-ups in FIFO order; drop the first of two queued follow-ups
and deliver the remaining one. Keep the existing drop-only scenario and replace
its obsolete KNOWN RED header with the current test responsibility.

The initial prompt runs foreground Bash waiting on a test-owned file. Require the
tool's entry witness, a running turn, and correlated daemon queue snapshots before
releasing it. Every message requests its own unique test marker, known only from
that message. Follow-ups are submitted exactly once with Enter. Assert a single
queued row and drop control, then a single delivered user row with neither affordance.

Add `e2e/fixtures/queueTurnEvidence.ts` with a self-contained observer factory
usable both in the page and in unit tests. Consume existing typed daemon events:
record queue message ids, turn ids, event ordering, completion status, and which
test marker a turn emitted. Keep only a bounded rolling text suffix for split
markers, never serialize transcript text. A successful oracle requires distinct
turn ids, exactly one normal completion each, expected markers in submission order,
and each next turn starting after the previous completion. Observe renderer
send-command metadata in Electron main to prove there was no additional submit.

Record the exact test daemon's revision from its `version` output using the same
`PYRY_BIN`/PATH resolution as the fixture. Attach only revision, test name, queue
counts, turn counts, marker indexes and pass/fail metadata. No credentials or
arbitrary daemon text in artifacts. Unknown revision is an acceptance failure,
not an assumed match to the source checkout.

## State and concurrency

All new state is test-owned. Subscribe before the first send and bind the observer
to the UI-created conversation. Use the existing fixture's page/daemon/relay
teardown; remove observation listeners in `finally`. File writes are confined to
the fixture workdir. Positive waits establish enqueue and drop before release.
After the final completed turn and idle UI, retain a bounded settle window to
detect a duplicate or dropped turn. No sleeps determine enqueue timing.

## Error handling

Timeouts identify the failed stage: tool entry, queued snapshot, correlated reply,
or completion. A cancelled/error turn cannot satisfy normal completion. Capture
sanitized evidence even when assertions fail. Existing prerequisite skips remain
visible to the dispatcher's executed-test gate; an all-skipped run is not success.

## Testing strategy

- RED then GREEN unit coverage in `e2e/fixtures/queueTurnEvidence.test.ts`: split markers, FIFO completions, missing delivery despite queue disappearance, duplicate turns, reordered/overlapping turns, error completion, and foreign conversation isolation.
- Run only that Vitest file and `npm run build`; separately typecheck the changed e2e files and collect their Playwright test list without launching Electron.
- Dispatcher runs all three new real-Claude scenarios plus the retained queue-drop test against the dedicated daemon binary. Preserve `needs-real-claude` and report the tier count increase of three.
- No claimed live pass or selected production repair until the credentialed gate executes. If it reproduces a shared-daemon failure, link its prerequisite and retain these desktop tests as acceptance.

## Open questions

- Which stage fails in the reported setup? Pending dispatcher reproduction; the observer distinguishes accepted queue, delivered response, and completed turn.
- Does the dedicated daemon contain the failing or repaired revision? Read the executed binary's revision in every scenario; never infer it from the local checkout.

## Documentation handoff

Pending documentation stage: record the actually executed queue-delivery and
queue-drop specs, tested daemon revision, and result in
`docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state;
describe the correlated FIFO/drop proof in
`docs/knowledge/features/real-claude-liveness-e2e.md` § What it does. The ticket
contains no additional documentation-only acceptance criteria.

## Security review

**Verdict:** PASS

- Trust boundaries: observe validated `DaemonEvent` values through `onDaemonEvent`; add no production IPC or renderer capability.
- Tokens: fixture-owned pairing data stays out of assertions and artifacts; existing isolated credential lifecycle is unchanged.
- Files/storage: gate and entry-witness filenames are test constants under `daemon.workdir`; no daemon text is used as a path. Fixture cleanup removes the isolated directory.
- Electron: use `withIsolatedElectronApp` unchanged; listeners only observe command metadata and are removed on exit. No security preference changes.
- Cryptography: no changes to Noise, keys, token generation, or storage.
- Network/I/O: reuse the loopback content-blind relay and production transport. Test waits are bounded; no transport or URL-validation changes.
- Logs: retain marker indexes and counts only; bounded marker-matching text remains in page memory and is excluded from evidence. Revision output is parsed to a hexadecimal revision before attachment.
- Concurrency: one observer and one file gate per isolated scenario; unsubscribe in `finally`, with fixture-owned process-group teardown after failure.
- Threat model: production hostile-relay/daemon and renderer-isolation defenses remain unchanged. The test adds no trust in raw frames or untrusted markup.

**Reviewer:** builder self-review using `builder/security-review.md`
**Date:** 2026-09-19
