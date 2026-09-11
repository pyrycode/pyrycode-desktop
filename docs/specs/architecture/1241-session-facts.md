# Session facts in channel info

## Context and sizing

The operator needs Claude's reported build and permission posture in Channel info.
The published `session_facts` protocol has no effort or session identifier. This is
one deliverable: transport and retention have exactly one UI consumer. Apply the
single-consumer floor exception already identified in refinement instead of shipping
dormant prerequisites. Estimate: 700–1000 written lines across approximately 15
production files, focused tests and this plan (refiner: 1500 lines / 15 files).
The file ceiling is exceeded; the floor wins. Four acceptance criteria, at most five
new exported types/components/stores, four required exhaustive bridge additions,
two cleanup-dependency constructors and one sheet caller updated. No new error state
machine; payload failures use the existing decode guard. Remote feature branches
were fetched and checked: no overlapping changes in the intended existing files.
Codegraph returned an uninitialized-index error; source reads supply the map below.

## Files read

- `src/shared/wire/types.ts`: `ModelAnnouncedPayload` — neighboring required report shape.
- `src/shared/ipc/events.ts`: `DaemonEvent` — typed main-to-renderer event union.
- `src/main/transport/inboundMessage.ts`: `parseInboundMessage`, `parseModelAnnouncedPayload` — narrow before emitting, static diagnostics.
- `src/main/daemonConnection.ts`: `createDaemonConnection` inbound switch — named-field IPC mapping without turn effects.
- `src/renderer/src/store/announcedModelStore.ts`: `createAnnouncedModelStore`, `selectAnnouncedModelFor` — immutable per-conversation Map, unconditional pairing reset.
- `src/renderer/src/store/announcedModelBridge.ts`: `subscribeAnnouncedModel`, `AnnouncedModelData` — always-mounted listener with unsubscribe cleanup.
- `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge,questionBridge}.ts`: event translation switches — explicit ignored informational event.
- `src/renderer/src/App.tsx`: `AnnouncedModelData` mount — retain reports before sheet open.
- `src/renderer/src/PairedShell.tsx`: `clearPairingDeps` — composition-root cleanup wiring.
- `src/renderer/src/clearPairingScopedState.ts`: `ClearPairingScopedStateDeps`, `clearPairingScopedState` — whole-pairing teardown.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `ChannelInfoSheet`, `ChannelInfoSheetView` — nullable conversation and pure view seam.
- `src/renderer/src/screens/conversation/conversation.css`: `.channel-info__row`, `.channel-info__row-value` — existing tokenized rows.
- `e2e/channel-system-prompt.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: `launchPairedApp` — real IPC/Noise fake transport drive.
- `docs/knowledge/features/conversation-shell-session-and-channel-info.md`: Channel Info sheet — desktop chrome and placeholder retained.
- `docs/knowledge/features/development-verification.md`: proof boundaries — SSR cannot execute effects; use positive browser delivery assertions.
- `docs/knowledge/features/{announced-model-store,inbound-message-decode,daemon-event-channel,daemon-connection}.md`: contract boundaries and pairing lifetime.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

Read design context and screenshot: rounded dark sheet, muted section headings,
left labels and right values with generous row padding. Reuse the desktop sheet's
existing section-header/detail-row classes and theme typography/color/spacing tokens;
Session goes after About and before System prompt. No new icons or assets are needed.

## Design

Add `SessionFactsPayload` mirroring the published protocol: required
`conversation_id`, `claude_code_version`, `permission_mode` strings, required
`truncated_fields: string[] | null`. Narrow every field and construct a named-field
literal, ignoring extras. Empty strings and unknown modes/report names survive.
Add `session-facts` inbound kind and `sessionFacts` IPC event with camel-case fields.
The main switch emits only that event; all four exhaustive renderer bridges ignore it.

Create `sessionFactsStore` and its injected factory using an immutable Map keyed by
conversation id. Hold the complete report without its routing key; replacement is
atomic and includes empty strings and null/empty truncation lists. A selector returns
the held record or null. A dedicated app-mounted subscription records reports while
the sheet is closed. Add its unconditional clear to pairing cleanup and its dependency
wiring. No request, dedup, turn transition or permission command is introduced.

The sheet container selects only its conversation's record and passes it to the pure
view as an optional prop. The view renders Session only for an identified conversation:
Claude version and Reported permission mode, with Not reported for absent/empty values.
Each string is bounded to 256 Unicode code points at display, React-escaped, and may
wrap. Show Truncated when the producer names that field or the display bound cuts it.
Keep the marker outside any clipping. Neither field is an attribute, URL, log, control
input or semantic version. Existing no-conversation markup remains intact.

## State and concurrency

Synchronous Zustand copy-on-write updates preserve other record identities. One
useEffect listener at app lifetime returns its off handle; no timers, async requests,
persistence or screen-local report state. Pairing reset clears the Map. Reconnect and
sheet close keep reports, matching the unsolicited announced-model path. Existing
pairing event ordering remains owned by the pairing lifecycle.

## Error handling and logging

Malformed facts throw `WireDecodeError` inside the established decode guard and are
dropped without a UI transition. Successful decoding logs only static event/code,
frame length and hash through the shared diagnostic logger. No decoded payload or
reported string enters diagnostics. Required-field failures follow existing behavior.

## Testing strategy

- RED first: focused decode tests for complete, empty, unknown, extra, missing and
  mistyped fields; metadata null/array preservation and payload-free diagnostics.
- Main fake-driver test proves exactly one IPC event and malformed-report rejection.
- Store/bridge tests prove isolation (including hostile Map keys), complete replacement,
  identity stability, unsubscribe, and reset; pairing cleanup's dependency pin is updated.
- Static sheet tests prove absent/empty/unknown/truncated, escaped bounded text,
  ordering and the no-conversation placeholder.
- Fake-transport Playwright delivers before open, updates while open, switches two
  conversations and checks isolation. Compare rendered sheet against the Figma pattern.
- Run touched unit tests, npm run build and the focused Playwright spec. No live Claude.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/conversation-shell-session-and-channel-info.md`
under Channel Info sheet to describe Session rows, Not reported/Truncated, informational
permission semantics and pairing-scoped per-conversation retention. No explicit
documentation acceptance criterion or handoff section was supplied by the ticket.

## Open questions

None. Display cap is a client rendering bound, not a wire rejection rule.

## Security review

**Verdict: PASS**

- Trust boundary: `parseSessionFactsPayload` validates shape only; all reported text
  remains untrusted through `DaemonEvent` and the sheet. Unknown fields are discarded.
- Tokens/credentials: no token generation, access, storage or forwarding is added.
- Storage: in-memory Map only; hostile conversation keys cannot affect prototypes.
  No disk paths, web storage or persistence consume reports.
- Electron: existing typed event channel only, no new command or privileged capability;
  transport stays in main. React children escape markup, bounded rendering limits DOM text.
- Cryptography: Noise and key management remain untouched; no new comparisons to secrets.
- Network/I/O: existing plaintext cap and decode guard apply before payload parsing;
  no new connection, URL or timeout behavior.
- Logs: static code, length and hash only; test sentinels must be absent from diagnostics.
- Concurrency: synchronous replacement, independent record identities, effect teardown,
  unconditional whole-Map reset. No await between read and write.
- Threat alignment: malicious daemon text cannot become permission behavior or markup;
  the relay can delay delivery but gains no plaintext path. Existing transport/keychain
  protections remain responsible for relay disruption and disk-token theft.

No MUST FIX or SHOULD FIX findings remain. MCP reports and effort are outside this
contract, owned respectively by #1251 and future producer work.
