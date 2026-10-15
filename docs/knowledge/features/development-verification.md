# Development verification

Shared lessons for refining, building and reviewing Pyrycode Desktop.
These were brought across from the active local-memory index on 2026-09-11.
Check current code before applying an observation about a particular implementation.

| Topic | Reference |
| --- | --- |
| [What each test tier proves](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves) | Static, mounted and live proof boundaries, with counted regression evidence. |
| [Evidence that cannot pass too early](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early) | Positive processing barriers and nonvacuous absence assertions. |
| [Layout and input](development-verification-layout-and-input.md#layout-and-input) | Measured layout, native input, focus and capture verification. |
| [Live-test diagnosis](development-verification-live-test-diagnosis.md#live-test-diagnosis) | Executable identity, credential ownership and counted live evidence. |

## Source and contract checks

Search the source and its production callers before estimating a change.
Search both `src/` and `e2e/`. If the code graph reports that it is not initialized,
use text search and file reads. An unavailable index is not evidence of no callers.

Comments wrap across lines. Search the concept as well as the identifier.
Removing the final consumer can invalidate comments that never name it.
A contract inherited from another consumer needs checking against the new sinks.
An untrusted string used as a Map key does not have the prototype behaviour of an
ordinary object key. Review the actual data structure.

The daemon's handling of unmatched event types differs from its explicit ignored
list. Read the individual dispatch arms before generalising a phrase across them.
On the client, trace the actual inbound parser rather than trusting an old symbol name.
A shared model-row lookup can govern behaviour as well as display text.
Read all callers before broadening what an empty identifier means.

## Authoritative thread read evidence

Renderer units are static `renderToStaticMarkup` in Node: they prove markup and pure decisions,
not effects, focus, scrolling or publication. The existing `rendererFixture` in
[`e2e/thread-items.spec.ts`](../../../e2e/thread-items.spec.ts) supplies route, immutable
snapshot, summary, completion and reader inputs to the inactive item view. Keep
`ConversationListData` mounted when replacing `App`; writing a mark directly into the list
store does not test received owning-daemon confirmation.

Assert three boundaries separately: renderer publisher attempts with host/conversation/target,
wire commands recorded by the fake daemon, and received marks reflected through the mounted
receipt bridge. Main can refuse a host-qualified attempt when two connected hosts claim the
same conversation ID. Fake `conversation_updated` acknowledgements must correlate with the
recorded wire request; also exercise unsolicited late marks. A below-target clamp stays
pending, while a confirming mark retires it. Neither a successful send nor an attempt count
establishes acknowledgement.

Fence absence assertions with positive callback/processing and React-commit barriers. For the
pre-commit race, receive a same-row append and newer summary, trigger focus/scroll/list probes
before committing, then show that only committed complete visible content permits the newer
target. Receipt/list output must commit before checking exclusions after clamps, epoch/host
replacement, deletion or owner loss, with the observer still mounted. Cover blur, reader,
above-tail/chrome overlap, collapsed descendants, hidden trailing items, shown unordered/queued
items, older/incomplete/abandoned batches and repair fences. A poll that immediately sees no
command can otherwise pass before any input reaches the consumer.

History fakes need the same ownership discipline. In
[`e2e/tool-groups.spec.ts`](../../../e2e/tool-groups.spec.ts), keep the quiet conversation's
history request pending and positively observe it before returning to the seeded chat. Capture
requests by host/conversation and answer the seeded request, then wait for its historical child
to commit before asserting the finished marker. One shared latest-request slot can reply to the
wrong chat because main correlates replies by request ID and suppresses repeated pending asks.
Reply to `list_conversations` with the current roster, retaining the single-row launch seed and
both rows afterwards; a catch-all one-row list response can silently remove quiet ownership.

The [final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1965#issuecomment-6188903924)
records the configured Linux gate on `20d0f07140931f3f0aaad4977f6a186c5f761727`, 2026-10-15:
`npx playwright test --reporter=json` ran **407 executed, 407 passed, 0 failed, 3 skipped,
0 flaky**, with four workers, clipboard/parallel projects and zero retries. All 12 thread-items
and 6 tool-groups cases were present and passed, including both 1280/800 variants of
`publishes only committed visible authoritative read evidence` and
`connect roster Agents appear before history and keep identity through live and historical launches`.
The three skips are macOS-only badge/window lifecycle cases. Units recorded 10,279 executed/passed,
0 failed, 3 skipped across 405 passing files. Install, docs guard and build passed; pre-verify
recorded 3 passed and 2 deliberately skipped by `--no-suite`, with typecheck subsequently in build.
These results supersede the earlier red complete gates; a focused pass or a baseline comparison
alone did not satisfy that full-suite requirement.

Separate native/macOS evidence for older candidate `ddb9bce8db99546129037f00713b753f603562d9`
remains unverified and handed to the dispatcher: task
`400bbaf6852f5e7efa8c860719fcf81552c8014a58142a12f66936d55fa14a07` has no verified result
in the verdict. Any result needs its own revision/configuration, executed/failed/skipped counts,
named cases and setup-attachment review before native acceptance. Replacement-epoch captures at
1280×773 and 800×773 show existing bubbles and copy/reply controls; the supplied fixture omits
the surrounding sidebar/top/input chrome, so they do not prove integrated chrome fidelity.
No real-Claude/live-daemon test ran or was required for this supplied seam. Production
activation and combined live proof remain [#1908](https://github.com/pyrycode/pyrycode-desktop/issues/1908).

## Review and document hygiene

The pipeline uses one GitHub identity. A reviewer cannot approve or request changes
on its own account's pull request. Post the verdict as a comment and use the role's
issue labels. Keep the issue number separate from the pull request number.

Scratch directories keyed only by pull request can contain an earlier rework run's
review. Read existing evidence and use a distinct file for the new verdict.

Inspect the end of every added Markdown document for tool-call scaffolding.
The documentation guard scans feature docs and cannot prove that every changed
Markdown file is clean. A successful rendered preview can also hide stray tags.

CodeGraph's existing ignore patterns do not cover every runtime artifact. Check
`.codegraph/codegraph.lock`, `.codegraph/writer.pid`, `.codegraph/codegraph.db-shm`
and `.codegraph/codegraph.db-wal` against both the tracked diff and
`git check-ignore -v`; an ignored file can still be tracked. Repository-local Git
exclusions keep these generated lock/PID and mutable SQLite sidecar files out of
automatic commits while preserving the running index's local files.

A listener-count warning may predate the change. Compare against the base before
calling it the cause. Browser console events need explicit collection when the
existing fixture does not forward them.
