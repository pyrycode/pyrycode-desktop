# Fetch pagehide test reliability

## Files read
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: merged #2001 repair selects conversations strictly and retains the Send-enabled handshake gate.
- `e2e/hosted-app-view.spec.ts` → `scenario`, bulk cancellation cases: initial discovery advertises a running app; eight reads and queued POST are fenced through cancellation and successor completion.
- `docs/knowledge/features/daemon-connection-hosted-resource-views.md` → Fetch verification: retain atomic cancellation, late replies and positive processing barriers.
- `docs/knowledge/decisions/0012-hosted-app-native-isolation.md` → cancellation ownership: document cancellation precedes queue promotion.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`: require positive receipt before absence assertions.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`: repository and evidence conventions.

## Change
Reuse #2001's selector repair already merged at `cba79876`. In the fetch-pagehide case, explicitly observe the initially discovered app row after launch, ensuring the cancellation proof retains concurrent app discovery. No production, queue, timeout, retry or handshake changes. In-flight #1983 only adds independent launch diagnostics; this change stays local to the hosted-view spec.

## Testing strategy
- Diagnose with retained #2001 evidence and distinguish its missing original stack from a controlled reproduction.
- Temporarily wait for the app row before the fixture click, then restore only the old unfiltered selector: the named case must fail with two strict-mode targets before cancellation runs. With the merged selector and the same forced ordering, it must pass. Remove diagnostic changes afterwards.
- Add the explicit discovery assertion first and run the controlled failure before final validation.
- Run ten independent Linux invocations of the exact fetch-pagehide case with zero retries, then the complete hosted-view spec. Preserve eight active reads, queued POST/enqueue barrier, cancellation replies, late frames, completed successor GET and zero dispatched POSTs.
- After merging final main, run pre-verify and build. Record revisions, commands and executed/failed/skipped counts here and on the issue. No live or visual change is involved.

Size: one verification deliverable, about 60 written lines, zero production files, exports, consumer migrations or new state/error branches; two observable acceptance criteria.

## Revisions
2026-10-15: Confirmed the setup race by controlling discovery ordering. With the app row visible before the fixture click, the former `.channel-list__row-open` selector failed this exact named case with two strict-mode targets: “Seeded discussion” and “Example running”. Restoring only the merged conversation selector passed under the same ordering. Both controls used the final spec assertion; only the temporary fixture ordering/selector differed. The fixture is unchanged in the final diff.

Retained incident evidence: #2001 fleet run `b33821bdd2311fce46335bee4af931060d92b214dde5a286765e4fd48f5931d9`, downloaded and SHA256SUMS-verified under `/tmp/builder-2007/evidence-2001/`. Its verifier log records this case failing the original gate and passing the same-tree rerun; `2026-10-15T10-40-18-079Z_verifier-gate-rerun__2001.log` records its pass at retry 0 and sibling failures with the same two-target setup error. The original 1,549,281-byte report's retained tail lacks this case's stack (original SHA-256 `63a8b80230a24768c00605f243c12f4127c0a9d55284e8efba06b2f11d0fa289`). Attribution is supported by the controlled reproduction, not a claim to have recovered that missing stack.

Linux x86_64 validation on `cce22d91c1b0f35a2890c0ed49c47c6108b110b5`, containing final main `cba798763b1ca788fee07409c5dd6eb1fe9f54cc`:

| Evidence under `/tmp/builder-2007/` | Executed | Passed | Failed | Skipped | Retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| `control-old-selector.json` (diagnostic mutation) | 1 | 0 | 1 | 0 | 0 |
| `control-fixed-selector.json` (same forced ordering) | 1 | 1 | 0 | 0 | 0 |
| `linux-fetch-pagehide-1.json` through `linux-fetch-pagehide-10.json` | 10 | 10 | 0 | 0 | 0 |
| `linux-hosted-app-view-full.json` | 23 | 23 | 0 | 0 | 0 |

Commands: `xvfb-run -a npx playwright test e2e/hosted-app-view.spec.ts --grep "Fetch bulk cancellation never promotes a queued mutation on fetch-pagehide$" --retries=0 --reporter=json`, invoked independently ten times; omit `--grep` for the complete spec. Original four-worker configuration retained (one effective worker for this single spec); both configured projects retained. The named case and all seven bulk-cancellation variants are present and passed in the complete report. No cancellation barriers/assertions changed.

`pre-verify.log`: all five checks passed, 413 unit files passed, 10,331 tests passed and 3 skipped. `build-final.log`, `install-final.log` and `docs-guard.log`: passed after final main merge. No live test changed or required. `SHA256SUMS` covers local reports/stderr/check logs; manifest SHA-256 `0786d16e660e7af27258b4985beb83b74a30c0432a2fc830b7e1f53e3938851d`. These final additions record evidence only.
