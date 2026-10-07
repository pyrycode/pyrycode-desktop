# History admission and protected-restoration verification

Part of [Development verification](development-verification.md). History coverage
and display retention require separate assertions; a green receipt-only repeat
cannot prove that a split reply or orphan tool result survives restoration.

### Served-page persistence verification

Parser/store regressions in `inboundMessage`, `historyPageBridge`, `chatHistory`,
`chatHistoryWriter`, `chatHistoryStore` and `finishedAgentHistory` cover skipped ids,
admission, strict metadata, protected restoration/allocation, host lifetimes and
immutable finish evidence.

The [final verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1852#issuecomment-6035527996)
at `ea4d7d35` on 2026-10-07 records units: 9,329 executed/passed, 0 failed,
3 skipped; no per-test unit counts supplied. Dispatcher gate 6
(`npx playwright test --reporter=json`): 332 executed/passed, 0 failed, 4 skipped.
It confirms these named browser cases were present, executed and passed:

- `a correlated repeated served page contributes assistant and tool rows only once`
- `receipt saturation still saves a repeated page and later live content across fresh relaunches`
- `records received content, drains buffered quit, and reads locally after relaunch`

Scoped counts: history-walk 3 executed/passed, 0 failed/skipped; recording
8 executed/passed, 0 failed, 1 window-close platform skip. Assistant/tool counts defeat
user-message-only suppression; asking from the updated cursor proves repeat
settlement before absence checks. Cancelling an echo retains content/keys with
advanced allocation; whole-snapshot equality would stop quit/relaunch proof early.
This is fake transport; no live-Claude run was required or performed.

### Known-gap recovery verification

`historyGaps.test.ts` exercises admission, one-entry/multi-page and older holes,
newest high-water overlap, adjacency, first opening, skipped ids, saved-position
fallback, covered/empty steps and independent held `atStart`. It also covers
strict gap parsing/allowlisting, fresh restoration, receipt expiry and structural
host/removal/eviction lifetimes. The writer's metadata-only regression saves and
restores cursor progress without pending/failure state. Static `Timeline` tests
place a marker inside joined text before its whole bubble and check count-free
idle/loading/failure copy and Retry gates; they do not exercise input or effects.

Fixtures must separate served envelope ids from command ids and drawable rows.
Sparse synthetic ids can create real gaps once coverage is held, diverting reader
input from an intended oldest-end ask. Declare consecutive envelope coverage,
including undrawable entries, when no gap is intended, and explicitly allow
optional `gaps: []` in protected snapshot expectations. Demand tests must fail one
of two gaps and then ask the other, also after newest/oldest and nonretryable
failures: a global failure guard would pass a single-gap Retry test while blocking
healthy boundaries.

[`history-gaps.spec.ts`](../../../e2e/history-gaps.spec.ts) →
`known gaps require fresh input, retain failure/resume, anchor and expansion through protected restoration`
checks chronological marker placement, overlay visibility, thread-focus/trusted
input, pending-input exclusion, no settlement cascade, loading/failure/Retry,
expanded-tool retention and content-anchor geometry. It polls the protected gap
cursor before reloading the renderer, then verifies a newest overlap leaves the
restored walk intact and fresh input uses that cursor. This is a fresh renderer
over protected storage; full Electron exit is established by the live proof below.

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1881#issuecomment-6048495036)
and supplied dispatcher report record gate 6 at `609a8ba87db3520fc306b07daa626b18a598856d`
on 2026-10-07: 350 executed, 350 passed, 0 failed, 4 skipped. The verdict confirms
the named fake gap test above was present, executed and passed, along with all
eight repaired persistence/Retry/tool/Agent/status regressions. Units/build passed;
no per-test unit artifact was supplied, so source coverage is not an individual
unit-result claim. Visual review accepted idle/failure at 800×600 and completion
at 1280×800 against Figma `132:4171`; loading status was verified by interaction,
without a separate loading capture.

[`real-daemon-history-on-open.spec.ts`](../../../e2e/real-daemon-history-on-open.spec.ts) →
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
establishes a protected served/display baseline, awaits Electron process exit,
posts 205 entries in `relaunch(whileClosed)`, then reopens the same protected
profile. Exactly one newest ask exposes the gap. Programmatic positioning sends
nothing; each fresh focused ArrowUp adds one ask, and settlement adds none. Final
transcript assertions require the baseline followed by every post in order with
no duplicate. `spawnClaude: false` isolates real daemon storage/transport through
the local test relay; this is not a Claude-turn or production-relay proof.

The supplied per-test dispatcher report for run `2026-10-07T22-53-47-094Z` confirms
that exact live test was present, executed and passed once in 6.2 s. Run counts:
26 executed, 26 passed, 0 failed, 1 skipped; named-test counts: 1 executed,
1 passed, 0 failed, 0 skipped. The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1879#issuecomment-6048554295)
records the same counts at `609a8ba87db3`, integrated with main `bb34dbf6d3f7`.
See [current live gate state](live-e2e-runbook.md#current-real-claude-gate-state).
Documentation records this evidence and runs only the docs guard.

## Contribution joins and held-row regressions

`historyContributions.test.ts` exercises the production bridge/holder admission
path, live dispatch and `parseChatHistorySnapshot` restoration into fresh stores.
Coverage includes partial/repeated overlap, durable order, split text, intervening
row/parent barriers, orphan results and turn-correlated denials, both live timestamp
and operator message-id arrival orders, ambiguous timestamp keys, legacy rows and
receipt-only data, receipt expiry, capacity compaction/retirement, host replacement
and eviction. Snapshot checks reject unsafe ids, overlapping ranges, inconsistent
row references and both saved patch source mismatches. A valid restored denial
must still allow a later live result with the same timestamp.

The table-driven held-row cases run before and after validated fresh restoration,
then repeat pages and validate another round trip. Assert keys, relative held-row
order and exact object survival where content is unchanged, alongside pending
compaction, completed manual/token details, waiting-echo finish associations,
delivery settlement, arrival order, stall/thinking/failure feedback and tool
progress/results. Specifically preserve the tool ID 2 → unrepresented live
assistant → overlapping tool/operator ID 4 reproduction as tool, operator, live
assistant. Numeric allocation order and reconstructed contribution objects cannot
stand in for chronological boundaries or held objects.

Subagent overlap cases dispatch live calls/text with timestamp join keys, admit
the newest-first partial pages through `prependHistoryFor`, optionally restore
into a fresh store through validated snapshot admission, then replay complete
pages. Pending and completed calls have retained-call controls: a suppressed
nonempty-parent call must also let `hello ` join held `world` as
`[toolCall, 'hello world']`. Assert the surviving assistant key and first timestamp,
the exact tool object and pending progress/existing result, and unchanged content,
keys and objects on replay. A reducer-only test misses the suppression branch in
`reconcileHistory`, which shares `isSubagentToolCall` with live lookback.

Barrier cases place a main tool with absent/empty parent, attributed subagent text,
a different turn or an operator row beside the suppressed call. Both restoration
variants must keep texts separate and held keys/order/objects intact. An operator
row absent from display contributions must still block joining and preserve its
live echo/send state. These cases guard against treating transparency of the
subagent call as permission to cross every intervening row.

`chatHistoryWriter.test.ts` checks saving when only display metadata changes;
`chatHistoryStore.test.ts` preserves orphan denial correlation through actual
protected writes and fresh service reads. `historyPageBridge` and
`finishedAgentHistory` cover skipped-entry receipts, original-page qualification,
reserved boundaries and immutable finish evidence even when ordinary rows are
suppressed. Unit snapshot reconstruction alone is not the protected persistence
or mounted interaction proof.

The fake-transport cases extend the existing presentation:

- [`history-walk.spec.ts`](../../../e2e/history-walk.spec.ts):
  `partially overlapping and repeated served pages contribute assistant and tool rows once`.
  Check assistant/tool counts and settlement from the new opaque cursor.
- [`thread-scroll-pin.spec.ts`](../../../e2e/thread-scroll-pin.spec.ts):
  `a page walked back above the reader leaves them looking at the same row`.
  Older fixture ids must actually be lower than the opening page's ids; reversed
  fixture chronology tests insertion below the opening row instead of a prepend.
- [`chat-history-recording.spec.ts`](../../../e2e/chat-history-recording.spec.ts):
  `protected restoration joins partial pages while retaining an expanded tool and content anchor`.
  Save contributions, close and relaunch using the same protected user-data directory,
  then open the saved chat without an automatic history request. Expand the surviving
  tool after restoration, retain its DOM handle, and identify the reader anchor by
  `loaded history 105` content before admitting the partial page. Verify both nodes
  remain connected, expansion/result content survives, anchor geometry is unchanged,
  joined text appears once, missing/orphan results save, and repeating the page settles
  its cursor/start without duplication. Expansion and scroll position are established
  after relaunch; the test does not require either to persist on disk.

## Counted contribution-join evidence

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1858#issuecomment-6044815524)
records the 2026-10-07 gate on `bc5418af14a8aa26725b3be4be3998fe86a8dd7d`:
units 9,469 executed/passed, 0 failed, 3 skipped; `historyContributions` contributed
84 executed/passed. Per-test unit artifacts were not supplied, so these are suite
and file counts rather than individual unit-result claims.

The configured fake-transport gate, `npx playwright test --reporter=json`, executed
341 tests: 341 passed, 0 failed, 4 skipped. The verdict confirms the three scoped
specs contributed 23 executed/passed, 0 failed, 1 recording platform skip:
history-walk 3 executed/passed, 0 failed/skipped; thread-scroll-pin 11
executed/passed, 0 failed/skipped; chat-history-recording 9 executed/passed,
0 failed, 1 skipped. Its inspected JSON report confirms the protected mounted
restoration case above was present, executed once and passed (1 executed/passed,
0 failed/skipped), preserving tool expansion, DOM identity and the content anchor.
The [earlier inspected named result](https://github.com/pyrycode/pyrycode-desktop/pull/1858#issuecomment-6037536453)
also identifies that exact test title and its assertions.

This evidence covers the selected same-host mounted scenario. Suppressed
live-subagent overlap has separate production-store evidence below. No real-Claude
acceptance or Figma capture was required or performed for the #1851 history joins.

### Suppressed subagent overlap evidence

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1877#issuecomment-6045674463)
records the 2026-10-07 gate at `4d6b76c244c90da9ac2fb31eb3849cf7c952c280`:
units 9,489 executed/passed, 0 failed, 3 skipped. It confirms all 104 contribution
tests executed and passed, including 20 added retained/suppressed-call, restoration,
identity and barrier scenarios described above. No individual unit-result artifact
was supplied; these are file/suite counts and source coverage, not per-title results.

Dispatcher gate 6, `npx playwright test --reporter=json`, recorded 345
executed/passed, 0 failed, 4 skipped. Neither the issue nor plan names a test in
that run; the total supplies no separate interactive overlap proof. Static
production-admission captures reviewed at 1280×800 and 800×600 show a separate
tool row followed by one assistant bubble against Figma Message area `132:4171`.
Those captures establish presentation; store regressions establish reconciliation
and identity. No real-Claude run or interactive reproduction was performed or
required for this renderer-store fix.
