# Screen-snapshot store (removed)

**Removed in [#619](../codebase/619.md).** This was the renderer's held copy of the daemon's latest
rendered-screen text — a dedicated, unidirectional Zustand store fed by a reactive-only headless
observer. Its sole reader, `ScreenSnapshotControl`, was removed by [#618](../codebase/618.md), which
left the store and bridge reader-less; #619 then deleted both outright (`screenSnapshotStore.ts`,
`screenSnapshotBridge.ts`, and both their tests — 396 lines). Nothing in the tree reads or writes
screen-snapshot renderer state today.

Introduced in [#323](../codebase/323.md), split from [#318](https://github.com/pyrycode/pyrycode-desktop/issues/318)
(itself split from [#147](../codebase/147.md)). The feature it displayed — photographing claude's
terminal — was deleted upstream (pyrycode#1348); the daemon now wires `Snapshotter: nil`. A raw-event
view to replace it was discussed and deliberately deferred, not built.

## What stayed, and what's next

The `screenSnapshotReceived` event, its wire types, and the outbound `requestSnapshot` transport
command are **not** removed by #619 — see [Screen snapshot fetch](screen-snapshot-fetch.md), which
still emits `screenSnapshotReceived` off the daemon's unsolicited `snapshot` push, now to zero
renderer subscribers. The three exhaustive renderer bridges
(`daemonEventBridge`/`timelineBridge`/`modalBridge`) still carry compile-forced `screenSnapshotReceived`
no-op arms, pending [#621](https://github.com/pyrycode/pyrycode-desktop/issues/621) (removes the event
member itself) and [#620](https://github.com/pyrycode/pyrycode-desktop/issues/620) (removes the
outbound builder). A handful of comments in `announcedModelStore.ts`/`announcedModelBridge.ts`/
`serverInfoLoader.ts` still cite this store and `ScreenSnapshotData` as a design precedent — left in
place for [#635](https://github.com/pyrycode/pyrycode-desktop/issues/635), which sweeps the whole
series' stranded citations in one pass.

## Related

- [Screen snapshot fetch](screen-snapshot-fetch.md) — the transport half; stays.
- [Session-id store](session-id-store.md) / [#259 codebase notes](../codebase/259.md) — the closest
  structural precedent this store mirrored: a reactive-only, App-lifetime holder with no request half.
- [#323 codebase notes](../codebase/323.md) — introduced the store and bridge, dormant.
- [#324 codebase notes](../codebase/324.md) — the display + trigger, the store's sole reader; removed
  by #618.
- [#618 codebase notes](../codebase/618.md) — removed `ScreenSnapshotControl`, leaving this store
  reader-less.
- [#619 codebase notes](../codebase/619.md) — deleted the store and bridge outright.
