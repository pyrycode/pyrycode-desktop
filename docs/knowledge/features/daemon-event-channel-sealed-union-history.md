# Daemon event channel — the sealed union: per-member history

Part of [Daemon event channel — the sealed union](daemon-event-channel-sealed-union.md); see that
document for the union type declaration itself and for what the whole package does, its edge cases and
its links. Split out 2026-09-08 once the per-member bullet list alone had grown past the size cap; each
entry keeps the wording it had in the parent. One entry per union member, in the order each landed.

Split a second time, same day, once the combined list grew past the cap again:

- [Early members](daemon-event-channel-sealed-union-history-early.md) — the original six
  session-lifecycle arms through `modelAnnounced` (#587).
- [Recent members](daemon-event-channel-sealed-union-history-recent.md) — `slashCommandList` (#937)
  onward, including `thinkingProgress` (#1313), plus the two standing rules that govern the whole
  union rather than one member.
