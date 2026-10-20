# Thread runtime — bounded update validation

Mounted application and read-evidence validation for the
[thread runtime](thread-runtime.md).

## Bounded update validation

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2154#issuecomment-6285177896),
stage `7b3ee7f4`, records Linux validation on 2026-10-20 at `eb35b16f`.
Its exact-head production run executed/passed **4 tests, 0 failed/skipped/retried**.
All four are present and passed: `8333 finite updates keep mounted
keyboard, heartbeat, delivery and teardown responsive`, `the mounted bridge
publishes a delta-only burst with paused frames through its bounded timer
fallback`, and both `indexed history drains a buffered thread replacement on
quit/window and restores it offline` variants. Reports:
`/tmp/verifier-2154/recheck/approved-mounted.json` and `burst-evidence.json`.

After an empty completed baseline, the burst sends the original varied 8,333-item
workload once and stops. Main delivery, applied progress and mounted commits are
observed independently. Application advanced **1,530 → 2,194** while unfinished
across real keyboard input; composer state committed in **24.9 ms**, and submission
occurred at applied count 2,298. All **8,335** items, including authoritative
echo/reply, applied in **7,295 ms**; maximum heartbeat gap was **353 ms**, with
**77 mounted commits**. Exact final state, same-batch send settlement, one reply,
idle, one-second application quiescence and normal teardown passed without an
increased timeout. Shutdown fixtures advance 50 ms after positive tail receipt,
keeping the writer's 200 ms timer buffered for pre-close baseline, close drain and
offline restoration.

The [item-store tests](thread-item-store.md#testing) retain the differing counted
unit reports and the final lifecycle/correlation regression results.

The configured verifier Playwright gate executed **1 test: 0 passed, 1 failed,
522 skipped**. The native-writer prerequisite passed its isolated same-tree retry
(**1 executed/passed, 0 failed, 0 skipped**); the dispatcher accepted the
[#2125](https://github.com/pyrycode/pyrycode-desktop/issues/2125) flake. The dependent
suite was not rerun. Neither the skipped recorded-thread nor read-observer case
is a pass in that configured run.

Builder's guarded complete-thread replay at `668a6df6` executed/passed **29 tests,
0 failed, 1 existing reset-prompt fixme skipped, 0 retries/forbidden launches**.
`daemon-built thread streams, places an agent, reconnects, resets and reopens saved
items` is present and passed in `/tmp/builder-2079/rework/replay.json`. Exact-head
replay was not repeated; the verdict confirms unchanged production `src/` between
that revision and reviewed head. The earlier read-observer run at `1736d627`
executed/passed **7 tests, 0 failed/skipped/retried**, including `read setup is reused
across committed same-row deltas on short and long threads` and the hidden, queued,
uncommitted-tail and late-contract exclusions (`/tmp/builder-2079/read-fixed.json`).

Earlier failures remain failures. The installed `ad83461f` macOS probe received all
8,333 items but applied only 2,501 after 44,823 ms and exceeded teardown's budget:
a finite backlog. Initial batching still produced a 44-second heartbeat gap.
Protected storage measured a **14,314 ms** synchronous mutation and **17,187 ms**
input latency; acceptance waited for #2087/#2088. The
[item-store testing record](thread-item-store.md#testing) retains the failed
protected-coverage replay and storage rollback timeout, isolated retries and
follow-ups [#2153](https://github.com/pyrycode/pyrycode-desktop/issues/2153) (merged)
and [#2155](https://github.com/pyrycode/pyrycode-desktop/issues/2155) (open).
Initial terminal-cleanup and shutdown-visibility failures were resolved by rework. The verifier's first mounted sandbox attempt
failed all four cases at loopback setup before assertions. The
[plan](../../specs/architecture/2079-bounded-thread-updates.md#validation-and-hold)
retains earlier failed runs and artifact references.

These recorded Linux client results establish no fresh provider/daemon behavior;
none is required for this renderer repair. macOS is outside this ticket's current
verification scope. Only the docs guard runs in the documentation stage.

## Pending read validation

The [paired drain barrier and counted evidence](development-verification-evidence-that-cannot-pass-too-early.md#received-but-uncommitted-read-evidence)
cover received-but-uncommitted exclusions through native frame/timer opportunities
and completed focus/scroll publication, followed by normal commit/read progress.
