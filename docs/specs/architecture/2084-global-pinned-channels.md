# Global host-stored pinned channels

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/channel-list.md`: sidebar contracts and verification boundaries.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`: static renderer limits, saved-profile barriers and native SQLite ABI.
- `src/shared/wire/types.ts` → `ConversationSummary`: optional additive summary field, no constructor migration.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary`: live string/null decoding.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`: saved-list allowlist.
- `src/renderer/src/store/conversationListBridge.ts` → `subscribeConversations`: authoritative emitting-host refresh already exists.
- `src/renderer/src/screens/archive/archiveViewModel.ts` → `archiveInstant`, `isArchiveInstant`: calendar validity and fractional precision convention.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `partitionActive`, `groupByServer`: immutable ordering and saved-host attribution.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderBody`, `Row`, `hostRowLabel`: active render path, existing controls and label fallback.
- `src/renderer/src/screens/channels/channels.css`: row tokens and scoped dot styles.
- Adjacent decoder/view tests and `e2e/fixtures/launchPairedApp.ts`: static assertions and actual same-profile relaunch.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=869-13089

Read design context and its returned screenshot. A full-width vertical Pinned group precedes all hosts: label-large heading in on-surface-variant, 4px row gaps, compact existing body-small rows with a muted ` · host` suffix. A 1px inverse-primary rule follows with 12px top spacing; down-host rows use error text/dot and 0.6 opacity. Pin controls belong to #2085; preserve the existing channel pen here.

## Context

Core #3538 supplies nullable host-local pins. This ticket displays them across saved paired hosts, including cached offline hosts; it adds no pin mutation or protocol command. One observable deliverable, four acceptance behaviors. Estimated total written work 650–750 lines, six production files, one exported function, no required consumer migrations or new state-machine branches. No in-flight feature branches overlap the six production files. No ADR needed.

## Design

- Add `pinned_at?: string | null` beside `archived_at`. Live omission becomes null; saved omission stays absent. Both decoders reject non-string/non-null fields through their existing content-free errors; date syntax belongs only to derivation.
- Add generic `partitionSidebar(rows, serverIds)` returning pinned/channels/discussions. Start from `partitionActive`, select only promoted active rows stamped with a saved host and non-null pin, and remove exactly those references from Channels. Keep unrelated `partitionActive` consumers unchanged.
- Sort pinned copies by valid RFC3339 instant ascending, then server ID and conversation ID in UTF-16 order. Validate time/zone and real calendar dates like Archive. Compare parsed milliseconds then fractional digits after the first three, trimming trailing zeros to preserve arbitrary sub-millisecond precision. Invalid stamps sort last with the same identity ties.
- Container reads held host-label map, derives labels with `selectHostLabelFor`/`hostRowLabel` and supplies display labels to `ChannelListView`. Existing statuses already flow into the view. `renderBody` renders the group outside host folds, omitting group/rule when empty.
- Reuse `Row` with optional pinned display inputs, composite server/conversation React keys, and unchanged class tokens and pen selectors. Suffix is escaped text, never an attribute or key. Down styling is scoped to pinned row data attributes. Connected-only pen gating and host-stamped callback rows remain unchanged.

## State + concurrency model

No new state, subscription or asynchronous work. Existing per-host authoritative lists and saved-list writer own persistence and replacement. Labels/statuses are read-only render inputs. Existing bridge subscriptions clean up on unmount; derivation never mutates stored rows.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Correlated rename re-list retains pin | `sidebar-pinned.spec.ts`: host-attributed edit and received refreshed row |
| Unsolicited update adds/removes/reorders only emitting host pins, repeated updates | `sidebar-pinned.spec.ts`: mutable fake lists and external update frames |
| Same conversation ID on two hosts | `pinnedChannels.test.ts`: identity ordering; mounted dual-host rows |
| Connecting versus disconnected/error | `pinnedChannels.test.tsx` markup; `sidebar-pinned.spec.ts` computed styles |
| Quit and relaunch same saved profile with host unreachable | `sidebar-pinned.spec.ts`: observe successful saved list before quit, no row reinjection |
| Successful re-list replaces pins; archived/deleted/unpaired eligibility | partition units and mounted replacement/removal; existing unpair lifecycle remains unchanged |

## Error handling

Malformed live fields reject the list with `WireDecodeError`; malformed saved fields use the existing static snapshot error. Strings with invalid dates remain pinned at the end. Older hosts are unpinned. No new I/O path or user-facing error. Existing list lifecycle logs remain content-free; never log names, host labels, timestamps or input exceptions.

## Testing strategy

- Test first: live decoder acceptance/null normalization/type rejection, saved JSON round-trip/legacy/type rejection.
- Pure partition tests cover fractional precision, offsets/equivalent times, invalid dates, UTF-16 identity ties, duplicate IDs across hosts, eligibility, immutable input and unchanged alphabetical remainder.
- Static render tests cover heading/suffix/fallbacks, existing row/pen/selection tokens and scoped down status.
- One fake-transport Electron spec covers pushes, attributed opening/editing, folds, connecting/down appearance, saved-list persistence and actual profile relaunch. Capture integrated visual evidence at desktop and minimum width.
- Linux: final main merge, install, pre-verify (full units/typechecks), build, focused Playwright and affected recorded archive-order client replay. No current provider acceptance claimed.

## Open Questions

None. Keep timestamp parsing local to sidebar to avoid changing Archive's fallback semantics or exported surface.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseConversationSummary` and `parseChatHistorySnapshot` explicitly admit only string/null pin values; downstream date derivation never grants authority from their syntax. Tests reject wrong types and ensure errors cannot echo hostile input.
- [Tokens/secrets] No credential generation, reads, writes or renderer exposure added. Pins are summary metadata, not credentials.
- [File/storage] Existing protected saved-list storage and atomic/transactional writer retain ownership under userData. No new paths, web storage or plaintext persistence; pin strings never become filesystem paths.
- [Electron attack surface] No IPC API, window policy or navigation change. Existing context isolation and main-owned transport remain intact. React escapes title/suffix children; no raw markup or dynamic attribute from daemon text.
- [Cryptography] No change to Noise, keys, nonces or secret comparison. Existing protected storage remains responsible for encryption.
- [Network/I/O] No sockets, endpoint or request changes. Existing bounded frame decode and addressed list requests apply; invalid pin types reject the complete list rather than partially trusting it.
- [Errors/logs] Decoder errors remain static, field-named diagnostics only; tests supply hostile sentinel values and assert absence. No new content logs or telemetry.
- [Concurrency] No new async tasks. Authoritative host replacement uses the existing bridge; composite identity preserves distinct hosts and immutable partitioning cannot corrupt saved state.
- [Threat model] Hostile daemon/disk metadata is type-checked at both boundaries; strings affect only ordering/display. A relay still sees Noise ciphertext and cannot select another host's stamp. Existing safeStorage and process separation retain token-theft/renderer defenses; this change introduces no new privilege path.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-17

