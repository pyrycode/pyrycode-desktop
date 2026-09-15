# 1502 — a shared e2e read that tolerates a transient loss of the inspection context

## Files read

- `e2e/chat-history-recording.spec.ts` → the test *"confirmed deletion removes saved content through
  restart without waiting for a list refresh"* — the two `__conversationRemovals` reads that flake,
  and the counting wrapper `app.evaluate` that must stay a single un-retried call.
- `e2e/pairing-authentication.spec.ts` → `readAuthentication` and `control` — the #1380 shape this
  ticket lifts into a shared module, including the comment that carries the rule.
- `e2e/fixtures/daemonCapabilityGate.ts` / `daemonCapabilityGate.test.ts` → `decideCapabilityGate`
  and its `describe` block — the existing shape for a pure harness decision covered by vitest beside
  the fixtures, and the precedent for what a harness module's commentary is expected to carry.
- `vitest.config.ts` → the `include` glob (`e2e/**/*.test.ts`) and `playwright.config.ts` →
  `testMatch` — the two halves of the suffix invariant that lets a `.test.ts` live under `e2e/`.
- `e2e/fixtures/launchPairedApp.ts` → `PairedApp` — where the spec's `app: ElectronApplication`
  comes from.
- `docs/knowledge/features/pairing-input-screen.md` § "Edge cases and limitations" → the recorded
  rule: reads may retry the transient error, mutations still fail.
- `docs/knowledge/features/e2e-harness.md` § "Two-way separation from the vitest unit run" and
  § "Desktop isolation" → the tier's standing position on flakes: fix the cause, and where a flake
  has no fails-on-main reproduction, prove the fix's decision instead of racing it.
- `docs/knowledge/features/chat-history.md` § the `chat-history-recording.spec.ts` paragraph → what
  the confirmed-deletion scenario is there to prove, so the edit cannot weaken it.

`codegraph_context` was unavailable in this worktree (`.codegraph/` is present but empty —
"CodeGraph not initialized for this project"), so the reading list above came from grep and Read.

## Context

`e2e/chat-history-recording.spec.ts`'s confirmed-deletion test reads a main-process counter through
`app.evaluate`, and that read intermittently raises Playwright's
`Execution context was destroyed, most likely because of a navigation.` while the app is demonstrably
alive — the `launch-fate` attachment on the observed failure reports `runningAtOutcome: true`,
`exitCode: 0`, no teardown failures. Off CI `retries` is `0`, so one such read turns a green branch
red with no `flaky` line.

The direction is already settled in this repo: #1380 hit the identical error on the identical kind of
read and tolerated it on *reads only*, in `readAuthentication`. This ticket applies that fix at the
second site and, because the race does not reproduce on demand, makes the discriminating behaviour
provable without it — a shared module whose decision is covered by vitest, the
`daemonCapabilityGate.ts` / `daemonCapabilityGate.test.ts` shape.

No `src/` file moves, so no production behaviour changes. Migrating `pairing-authentication.spec.ts`'s
private copy onto the shared helper is explicitly out of scope; it is green, and the repo rule is to
touch only what the task needs. This is harness wiring with an existing recorded rule behind it, not
an architectural choice — no ADR is warranted.

## Design source

N/A — harness-only change. No renderer, CSS or user-visible surface moves, so the verifier's
visual-fidelity check is intentionally skipped.

## Design

One new module, `e2e/fixtures/mainProcessRead.ts`, with two exports.

- `NOT_YET_AVAILABLE` — a unique sentinel standing for "this read did not complete because the
  inspection context was transiently gone". A distinct value rather than #1380's `null`, because the
  helper is shared: a future caller reading a nullable value must still be able to tell a real `null`
  from a lost context, and the sentinel makes that free.
- `readMainProcess(app, read)` — awaits `app.evaluate(read)` and returns its value; on an error whose
  message carries Playwright's transient `Execution context was destroyed` text, returns
  `NOT_YET_AVAILABLE` so an `expect.poll` caller polls again. Every other error rethrows unchanged,
  immediately.

`app` is typed as a one-method structural type naming only the `evaluate` this helper uses, not as
`ElectronApplication`. That is what lets the vitest cover drive the whole wrapper — success,
transient, fatal — with a plain stub, instead of covering only a predicate and leaving the branch
that returns the sentinel unproven. `ElectronApplication` satisfies it structurally, so the spec
passes its real `app` unchanged.

