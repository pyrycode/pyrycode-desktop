# Host removal and live-state retirement

[`createThreadRuntime`](../../../src/renderer/src/store/threadRuntime.ts) owns
live chat bindings alongside the item, send, query and read-authority stores.
Confirmed deletion retires one conversation. Successful unpair retires every
scope of the departing host, including scopes without content. The protected
writer removes saved content through its existing ordered removal path.
Failed credential removal does not authorize successful-unpair cleanup, and
equal conversation IDs on another host remain independent.

## Synchronous cleanup and delayed readers

`removeHost` first marks the host departed, collects its live-store entries and
detaches all collected entries from the registry. It then disposes those stores.
Disposal synchronously publishes runtime state, so badge recounts and live
projection subscribers can call `live(host, chat)` before the sidebar clears
the departing rows. Iterating the mutable registry while disposing entries lets
these readers recreate deleted keys; with two departing rows, each can recreate
the other forever. A one-row reproduction does not exercise that loop.

While a host is departed, `live` returns one disposed, unregistered inert store
instead of adding another live entry. It has no binding, readings or effective
dispatch. Late readers therefore cannot resurrect host state. Only a new
accepted `connected` event lifts this fence for identity reuse; disconnect,
connecting and failure events do not. Runtime disposal clears the departed set.
The existing removal ordering, IPC and credential/storage operations stay intact.

The inert store is created lazily on the first departed read. Constructing it
while the module-level runtime singleton initializes reaches the
`modalBridge`/`threadRuntime` circular import before `createThreadLiveState` is
initialized. Lazy construction preserves the shared store without that startup
failure.

## Regression and evidence boundaries

`threadRuntime.test.ts` subscribes a badge-like reader to runtime changes while
removing two live rows on one host. A bounded re-entry guard makes the original
loop fail promptly. The case also checks failed removal, inert delayed reads,
equal-ID host isolation and reconnection under a reused host ID.

The enabled `e2e/unpair-unreachable-host.spec.ts` preserves the original no-pin
reproduction: two saved hosts share a conversation ID; the first has Alpha and
Gamma while Beta on the second is selected; both lists become durable; the
second host fails with code 4401; the process and original endpoints stop; an
unseeded profile relaunch restores all rows. Unpairing the first host must close
the dialog, leave Beta usable and retain responsive storage IPC. A third launch
must restore only Beta. Fixture teardown uses the existing deadlines. The old
`blocked on #2089` copy in `sidebar-pinned.spec.ts` is removed.

The [plan](../../specs/architecture/2089-unpair-unreachable-host-hang.md) and
[PR #2093](https://github.com/pyrycode/pyrycode-desktop/pull/2093) retain the
historical failing-before evidence: the original case on main `ea4ff90f` and the
new spec against unfixed code each executed/failed one test, with Confirm and
worker teardown timing out. The original verifier at `10f670c7` passed the
unpair regression with three normal exits and no teardown failures, but its
application gate failed two replay identities; both attempted
comparisons then skipped those identities after the native-writer prerequisite
failed. Those historical failures remain failed evidence.

Manual Linux x64 verification on 2026-10-20 tested clean source
`7049f002ef789c14a131082bacd14a098091dd8c`, after merging main's native-writer
and history-paging repairs. Evidence is retained under
`/tmp/manual-2089-20261020-7049f002/` on build-fractal-2.

| Check | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit gate | 9,988 | 9,988 | 0 | 3 |
| Complete configured application gate | 526 | 525 | 1 | 4 |
| Captured-client subset of that gate | 28 | 28 | 0 | 1 |
| One focused comparison with application load and native prerequisite | 5 | 5 | 0 | 0 |

Both application invocations used two configured and two actual workers, zero
runner retries and normal deadlines. The full gate's sole failure was
`message-reply.spec.ts`'s pointer/keyboard reply case, already tracked by
[#2173](https://github.com/pyrycode/pyrycode-desktop/issues/2173). It passed the
single same-tree comparison beside three passing `app-update.spec.ts` cases;
the native-writer prerequisite also passed in its configured ordering. This is
the existing fail-then-pass disposition, not a claim that the original full
gate had no failures. No test or production code changed between these runs.

The unpair case was explicitly present and passed in 3.802 seconds. Its
`launch-fate` attachment records three exit codes of zero, no signals and no
teardown failures. Both formerly blocked replay identities, history-on-open and
session-settings, executed and passed. The native proof used the real
`gnome_libsecret` backend. The cleanup-owner unit case passed among all 26
runtime cases. Pre-verify, dependency install, docs guard, build/typecheck and
sequential Node/Electron native preparation passed. No current provider/daemon
or macOS result is claimed by this client-lifecycle verification.
