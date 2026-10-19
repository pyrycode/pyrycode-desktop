# ADR 0016: Session-only compact projection authority

Status: Accepted, 2026-10-19. Implemented by
[#2103](https://github.com/pyrycode/pyrycode-desktop/issues/2103).

## Context

Compact delivery mixes full non-tool/agent roots with metadata-only tool/agent
headers. Hidden activity can change ancestor freshness without changing its
revision or downloading descendants. Canonical complete items already drive
protected owned writes, complete-history checkpoints and visible-content read
publication. Putting headers there would give partial content authority that the
daemon never supplied. Reusing saved complete checkpoints would likewise mistake
complete consumption for compact coverage.

## Decision

Keep a separate session-only compact owner, selected explicitly through
`runtime.open(host, chat, { projection: 'compact-v1' })` after the owning handshake
accepts `interactive`, `thread`, `thread_expansion` and `thread_compact`. Ordinary
opening remains complete; advertisement cannot activate compact delivery.

Root facts, certified root windows, completed catch-up checkpoints and consumed
live intervals remain distinct from body freshness and child enumeration. Only a
matching successful query marker certifies compact coverage. Older-page completion
cannot advance the catch-up checkpoint or discharge a live gap. Per-identity
revision/source-version checks protect newer live facts from delayed query rows.

Reuse the bounded body/child owner for demanded detail. Ancestor freshness
conservatively invalidates selected-scope detail without a descendant inventory;
active leases coalesce refresh, child traversal restarts at page one, and failed
entries retain explicit-retry admission. Compact root and detail work share a finite
per-host lane respecting the daemon's one unfinished-query slot.

## Rationale

The separate owner receives no canonical-store mutation, disk or receipt capability,
making authority separation structural. Independent evidence avoids treating root
enumeration as a downloaded subtree. Demand-only refresh bounds work to active
consumers; missing freshness remains conservative rather than certifying a cache.

Local cancellation cannot stop the daemon, so the lane retains sent ownership until
terminal delivery or expiry. Detail failures settle before lane release and admission
is rechecked at actual dispatch, preventing queued limit variants from bypassing a
new parent failure. Connection/selection/snapshot ownership is rechecked after
synchronous callbacks, which can retire or replace the owner while handling a frame.

## Consequences

Compact and detail state survive only in session memory. Offline compact reopening
can show only retained roots and truthful stale/missing detail; complete saved
restoration remains independently available. No new compact persistence, complete
certificate, full-history fallback or unseen-content read authority is introduced.
Switching projections initializes the destination query at zero while preserving
held complete state. Presentation and integrated activation remain #2081's work.

See [runtime behavior and validation](../features/thread-runtime-compact.md),
[complete-store boundaries](../features/thread-item-store.md) and
[main correlation](../features/daemon-connection-correlation-requests.md#compact-projection-queries-and-live-delivery).
