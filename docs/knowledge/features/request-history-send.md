# Retired raw-history request route

Desktop no longer requests or decodes raw daemon history pages (#2025). Opening,
reconnecting, scrolling back and Retry use host-addressed authoritative thread
queries and complete checkpoints. See [thread runtime](thread-runtime.md#restore-recovery-and-cleanup)
for the current content route and [query correlation](daemon-connection-lifecycle.md#thread-history-queries)
for main-process ownership.

## Removed Desktop surface

| Boundary | Current behavior |
| --- | --- |
| Renderer IPC | `requestHistory` and its payload guard are removed from `RendererCommand`/`isRendererCommand`. A formerly valid command fails existing unknown-command validation. |
| Main dispatch and registry | No history dispatch case, `DaemonConnection.requestHistory` or `viewOf` delegate remains. |
| Outbound transport | `requestHistoryEnvelope.ts` and `buildRequestHistory` are deleted. |
| Correlation and lifecycle | The pending-history map, request teardown, reply matching and history-refusal classification are deleted. |
| Reply IPC | `historyPageReceived`, `historyRequestFailed` and `HistoryRequestFailure` are deleted, with their no-op cases in the four exhaustive renderer bridges. |
| Inbound transport | Exclusive page/entry payload decoding and decoded-page types are deleted. Admitted `history_page` and `resync` frames are unmodeled and return `null`, producing no content or recovery request. |
| Hello and recovery | Initial, automatic-reconnect and explicit-reconnect hellos omit `last_event_id` and `last_seen_ts`. There is no replay cursor, event-ring resync or legacy gap-fill recovery. |

The renderer reconstruction/demand producers retired in #2030. These removals
complete the Desktop network path; daemon cleanup and its minimum app version
are separate daemon work. Authority is [daemon ADR 042](https://github.com/pyrycode/pyrycode/blob/main/docs/knowledge/decisions/042-daemon-built-thread.md).

## Retained boundaries

Shared wire declarations still mirror the supported Mobile/daemon contract.
`RequestHistoryPayload` and history wire names are not grounds for deleting a
shared declaration. `HistoryTimelineEvent`/entries remain needed by
`translateTimelineEvent`, saved storage and active tests. The shared
`createScriptedThread` fake publisher still translates legacy-shaped fixture
input into authoritative daemon items. Generic hello/codec compatibility inputs
also remain. Saved-format admission and indexed legacy storage retirement belong
to #2026.

Live payload parsing, admitted-envelope metadata and size/UTF-8/envelope guards
remain in main. Missing-`thread` hosts stay update-required with no content/recovery
requests while reconnect supervision remains active; a later capable handshake
recovers only that host. Thread query/checkpoint recovery, per-host receivers and
incomplete-fragment isolation remain authoritative. Live readings and clears,
prompts, configuration, host ownership and send outcomes retain their existing
paths. The copied [`sendPairing` snapshot](daemon-connection-lifecycle.md#hello-and-held-send-pairing-lifetime)
still invalidates held composer sends on pairing replacement/disappearance.
Removing it with the replay cursor would allow old payloads to reach new credentials.

## Verification

Exclusive history encoder/decoder/dispatch fixtures and parked main tests retired
with their implementations. Active cases in mixed parser files and the shared
fake publisher remain. `commands.test.ts` rejects formerly valid history commands;
`daemonConnection.test.ts` covers cursor-free hellos, inert legacy frames,
missing-capability recovery, held-send pairing fences and stale loads.
`threadUpdates.test.ts` retains equal conversation/update IDs across hosts and
incomplete-fragment reconnect isolation while asserting replay-field omission.

The existing activation suite proves zero legacy requests on open, reconnect,
older paging and retry, with missing-`thread` isolation/recovery. Counted Linux
unit/build and complete configured fake-suite evidence, including the initial
reader failure and subsequent complete passes, is recorded in
[thread runtime validation](thread-runtime.md#main-request-and-recovery-retirement-validation).
macOS is outside this ticket's verification scope; no live result is claimed.