## Revisions

2026-10-17: Partition and static markup cases share `pinnedChannels.test.tsx` (the transition table's `.test.ts` shorthand refers to that suite). Existing daemon-connection decoder assertions also need the newly normalized null pin field. The mounted test holds disconnected/connecting appearances through the existing typed lifecycle IPC; authoritative pin changes, terminal failure, saved-profile restart and subsequent unpair remain driven through the existing application/fake transport paths. No production contract changed.

The first mounted run reached the saved-profile visibility assertions, then exposed an incorrect test assumption: an unreachable host can remain connecting during supervisor retries instead of reporting a terminal error within five seconds. The restart assertion proves persisted visibility with no row reinjection; disconnected/connecting appearance and actual transport-driven terminal error are independently asserted before quitting. No production change was needed.

Visual comparison found that existing host-tree row margins also affected the new global group: a 12px indent and 32px pitch instead of the design's flush edge and 28px pitch. A measured mounted regression reproduced both values before the fix. Scope a margin reset to pinned rows, leaving host-tree geometry unchanged.

The optional post-relaunch unpair check exposed an existing hang, confirmed on unchanged main `58d92a423dce` without pin fields or pinned markup (1 executed, 1 failed; the simpler two-row baseline passed). Filed #2089 in Backlog with priority:low. Preserve its reproduction as `blocked on #2089 — unpair an unreachable saved host after relaunch`, skipped independently of the active pin-display/restart scenario. The bug requires runtime/unpair investigation outside this ticket; no such production repair is included.
