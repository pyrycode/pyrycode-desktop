# Inbound message decode — extension history

The chronological, kind-by-kind history of every additive extension to `InboundDaemonMessage` — each ticket that added a new recognized envelope type, in the order it landed, including which helper it introduced or reused and what the consumer arm did with the result.

Part of [Inbound message decode](inbound-message-decode.md); see that document for what the package does, its data flow, and its links. Split out of that document 2026-09-02, once this history alone had grown past the size cap; each entry below keeps the wording it had in the parent.

Split a second time, 2026-09-08, once the combined list grew past the cap again:

- [Early extensions](inbound-message-decode-history-early.md) — the boundary's introduction
  ([#68](../codebase/68.md)) through `attachment_stored` (#964).
- [Recent extensions](inbound-message-decode-history-recent.md) — `model_list` (#972) onward,
  including `thinking_progress` (#1312) and `rate_limited` (#1318).
