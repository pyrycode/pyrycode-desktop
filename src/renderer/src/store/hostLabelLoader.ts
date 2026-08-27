// The renderer data path feeding the host-label store: a ONE-SHOT invoke, not a subscription. There is
// no daemon event behind this value — the label is at-rest state in the background process (#822/#823),
// so the renderer fetches it once, on demand, via `window.pyry.hostLabel()` (#824), exactly as
// serverInfoLoader fetches the paired server's identity. The pure map, the load and the one-shot guard
// are all React-free and injected, so the whole path unit-tests with plain spies; `HostLabelData` is the
// thin React glue over them. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it invokes
// the preload bridge and lands an already-classified outcome (#824 did the sourcing and classification
// main-side), never a secret.
import { useEffect } from 'react'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import { hostLabelStore, type HostLabelValue } from './hostLabelStore'

/**
 * The pure collapse of the bridge's three-arm `HostLabelResult` into the store's held value — the
 * mapServerInfo analog, React-free so it's unit-testable without a DOM.
 *
 * Written as two positive tests followed by an UNCONDITIONAL `return { status: 'error' }` — not a
 * `switch` with a `not-stored` default and not an exhaustiveness `assertNever`. The shape is the point:
 * there is no code path in this module from an unrecognised value to `not-stored`, so a
 * structurally-invalid response (a future arm, a buggy handler, a hostile invoke result) degrades to the
 * conservative outcome and ADR 0005's "never mask an unreadable record as never-stored" holds by
 * construction rather than by a branch someone has to keep correct.
 *
 * `stored` maps to a FRESH literal, reconstructed rather than passed through, so nothing the union did
 * not declare can ride an IPC payload into renderer state and out into #834's render.
 *
 * `label` is held VERBATIM: no trim, no coercion, no re-application of MAX_HOST_LABEL_LENGTH, no
 * escaping, no empty-to-null normalisation. #824 already bounded and classified it main-side and returns
 * the string untouched; re-checking here would duplicate a bound that can drift or, worse, invent an
 * absence. `''` therefore maps to `{ status: 'stored', label: '' }`, distinct from both other arms.
 * What the SCREEN shows for an empty or absent label is #834's decision, not this store's.
 */
export function mapHostLabel(res: HostLabelResult): HostLabelValue {
  if (res.status === 'stored') return { status: 'stored', label: res.label }
  if (res.status === 'not-stored') return { status: 'not-stored' }
  return { status: 'error' }
}

/**
 * The injected, React-free load surface a unit test drives with a plain spy — the loadServerInfo analog.
 * It resolves `invoke()`, writes `mapHostLabel(res)`, and on a rejection writes `{ status: 'error' }`.
 *
 * A rejected invoke means the handler is absent or the main process died mid-query: "the stored label
 * could not be read," which is `error` — never `not-stored`. Mapping it to `not-stored` would invent an
 * absence out of a transport failure, exactly the masking ADR 0005 forbids. The caught object is dropped
 * unread — never logged, interpolated, or stored — matching the handler's classify-don't-forward
 * discipline one layer down.
 *
 * The returned promise ALWAYS resolves; it never rejects into the caller, so a late-arriving handler
 * failure cannot surface as an unhandled rejection in React. Assumes `invoke` returns a Promise and does
 * not throw synchronously (the `ipcRenderer.invoke` contract).
 */
export function loadHostLabel(
  invoke: () => Promise<HostLabelResult>,
  setHostLabel: (value: HostLabelValue) => void
): Promise<void> {
  return invoke()
    .then((res) => setHostLabel(mapHostLabel(res)))
    .catch(() => setHostLabel({ status: 'error' }))
}

/**
 * The one-shot guard, extracted from the effect so it is testable without a DOM: raise an `active` flag,
 * kick off the load with a write gated on it, and return the cleanup that lowers it. `HostLabelData`'s
 * effect body is a single expression that returns this.
 *
 * The guarantee, precisely: under StrictMode the INVOKE runs twice and exactly one WRITE is applied —
 * the first mount's cleanup lowers its flag, so its late-resolving write is dropped and the second
 * mount's lands. Do not dedupe the invoke with a module-level flag: that would also block the re-read on
 * a genuine remount, which is the whole point of mounting the binding per screen rather than once at
 * launch. Repeated invokes are cheap by construction — each is an independent local `store.load()`,
 * no amplification, no state mutation, no secret returned.
 *
 * Extracted rather than inlined (as ServerInfoData inlines it) because AC4 is a written acceptance
 * criterion about a WRITE, which is a real conditional someone can get backwards — unlike a subscription
 * bridge, whose off-handle IS the cleanup and so cannot be wrong. Pulling the flag out makes StrictMode's
 * effect → cleanup → effect sequence a deterministic three-call test in this repo's DOM-free renderer
 * test environment.
 */
export function startHostLabelLoad(
  invoke: () => Promise<HostLabelResult>,
  setHostLabel: (value: HostLabelValue) => void
): () => void {
  let active = true
  void loadHostLabel(invoke, (value) => {
    if (active) setHostLabel(value)
  })
  return () => {
    active = false
  }
}

/**
 * The host-label data-path binding — a headless leaf (renders null). `window.pyry` is dereferenced only
 * inside the effect, so it server-renders to empty markup without a bridge mock (the ServerInfoData
 * discipline), and `window.pyry.hostLabel` is passed as a bare reference: the preload API is an arrow
 * closing over `ipcRenderer`, so there is no `this` to bind. One-shot invoke: no subscription, no
 * unsubscribe handle — cancellation is `startHostLabelLoad`'s flag alone.
 *
 * Ships DORMANT — nothing mounts it in this ticket (the serverInfoLoader precedent). Where it mounts is
 * #834's call; the serverInfoLoader argument transfers as guidance: an app-level one-shot at launch runs
 * before pairing and never re-runs, leaving the row stale after a same-session pair, so mounting it
 * inside the paired-only tree that renders the row gives a fresh read per open.
 */
export function HostLabelData(): null {
  useEffect(
    () =>
      startHostLabelLoad(window.pyry.hostLabel, (value) =>
        hostLabelStore.getState().setHostLabel(value)
      ),
    []
  )

  return null
}
