# Independent traversal of unchanged protected saved threads

## Files read

- `src/renderer/src/store/threadRuntime.ts` → `createThreadRuntime`: selected lifecycle, restore and sole network coordinator.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`: bounded protected IPC admission.
- `src/renderer/src/store/threadItemStore.ts` → `beginLocalRead`, `restoredProgress`: revision, progress and ownership fences.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `demandHistory`, `ThreadItemsTimeline`: near-top input, stable row anchors and retry presentation.
- `src/main/indexedThreadHistory.ts` → `mutablePage`, `readPage`: authenticated held-rank pages and opaque generation tokens.
- `e2e/daemon-item-cache.test.ts` → `cache`: fresh protected owners and real writer integration.
- `e2e/thread-activation.spec.ts` → held restore scenario: mounted scripted transport and production route.
- `src/main/indexedThreadHistory.test.ts` → bounded-opening counters: selected protection work versus structure work.
- `docs/knowledge/features/chat-history-api.md` → Bounded authoritative opening and pages: opening closure is not a complete held window.
- `docs/knowledge/features/thread-item-store.md` → Snapshots and completed batches / Certified older paging: hydration grants no certification or owned save.
- `docs/knowledge/features/chat-history-testing-restoration.md` → Restoration: positive held-reply barriers and cleanup races.
- `docs/knowledge/features/chat-history-testing-native.md` → Native runtime and packaged proof: Node/Electron ABI preparation and packaged checks.
- `docs/knowledge/decisions/0014-authenticated-owned-thread-mutations.md`: only owned writes advance durable facts.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Design context and screenshot read. Preserve the fixed sidebar, filling conversation pane, existing message rows and input footer. Reuse existing loading and retry components and theme tokens without styling changes.

## Context

Shown-only opening omits hidden/newer held content; its before token cannot enumerate that omission. Local demand must work independently of the coordinator's pending, failed and disconnected states. This slice covers unchanged saved generations; mutation recovery remains #2064. No ADR is needed.

## Design

Extend this consumer's bounded reader to accept an explicit newest/before demand and report a static outcome. Opening remains unchanged. The first local traversal demand starts at `newestThreadPage`, irrespective of opening continuation or old dependency positions, then follows only that traversal's opaque tokens. This intentionally overlaps opening facts and guarantees every held identity is visited, including hidden tails and null-opening-continuation cases.

Extend `beginLocalRead` with explicit held-scope admission. Retain the slice generation and existing restored marker/no-write contract. Merge compatible highest revisions, admitted facts on ties, and sparse saved arrival positions across pages before deriving stable numeric placement/ties. Held-page admission retains resident metadata/progress and unions only supplied saved ranges; it cannot certify holes, clear repair or change older availability. Opening's delayed-live progress folding remains intact.

Keep traversal continuation separately in residency: undefined means traversal has not started, null means locally exhausted. Runtime local state uses the existing loading/failed/idle shape in a separate map. One selected lifecycle owns at most one local read; repeated upward input coalesces. Failed local demand requires explicit retry. Only an already-exhausted local traversal delegates a later demand to the existing coordinator. UI input reaches runtime offline, and local loading/failure takes precedence in the existing presentation while network state remains independently retained.

No main/storage/token/wire changes, new writer, legacy reader or renderer disk access. Remote feature overlap scan found none for the planned files.

## State + concurrency model

Runtime selection owns local read cancellation. The item-store private read token fences admission across awaits, reset, epoch replacement and cleanup. Same-lifecycle live/network publication preserves it. Runtime publication also checks selection and generation; a retired result cannot publish failure. Navigation cancels pending local work without deleting resident content. No automatic retry or token recovery.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Repeated upward input / retry after local failure | `traverses newest despite null opening token, coalesces, retries locally and exhausts offline` |
| Fresh protected reopen and opening omissions | `fresh protected traversal reaches every fragmented saved identity including opening omissions without writes` |
| Delayed page overlapping newest/live/network facts and progress | `merges sparse arrivals, full revisions and clears without certifying or saving hydration` |
| Navigation and return using identical strings | `fences delayed local errors after %s` |
| Epoch replacement / same-epoch reset / delete / unpair / clear | `fences late held-page success after %s with reused strings` |
| Saved mutation invalidates next token | protected traversal restart test above, stale-token assertion; no recovery |
| Local exhaustion / fragmented network boundaries | `loads saved pages independently of a %s server reply and keeps fragmented paging at 900` |
| Mounted held/offline scrolling and row offset | `unchanged saved traversal scrolls independently while server reply is held` / `unchanged saved traversal scrolls independently offline` |

## Error handling

Retain bridge classifications for unavailable protection, invalid continuation, unreadable disk and IPC failure. Invalid results never remove valid facts. Local errors remain explicit until retry and never spin. No error text, saved content, opaque tokens or coordinates enter logs.

## Testing strategy

Write failing local-demand and held-admission units before implementation. Extend protected restart fixtures to compare complete content/order and unique ids after traversal, with real storage and no hydration writes. Extend the existing mounted held-reply fixture for near-top input, coalescing and anchor offsets, including offline traversal. Reuse indexed counters for bounded selected reads/decrypts and separate structural growth/conversion. Preserve packaged production-encryption proof. Run Linux pre-verify, build, complete configured fake suite including packaged storage; record revision/counts/timings. Other OS and live Claude are outside scope.

## Open Questions

None. A newest-first held pass is simpler than changing opening/token formats and keeps completeness independent of opening closure.

## Security review

**Verdict:** PASS

- [Trust boundaries] Reuse `parseChatHistoryRequest`, paired-host handler and `threadHistoryCodec.page`; selected host/conversation and accepted epoch remain checked before admission.
- [Tokens/secrets] Opaque existing protected continuation only; no secrets or token contents in renderer persistence or diagnostics.
- [Files/storage] Existing main-owned database, authenticated indexes and production `safeStorage` adapter; unavailable protection fails closed. No new paths or writes.
- [Electron surface] Fixed bounded page allowlist (1–200); no new channel, Node primitive, remote content or window preference change.
- [Cryptography] Reuse existing encryption and authenticated structures; no primitive, nonce or Noise change.
- [Network/I/O] Existing coordinator alone sends network paging; local exhaustion grants no completeness or cursor authority. No new network endpoint or timer.
- [Errors/logs] Only static lifecycle/error classifications, never saved text, token, key, raw IPC errors or decrypted bytes.
- [Concurrency] MUST FIX addressed by design: held-page read tokens retain exact lifecycle ownership, cancellation and same-string reset fences; late errors also require runtime ownership.
- [Threat model] Malicious saved input is validated and authenticated in main. Compromised renderer receives only bounded typed pages and opaque tokens. Relay delay cannot block local demand; daemon parsing and transport security remain unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16

Sizing: one traversal deliverable; forecast 260 production + 365 tests/helpers + 95 plan/log lines = 720 written lines, no new exported abstraction, at most 6 consumer sites, five observable criteria, at most eight reject branches.

## Revisions

2026-10-16: Extend the existing packaged 801-item fixture to enumerate all held pages after protected reopen, and the existing indexed opening counter fixture to measure a 200-item held traversal page separately. No storage contract change. Mounted fixtures reuse `heldThreadRead` with an operation and skip count to hold the final insertion and compare the visible row offset. Actual implementation remains below the forecast.

2026-10-16: The complete fake suite exposed the existing four `no-op ... on a short offline thread keeps following row growth` regressions after removing the connectivity guard. `query` now returns whether local demand started or network demand is eligible; the scroll pin restores prior following intent when input has no upward range and no accepted demand. The existing no-op specs remain unchanged and must pass alongside the new offline traversal cases.

## Validation evidence

Linux x64, 2026-10-16. Implementation `58953c28970b4d81e8ee7d361110a1b2b22bfdc8`, repair `b3a26802a30dc4061752a90d12d323fb9055e2eb`, main `b0a88c6f5369`. Final repaired pre-verify passes all five checks: 393 files passed, 9,159 tests passed, 0 failed, 3 existing opt-in skips (`/tmp/builder-2063/pre-verify-repaired.log`). Build and docs guard pass. Prior complete pre-verify has the same counts (`/tmp/builder-2063/pre-verify-final.log`).

- Complete original configured fake run on implementation: 438 executed, 434 passed, 4 failed, 3 macOS-only skips, 0 flaky, two configured workers, original clipboard/parallel projects and zero retries. `/tmp/builder-2063/fake-suite.json` and `.stderr`; global errors and fake-daemon-setup attachments both empty. Failures were exactly the four short-offline no-op following cases described above.
- Repair: all four failures plus both new held-reply/offline traversal cases reran and passed: 6 executed, 6 passed, 0 failed/skipped (`/tmp/builder-2063/repaired-fake.json`). Supporting runtime/helper units: 42 executed/passed. The dispatcher's complete fake gate remains pending on the repair; the historical red run is not a green complete-suite claim.
- Packaged production-encryption case in the complete run: 1 executed, 1 passed, 0 failed/skipped. `/tmp/pyry-history-native-76tJMf/runtime.stdout` and `.stderr` inspected: Electron 33.4.11 / Node 20.18.3 / SQLite adapter 12.4.1; `gnome_libsecret`, packaged/ASAR/unpacked true, stage complete. Exact 801-item held traversal follows fresh opening; conversion 3,855 ms, cold opening 126 ms. The 100,000-membership persistence fixture also passed. Stderr retains system-bus/GPU/network-service diagnostics, not a failed storage assertion.
- Protected restart fixture: 650 identities (250 shown, 400 hidden, including unordered content and an old active dependency), exact content/order and resident uniqueness, independent ranges `[100,200)` / `[900,1000)`, fresh-owner token reuse and stale-token classification. Hydration is marked restored and emits no write.
- Mounted 1100×773 held/offline captures inspected under `/tmp/builder-2063/repaired-results/`, each traversal case's `saved-traversal-held.png`. Existing sidebar, pane, footer and notices match the unchanged layout reference. Exact anchor offset, coalescing and zero additional read acknowledgements/network pages pass.

Authenticated work measurements from complete units separate selected work, structure and one-time conversion:

| Fixture items | Opening records / payloads / decrypts | Opening structure | Opening cold / conversion ms | Traversal records / payloads / decrypts | Traversal structure / cold ms |
| ---: | --- | ---: | --- | --- | --- |
| 262 | 206 / 202 / 408 | 1,583 | 369.2 / 2,716.8 | 203 / 200 / 403 | 282 / 255.1 |
| 1,242 | 206 / 202 / 408 | 1,992 | 408.6 / 13,706.5 | 202 / 200 / 402 | 262 / 164.4 |

Timings establish no latency threshold. Other operating systems and real Claude are outside this ticket's verification scope. No native fleet task or live test was introduced.
