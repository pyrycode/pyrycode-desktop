# Conversation timeline store

Renderer reconstruction was deleted in #2030: `reduceTimeline`, flat/keyed
holders, content subscriptions, history reconciliation/demand/retry, delta and
result joining, gap/receipt ledgers, inferred rosters, reconstructed row keys,
legacy echo settlement and exclusive queue/read bookkeeping no longer exist.
There is no standalone legacy content path or missing-authority fallback.

## Where the detail lives

- [Thread runtime](thread-runtime.md) — current content, live-state, pending-send and cleanup ownership.
- [Conversation shell](conversation-shell.md) — item presentation, composer and committed reads.
- [Thread timeline declarations](thread-timeline.md) — shared presentation types at their existing path.
- [Earlier implementation history](conversation-timeline-store-history.md) — historical event reconstruction. The older internals, compaction, banner, usage and limits pages describe that retired implementation; they are not current producer APIs.

## What it does

The surviving `timelineBridge.ts` translates shared event shapes needed by
presentation/live consumers. It has no `subscribeTimeline`, history joining or
row-writing mount. `threadTimeline.ts` retains declarations used by presentation,
live feedback and pending sends, without its reducer or selectors.

The runtime combines authoritative items with local unaccepted sends; session
binding comes only from received owning summaries. Model/configuration/session
facts, MCP/status readings, prompts and notifications retain their existing paths.
Missing authoritative inputs produce no reconstructed rows or reports.

## Live user receipts

Legacy receipt joining and echo settlement are gone. An authoritative
`user_message` settles a pending send only by the exact host/conversation and
captured device/message pair. Equal text, peer-device message IDs and another
host do not establish acceptance. Accepted content and attachment facts then come
from the daemon item. See [send identity](thread-runtime.md#sending-and-authenticated-identity).

## Claude banner routing and lifetime

Composer banner/stop/refusal reports derive from current-session canonical items;
session errors come from admitted live readings. Departure consumes the exact
displayed error through the StrictMode microtask fence, without clearing a newer
replacement. See [live controls](thread-runtime.md#live-controls-and-read-publication).

## Tool parent attribution

Supplied daemon item ancestry owns placement. Shared row types and translators
still carry presentation fields; the renderer no longer fills a legacy call by
joining a raw tool result or matching type/timestamp history evidence.

## Assistant parent attribution

Daemon item content supplies the accepted reply and parent facts. Renderer delta
coalescing/open-bubble lookback and history overlap suppression are deleted.
Current nesting remains in [item presentation](conversation-shell-timeline-render.md#supplied-daemon-item-presentation).

## Live tool progress

Admitted session-scoped live readings and canonical item reports supply progress
and foreground-tool feedback. They do not mint reconstructed rows. Without the
owning live binding there is no live progress reading or inferred activity.

## Refusal records and routing

Canonical item reports supply refusal presentation; current-session controls are
owned by `threadRuntime.refusals`. Shared refusal declarations/translations remain.
Main/IPC decoding contracts survive pending #2025; legacy storage admission and
formats survive pending #2026.

## Refusal-offer lifetime

`subscribeRefusalRecovery` still observes newly selected model-write intents and
forwards them to `threadRuntime.refusals`. Its timeline argument, dispatch and
legacy event settlement are deleted. Settings/refusal recovery retains exact
correlation and owning scope; it cannot recover an offer from a missing legacy
slice. See [composer refusal recovery](conversation-shell-composer-status.md#refusal-switch-back).

## Configuration and usage

`App` installs the authoritative runtime subscriptions. `PairedShell` opens the
runtime and keeps the read-publication wrapper mounted. No exclusive timeline,
history-page, roster or queue bridge remains mounted.

## Edge cases and limitations

Module paths retained for shared declarations do not authorize rebuilding a
producer behind them. Offline authoritative restore, protected removal ordering,
complete checkpoint certification and stale-callback fences remain unchanged.
Producer-only regressions retired with their implementations; active authoritative
cache/removal/restart and conversation-feature coverage remain.

## Related

See [counted retirement validation and case inventory](thread-runtime.md#renderer-producer-retirement-validation),
[unread derivation](conversation-unread.md) and [read publication](conversation-last-read-store.md).
