# Protected paging durability

## Files read

- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`, `mutationSteps`, `drain`: bounded acknowledged save cursor and task yields.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: serialized membership and storage admission.
- `src/main/indexedThreadHistory.ts` → `mutateThread`, `load`: protected independent save obligation and exact receipts.
- `e2e/fixtures/historyCoverage.ts` → `readHistoryCoverage`: exact ownership, limit-one authenticated coverage, five-second observation.
- `e2e/fixtures/historyQueryEvidence.ts` → `installHistoryQueryEvidence`: actual request checkpoints.
- `e2e/real-daemon-history-on-open.spec.ts` → fresh-profile trusted input walk: numeric coverage and exactly one request per input.
- `src/renderer/src/store/chatHistoryWriter.test.ts`: bounded cursors, failures, owner fencing and paused-clock regression patterns.
- `docs/knowledge/features/chat-history-api.md` → Owned authoritative mutations: unreadable is intentionally fail-closed, not proof of a pending save.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, root `CLAUDE.md`, knowledge index: guarded replay, native ABI ordering and provenance.
- Agents `docs/ticket-scope-policy.md`, `docs/working-practice.md`, `builder/security-review.md`: one repair with its directly consumed causal investigation and regression.

## Context

One historical paired macOS replay stalled after ArrowUp with protected coverage unreadable. Later unchanged replay passes did not establish cause. This ticket preserves the durable boundary and diagnoses the stalled stage before correcting it. No ADR or UI design change is intended.

## Design

Retain the existing writer, fixed IPC and encrypted store contracts. Add content-free test observations at actual query dispatch, received-page delivery/publication and bounded mutation submission/acknowledgement. Filter by exact host/conversation/epoch in memory; export only equality flags, static classifications and counts. Observe committed parts separately from queued work and failures. Preserve original assertions and captures.

Use these observations to identify the mechanism, then add a controlled regression before the correction. The correction remains local to the demonstrated persistence scheduling/admission boundary; it must not retry mutations automatically, flush for acceptance, manufacture coverage, loosen ownership, enlarge bounds or change capture inputs. Record the demonstrated mechanism and precise resulting contract in Revisions before handoff.

Scope: one independently useful durability repair with its regression, forecast 500–650 written lines, at most two production files, no new public types, at most four consumer edits, three observable acceptance criteria, fewer than ten reject branches. No separable infrastructure extraction. Overlap: feature/2153 adds resumed-startup observations in the same scenario, a different block; no dependency.

## State + concurrency model

The renderer owns the debounced serial writer and acknowledged split cursor. Main owns membership admission and atomic encrypted parts. Pending persistence remains unreadable. Existing stop/unsubscribe, host generations and explicit failure policy remain authoritative. Test observers live only for the isolated Electron lifetime and never trigger writes.

## State transitions and identity reuse

| Event | Verification |
| --- | --- |
| Repeated Home/ArrowUp | Original guarded history-on-open scenario: one request and strictly older numeric coverage each time. |
| Split submission, acknowledgement and completion | Controlled regression at the demonstrated stalled boundary plus existing writer bounded cursor tests. |
| Failed part / explicit retry | Existing bounded writer failure and indexed-history receipt tests. |
| Reset, epoch reuse, deletion, unpair, equal chat on another host | Existing writer fencing and indexed-history persistence tests retained. |
| Profile close/relaunch | Both paired scenarios and full recorded suite. |

## Error handling

Keep typed errors and pending-save unreadable. Record static failure codes without payloads, coordinates, persistence UUIDs or caught exceptions. A passing unchanged run is evidence only of that run, never a causal conclusion.

## Testing strategy

- Install dependencies, add the controlled failing regression, observe its intended failure, then correct and rerun it.
- Preserve and run coverage observer tests including split-save and bounded-read regressions; run affected writer/handler/indexed-history tests and pre-verify after final main merge, then build.
- Finish Node checks before Electron SQLite preparation. Run guarded complete-thread paired acceptance five times with fully parallel three workers, repeat-each two, retries zero, followed by full guarded complete-thread replay. Retain actual overlap, counts, complete exchanges, guard results, input provenance and build/report hashes in evidence.
- macOS arm64 only; replay establishes captured-client behavior, no new live provider or physical-effect claim.

## Open Questions

- Which exact stage stalls: queued work, submission, classified rejection, acknowledgement, or completion? Resolve from actual Electron checkpoints before choosing a correction.

## Security review

**Verdict:** PASS

- Trust boundaries: main `parseChatHistoryRequest` and paired membership remain mandatory. Observers compare exact owners internally; no new renderer authority.
- Tokens/secrets: no token or key changes; never include credentials or raw identifiers in evidence.
- File/storage: retain encrypted atomic parts under the existing protected database owner; no new storage paths or plaintext snapshots.
- Electron attack surface: no new bridge API or security-setting changes. Test-only observers must delegate unchanged requests/results and not expose Node primitives to the page.
- Cryptography: preserve existing safeStorage and authenticated owner/receipt bindings; introduce no primitive or nonce changes.
- Network/I/O: transport and guarded capture exchange remain unchanged; no network retry or deadline extension.
- Errors/logs: static statuses, part counts and owner equality only; never payloads, raw coordinates, UUIDs or exception values.
- Concurrency: MUST FIX addressed by design constraint—do not make reads bypass an unfinished obligation; diagnose and repair the demonstrated scheduling/admission cause with a controlled regression. Preserve generations and explicit retry behavior.
- Threat model: hostile daemon data still passes existing parsers, compromised renderer still passes main validation/membership, malicious relay remains Noise-protected, disk theft remains safeStorage-protected. This repair grants no new capability to any of them.

**Reviewer:** builder self-review per `builder/security-review.md`
**Date:** 2026-10-20

## Revisions

2026-10-20 — Investigation remains incomplete. No durability correction or causal regression has been selected. Added the test-only `installPagingDurabilityEvidence` observer and its integrity tests. It delegates requests/results unchanged, compares exact coordinates internally, numbers persistence identities locally, and exports static statuses, counts, equality flags and numeric coverage. `pendingSaves` counts acknowledged prefixes awaiting their acknowledged final part; it does not inspect protected headers. Batch publication diagnostics are explicitly unscoped. Neither those diagnostics nor passing replays complete acceptance criterion 1.

The initial eight batches used an inline observer. The extracted observer additionally records safe persistence ordinals, acknowledged-prefix counts, numeric starts and unscoped batch-publication diagnostics. Its tests cover owner filtering, unchanged delegation, idempotent installation, content exclusion, classified failure before any commit and classified failure after an acknowledged prefix. These are observer-integrity tests, **not a failing-before durability regression**. The initial missing-module test run executed zero tests and is not product-failure evidence.

After the eight current-main batches, temporarily applied the exact historical status-replay change from `1dd48a53536f1fbdae4e049c49e3ef583472dcea`. `git diff 1dd48a53536f1fbdae4e049c49e3ef583472dcea -- src/preload/index.ts` was empty. Five further paired batches passed. Their main, preload and renderer bundle hashes match the historical failed execution; only build provenance differs. Removed the temporary preload change afterward using a patch; the final production diff is empty. This experiment neither attributes the historical failure to preload nor establishes inheritance.

The open question remains unresolved: the historical report has no submission/acknowledgement checkpoints, while all newly instrumented runs passed without a classified mutation failure. Do not replace that missing evidence with an invented mutation retry, forced flush, completion certificate or relaxed timeout. The next repair attempt still needs an actual failing trace, exact scoped publication/queue evidence as necessary, a demonstrated mechanism, a controlled failing-before regression, its correction and post-correction acceptance. No PR claiming a completed repair is justified by this partial state.

## Diagnostic evidence — macOS arm64, 2026-10-20

Artifacts are under `/tmp/builder-2191/`. All rows below are **pre-correction diagnostic runs**. Each selected both original named cases, twice, with `--profile complete-thread --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json`. Each executed/passed 4/4, failed/skipped 0/0, configured workers 3, actual overlapping workers 3 and retries 0. Each guard reported zero forbidden launches. Each exchange completed: the two history instances matched 32 requests/emitted 63 frames/remaining 0; the two thread instances matched 45/emitted 378/remaining 0. Total: 52 executed/passed, no failed or skipped cases.

| Report stem (`.json` / `.log`) | Report SHA-256 |
| --- | --- |
| `diagnostic-paired` | `7254bae5d59609265068fa0e51004b25a138c8c81a3a207e40e465f0d86536f2` |
| `diagnostic-paired-2` | `870ba4c467b3c2d51c65485c119f536f1ccb68272a0488ae0302499dc41222e8` |
| `diagnostic-paired-3` | `25f1015d44f26b04734ab1ffd99c286c8d3b5ff99ec63863d4c30f39b6510973` |
| `diagnostic-paired-4` | `82583fbc67ee1596dd4566b2266aedd1b1484cdf12f613f6ba91312f5781b09d` |
| `diagnostic-paired-5` | `82a5dca69331c2f8aea84830e8135dcc9f621a73652560918f2140460c0a0797` |
| `diagnostic-paired-6` | `a368e01da05a743db05e7a84d0b46539e2ccc863628404d3143ca7ad48d55afc` |
| `diagnostic-paired-7` | `75128884b481be7da330d072e2f47ddf08ccbbb09b951eda6303e045b0046b8c` |
| `diagnostic-paired-8` | `6f7345e31eacab7e18778cdab3c0d59be2f1e9c67827cb8bbee9c68846e0ef49` |
| `historical-status-1` | `af54dba3e84ae38518d869251654248e4e9fd061043d3d22efa84b4df8433e63` |
| `historical-status-2` | `ce889d91a3ccbae3248407143cd874c8098d98227aaaded671af3aa1c80c4e29` |
| `historical-status-3` | `0dbc462148d0765775f7aad3afd0ccaf7be8941f07c24b2625790bbab43faf36` |
| `historical-status-4` | `122e2e70473c349e2c8900dffd5e1e52163b0e42b5239470c7fe2369c95c5bcf` |
| `historical-status-5` | `7155c15b902c697b9a4f571ee8d7e9e8b2994039af46a758e63b6f3ba86895c9` |

All thirteen builds report revision `827da28058eb28077eaa63da85e4ddc1dd0a2c97`, dirty `true`, profile `complete-thread`. The first eight use main's preload; the last five use the temporary historical preload. Shared executed-bundle SHA-256 values:

| Bundle | SHA-256 |
| --- | --- |
| `out/main/build-provenance.json` | `1d3e629f101261821f7489e4228d8e5caf8e17d7178a55e3ddb5ad557fdc4c03` |
| `out/main/index.js` | `0392503cdc7b6934daebc336f9ec6d5aa3cac5f4f6a24678b29c5e165efdf12c` |
| `out/preload/hosted.js` | `0edfdf2d3ed72973e0fc022b780f8c6229917542064a05d710219aece09cbf42` |
| `out/preload/index.js`, current-main phase | `0430e6aac5d4c276ae9e2d22447431b4c388c5e1bd68dbe3c7a7d9bada0d4df7` |
| `out/preload/index.js`, historical-status phase | `53308858d05c0214442e57352e65e79b7fef59670546a02eec4b4d1e08317080` |
| `out/renderer/assets/index-CsfLv1rn.css` | `e2228755fdff34ced77591a0f2cb7cd82892583e6f76a0667a4071434200c2a9` |
| `out/renderer/assets/index-DcezsYbc.js` | `a4af507c6686bb7f07d5b483ddc5ca71d79f8777a6198df60d60e794e3a04c5c` |
| `out/renderer/index.html` | `1f4cd1d53c99e9bfeb2486fc0377e5a19bd4aa498b91eb7068b0dc174d170436` |

Every report retains both `replay-input` attachments. History input SHA-256: `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`, captured `2026-10-16T12:30:09.805Z`, Claude not spawned. Thread input SHA-256: `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`, captured `2026-10-16T12:29:37.005Z`, Claude `2.1.280 (Claude Code)`. Both capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA-256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. Capture bytes, original assertions, input counts and strict exchanges were unchanged. No build or native preparation overlapped replay.

Earlier failure retained separately: `/tmp/builder-2153/accepted-paired-2.json`, SHA-256 independently verified as `85603ed8c9e1391c5e561f4005728c2df465187f3a8ba95e683e2baf87c43c12`, 4 executed/3 passed/1 failed. Its historical unreadable failure remains unexplained. No result here changes that failure or the separate #2190/Linux observations.

Targeted Node checks: `targeted-node.log`, 144/144 passed across coverage (28), writer (27), handler (8), indexed storage (79) and initial observer integrity (2). Node checks finished before the historical-phase Electron preparation; builds/preparation/replay were sequential. The final observer integrity test adds a second failure-prefix case. The full post-correction suite and controlled durability regression remain outstanding because no correction exists.

Counted redacted summary: `/tmp/builder-2191/diagnostic-summary.json`, SHA-256 `79af4801d8cac38257a9c4eb084aa269e6bce918da5a374488eb670687505616`. It independently checks every result, retry, three-worker time overlap, exchange completion, launch guard, input checksum and build identity across all thirteen reports. All 1,326 scoped mutation submissions were acknowledged successfully. The original failure cannot be classified from that absence of new failures.

Final pre-verify (`pre-verify-final-approved.log`) passed all five checks, including the live issue-label security check and all three final observer-integrity tests. The first sandboxed invocation passed its other checks but skipped the unavailable label read; the approved rerun supplies that check. `npm run typecheck:client-tests` passed (`client-typecheck-final.log`). Main merged and checked: `ebe063cfd561`. Final scope remains below the ceiling: approximately 400 written lines including investigative edits, one exported test helper, two consumers, no production types/state or production algorithm changes.