**Reads only.** The helper carries #1380's rule in a comment at the top: a control action must never
be replayed, because a retried mutation is a second mutation. Nothing in the type system enforces
that, exactly as in `readAuthentication`; the comment is the enforcement, and this module is where a
third site will look for it.

## State + concurrency model

None added. The helper is stateless and holds no timer, socket or subscription; the only concurrency
is the single `await` it already wraps. Bounding the retry is the caller's job and stays visible at
the call site: both polls in the spec pass `{ timeout: 5_000 }`, the bound #1380 used, so a genuinely
dead app fails inside five seconds instead of waiting out the test timeout.

## Error handling

Two branches, and the split is the whole point of the module:

| Raised by `app.evaluate` | Result |
|---|---|
| An `Error` whose message contains `Execution context was destroyed` | `NOT_YET_AVAILABLE` — the caller polls again |
| Anything else, including a non-`Error` throw | rethrown unchanged, at once |

The match is on the message substring and on `error instanceof Error`, the same test
`readAuthentication` makes. A thrown non-`Error` therefore takes the fatal path, which is the safe
default: an unrecognised throw is not evidence of a transient context loss.

## Changes to the spec

Three lines of the confirmed-deletion test, and nothing else in the file:

- A local `removals` thunk closing over `app`, calling `readMainProcess`.
- The pre-deletion `expect(await app.evaluate(…)).toBe(0)` becomes
  `await expect.poll(removals, { timeout: 5_000 }).toBe(0)`. Polling does not weaken it: the counter
  only ever increments, so "polls until 0" and "reads 0" differ only in tolerating the transient.
- The post-deletion poll keeps its shape and gains the same bound and helper. Its previous implicit
  bound was Playwright's 5000 ms `expect` default, so the explicit `5_000` is the same wait.

The `app.evaluate` that installs the counting wrapper over the `pyry:chat-history` handler stays a
single un-retried call — it is a mutation, and replaying it would wrap the wrapper.

## Testing strategy

`e2e/fixtures/mainProcessRead.test.ts`, a vitest `.test.ts` under `e2e/` beside the fixture it
covers, following the suffix invariant (`vitest.config.ts`'s `include`, `playwright.config.ts`'s
`testMatch`). It drives `readMainProcess` with a stub evaluator, so acceptance never depends on
reproducing the race. Scenarios:

- A read that resolves returns its value, untouched — including a falsy `0`, the value the spec's
  pre-deletion assertion actually expects.
- A read that throws the exact observed message returns `NOT_YET_AVAILABLE`.
- A read that throws any other `Error` rethrows that same error — proven by identity, not by message.
- A read that throws a non-`Error` rethrows it too.
- `NOT_YET_AVAILABLE` satisfies neither of the spec's two assertions: it is not `0` and not `1`, and
  it is distinct from `null` and `undefined`. This is AC4's "a not-yet-available read satisfies
  neither assertion" made into an assertion rather than a claim.
- The read function is passed through to `evaluate` unchanged, so the helper cannot silently
  substitute what is being read.

The Playwright side is the confirmed-deletion spec itself, run with `npx playwright test
e2e/chat-history-recording.spec.ts`. Per the ticket's technical note, the spec is not looped to
reproduce the race — the vitest cover is the proof of acceptance, and the full `npm run e2e` is the
verifier's deterministic gate.

## Open questions

- Does `ElectronApplication` satisfy the narrow structural evaluator type? `e2e/` sits outside both
  `tsconfig.node.json` and `tsconfig.web.json`, and neither vitest nor Playwright typechecks, so no
  gate would catch a mistake here. Resolve by running `tsc --noEmit` over the three files once during
  implementation; if it does not hold, the helper takes a thunk instead and the spec closes over
  `app` at the call site. Record the outcome under `## Revisions` if the shape changes.

## Documentation handoff

The ticket body has no **Documentation handoff** section and no documentation-only acceptance
criterion. Pending for the documentation stage, from this plan rather than from the ticket:

- `docs/knowledge/features/e2e-harness.md` — the shared transient-read helper and the reads-only
  rule now have a second site and a home; today the rule is recorded only in
  `docs/knowledge/features/pairing-input-screen.md` § "Edge cases and limitations", under the pairing
  screen, which is not where a third caller would look.
- `docs/knowledge/features/chat-history.md` § the `chat-history-recording.spec.ts` paragraph — the
  confirmed-deletion counter reads are tolerant and bounded at five seconds.

No file under `docs/knowledge/` is touched by this ticket.
