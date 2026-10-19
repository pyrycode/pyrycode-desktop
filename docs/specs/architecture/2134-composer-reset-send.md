# Ack-only composer reset commands

## Files read

- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage`: retain before bridge submission; attachment rollback and false return preserve recovery.
- `src/renderer/src/screens/conversation/composerSend.test.ts` → `submitMessage` tests: injected effects and real pending store.
- `src/renderer/src/store/threadSendStore.ts` → `retain`, `feedback`, `settle`: only authoritative user items settle retained sends; ack cannot settle them.
- `src/renderer/src/store/threadSendStore.test.ts` → scoped settlement tests: ordinary delivery and bridge-failure invariants.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `emptyThreadWindow`: native mode bypasses synthetic thread publishing.
- `e2e/indexed-history-lifecycle.spec.ts` → native thread window/update examples; `e2e/thread-items.spec.ts` → send/status assertions.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`: ack is deliberately unmodeled.
- `docs/knowledge/features/composer-send.md`, `conversation-shell.md` → authoritative rows and captured draft ownership.
- `docs/knowledge/features/development-verification.md`, `development-verification-evidence-that-cannot-pass-too-early.md` → positive processing barriers; sequential Node/Electron native preparation.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525 — inspected context and screenshot. The compact horizontal status area uses the primary body-small treatment and activity icon. Existing `ComposerStatusRow`/working-indicator presentation and theme tokens stay in use; ack-only resets must not open its Sending state. No style or asset changes.

## Change

In `submitMessage`, use one module-private constant matching the case-sensitive first token `/clear` or `/reset`, followed by Unicode whitespace or end of input. On trimmed input matching that constant, skip only local pending retention. Submit the same trimmed text, identity and attachment IDs through the existing bridge; keep diagnostics, report clearing and rollback/false return on bridge failure. All other input retains its existing row and settlement. No store, wire, exported interface, lifecycle state or failure mode is added.

This is one independently verifiable behavior: ack-only reset submission finishes without a local row. Regression tests belong with the repair. Estimated total written work: about 240 lines, one production file, zero new exported types/components/stores, zero consumer updates, two observable acceptance criteria and zero new reject branches. The analogue's small production repair remains representative; mounted regression setup accounts for the larger test estimate. Both sizing passes fit the ceilings. Remote feature-branch overlap check found none for the planned files.

## Testing strategy

- First run failing table-driven unit cases beside existing `submitMessage` tests: both commands, surrounding trim, arguments separated by Unicode whitespace, case/prefix/non-whitespace near misses, attachment forwarding and rollback/false return. A reset must leave existing unrelated pending work intact; repeated resets and late transport feedback must create no state.
- Run `threadSendStore.test.ts` to preserve ordinary exact-identity settlement and failure behavior.
- Add `e2e/composer-reset-send.spec.ts` using the mounted production app and `threadMode: 'native'`. Exercise both typed commands with correlated ack-only responses and no reset user echoes. Observe daemon receipt, then a separately pushed native assistant marker on the same ordered encrypted stream to establish progress past the ack before checking no Sending or reset row. Add a native session divider and send a later ordinary message; supply its real matching delivered user item and assert the divider precedes it with no reset tail. Repeat both resets in one conversation to cover reuse and ordering.
- Capture the integrated settled screen at 1280×800 and 800×800 for comparison with the status-node design.
- After the final merge of main: pre-verify for affected unit files, `npm run build`, prepare Electron native dependencies sequentially, and run the focused new Playwright spec on Linux. Complete fake-suite acceptance remains dispatcher-owned; no live-provider check is required by this ticket.
