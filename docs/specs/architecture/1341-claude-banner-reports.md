# Claude banner reports

## Context and size

One deliverable: make conversation-scoped Claude reports visible and retain their
explanations after the next send. The shipped daemon producer is `informational`;
`/cost` is synthetic client coverage, not a claim about local-command delivery.
Read the daemon's committed `internal/protocol/testdata/banner.json` and
`docs/protocol-mobile.md` § `banner`: all five fields are required, level is open,
there is no turn id, and truncation belongs to the producer.

Estimate: about 700 written lines including tests and this plan, 10 production
TypeScript files plus CSS, two new exports (payload type and status view), five AC,
no signature migration and no new state-machine reject branches. The raw file count
exceeds five. The ticket's one-consumer floor applies: decoding, IPC, reduction and
rendering have no independently usable sibling deliverable. Keep them together.
The #1240 analogue added 647 lines including its plan. Remote feature branches were
fetched and checked against all eleven planned production paths: no overlap.
Codegraph was unavailable (index not initialized); repository search supplied the map.

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, payload interfaces — protocol vocabulary.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `requireString`, `requireBoolean` — validated named-field delivery and content-free diagnostics.
- `src/main/daemonConnection.ts` → `createDaemonConnection` — live decoded-frame emission.
- `src/shared/ipc/events.ts` → `DaemonEvent` — receive-only typed IPC union.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `timelineTargetFor`, `timelineWriteTarget`, `subscribeTimeline` — explicit conversation attribution and mounted subscription.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`, `ThreadEvent`, `TimelineState`, `reduceTimeline` — append order and independently preserved transient readings.
- `src/renderer/src/store/conversationTimelineStore.ts` → `createConversationTimelineStore` — Map-backed retention, clear and eviction; no changes needed.
- `src/renderer/src/store/daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts` → their translators — explicit ignored-event arms.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`, `ComposerErrorSlotControl`, `ComposerErrorSlot`, `denialDisplayText` — both sinks and status priority; denial's length cap cannot be reused.
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage` — accepted send inserts `userText`; guards insert nothing.
- `src/renderer/src/screens/conversation/conversation.css`, `src/renderer/src/theme/tokens.css` → session-label, status-error, muted and warning tokens.
- `src/main/transport/toolProgress.test.ts`, `src/main/daemonConnection.test.ts`, `src/renderer/src/store/compaction.test.ts`, `e2e/compaction-divider.spec.ts` → focused decoding, IPC, reducer and fake-daemon proof patterns.
- `docs/knowledge/features/development-verification.md` → positive delivery barriers, static-render limitations and 800px checks.
- `docs/knowledge/features/conversation-timeline-store.md`, `conversation-timeline-store-internals.md`, `conversation-timeline-holder.md` → live retention and history isolation.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-composer-status.md` → current status precedence and shrinkable width.
- `docs/knowledge/features/inbound-message-decode.md`, `daemon-connection.md`, `daemon-event-channel.md` → transport and IPC ownership.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=119-3843

The screenshot shows a small session label between horizontal rules. Reuse its
body-small typography and thread shadow, adapting the banner to a full-width,
left-aligned multiline paragraph as requested. Use on-surface-variant for muted
levels and warning for exact `warning`; no divider rules are needed for this reuse.

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The input's status row has activity at left and a compact error treatment at right.
Reuse the existing composer-status error styling with shrinkable, wrapping text.
Both design context and screenshots were read; no new assets are required.

## Design

Add `BannerPayload` and the `banner` envelope/inbound/IPC arms. Narrow all required
types, preserving empty level/text and unknown levels, selecting only named fields.
Empty conversation ids remain protocol strings but are dropped at timeline routing;
the translator also drops them, so neither flat nor keyed timeline receives them.
The IPC event copies `conversationId`, `level`, `text`, `stopsTurn`, `truncated`.
No timestamp join key, history mapping, turn id, or content-based deduplication.

`ThreadEvent.banner` appends one `ThreadItem.banner` with the four report fields.
`TimelineState.stoppingBanner` optionally holds the latest stopping report.
The reducer wrapper preserves it across all other content/state events, replaces it
only for stopping banners, and clears it only for `userText` or `reset`. Holder
deletion/eviction already drops the whole slice. No existing lifetime is widened.

`TimelineRow` hides exact `info`, rendering every other banner with `Claude:`.
A shared private display formatter strips terminal sequences (CSI, OSC and other
escape/control strings) and non-layout controls, retaining tabs and line breaks.
It appends one ellipsis iff `truncated`, with no text cap or markdown parsing.
The formatter serves both React text-child sinks; raw data stays unchanged in state.
Classes use explicit client-owned choices, never raw levels or prose.

`ComposerErrorSlotControl` narrowly selects the open conversation's stopping report.
Its notice choice becomes model rejection, then banner, then usage. Existing slot
priority and connection gating remain repair/error, stopped recovery, refusal, notice.
Expose a pure `ComposerBannerReport` view for static-render proof. No actions added.

## State and concurrency

Use the existing app-lifetime timeline subscription and cleanup. Map dispatch is
synchronous and keyed solely by the banner's id. No new jobs, effects, timers or
subscriptions; navigation and reconnect retain the reading. Accepted local sends
clear it through the existing synchronous optimistic echo, including slash commands.

## Error handling

Malformed required fields use existing `WireDecodeError` handling. Valid arrivals
emit the existing structured `inbound-decoded` diagnostic with static `banner` code,
frame byte length and hash; no payload fields, prose or open levels reach logs.
Unknown levels are ordinary muted reports. The stops flag controls display only.

## Testing strategy

Run focused new tests RED before production edits, then GREEN and `npm run build`.
- Wire: fixture-equivalent shape, narrowing, every missing/mistyped field, open/empty strings, named-field preservation and diagnostic privacy.
- Main IPC: real codec through the fake driver, exact typed event, malformed rejection and no content logging.
- Store/bridge: no-open/other-open routing, hostile/empty ids, repeated arrival order, info retention, latest replacement, all activity/reconnect preservation, send clear, reset and eviction.
- Static markup: muted/warning/info treatment, both attributed text sinks, inert HTML/markdown/URLs, controls, tabs/newlines, producer-only ellipsis and no second length cap; status priority.
- `e2e/banner-reports.spec.ts`: real decoding/IPC/mounted bridge, hook report on both surfaces, empty/accepted typed and slash sends, positive echo before absence assertion, navigation/reconnect retention, synthetic multiline cost report and 800px wrapping. Compare screenshot with Figma reuse treatment.

## Documentation handoff

Pending for the documentation stage: record banner rendering and report lifetime
in `docs/knowledge/features/conversation-timeline-store.md` (banner routing and lifetime
section) and `docs/knowledge/features/conversation-shell-composer-status.md` (status
precedence/report section), explicitly distinguishing the shipped informational
producer from the synthetic local-output example. These shared docs are not edited here.

## Open questions

None. Producer-owned truncation and send acceptance are specified by the ticket.

## Security review

**Verdict:** PASS

- Trust boundaries: `parseInboundMessage` validates shapes, not prose trust; renderer children remain untrusted text. Empty ids never fall back to the open conversation.
- Tokens/credentials: no new credentials, token lifecycle, or secret storage; reports can contain prompt/path data and remain in memory only.
- Files/storage: no file, cache, URL, web-storage or attribute sink for report data. Existing Map holder bounds conversation count and owns eviction.
- Electron/IPC: only an inbound typed event is added; no new renderer capability or outgoing command. Existing isolated preload and main-process transport remain unchanged.
- Cryptography: no changes to Noise, RNG, keys or nonces; the existing encrypted transport supplies plaintext to the same parser boundary.
- Network/I/O: existing frame-level `MAX_PLAINTEXT_BYTES` remains enforced before parse. No second text cap; existing connection teardown and deadlines remain owned by transport.
- Logs/errors: diagnostics use static codes, length and hash only; malformed rejection exposes only fixed field names. No report content or raw level is diagnostic data.
- Concurrency: synchronous reducer replaces only the addressed report; existing subscription cleanup owns delivery. A stopping flag never interrupts, retries, changes permission or changes lifecycle.
- Threat model: hostile daemon chrome impersonation is constrained by visible `Claude:` attribution and inert control-stripped text. CSS wraps unbroken text at 800px. Relay flooding and disk credential theft remain within existing transport/storage boundaries; no new authority is introduced.

**Reviewer:** builder self-review per `builder/security-review.md`
**Date:** 2026-09-12
