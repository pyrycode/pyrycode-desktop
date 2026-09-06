// The renderer data path feeding the host-label store: ONE-SHOT invokes, not subscriptions. There is
// no daemon event behind this value — the label is at-rest state in the background process (#822/#823),
// so the renderer fetches it once, on demand, exactly as serverInfoLoader fetches the paired servers'
// identities. The pure map, the loads and the one-shot guard are all React-free and injected, so the
// whole path unit-tests with plain spies; `HostLabelData` is the thin React glue over them. Nothing here
// touches keys, sockets, ipcRenderer, or raw frames — it invokes the preload bridge and lands an
// already-classified outcome (#824 did the sourcing and classification main-side, #1157 keyed it),
// never a secret.
//
// #1199 moved this path off the unkeyed `window.pyry.hostLabel()` and onto
// `window.pyry.hostLabelFor(serverId)` (#1157), issuing ONE read per paired server. The unkeyed query
// answers with the most recently stored label, so with two machines paired it named whichever was
// stored last — the defect the row's ticket exists to fix. The main-side unkeyed arm stays registered
// (#1186 may still want it); what must not survive is the renderer reading both.
import { useEffect } from 'react'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import { hostLabelStore, type HostLabelValue } from './hostLabelStore'
import { useServerInfoStore, selectServers } from './serverInfoStore'

/**
 * The pure collapse of the bridge's three-arm `HostLabelResult` into the store's held value — the
 * mapServerInfo analog, React-free so it's unit-testable without a DOM. Unchanged by #1199: the arms,
 * the verbatim label and the conservative default are all per-server facts already.
 *
 * Written as two positive tests followed by an UNCONDITIONAL `return { status: 'error' }` — not a
 * `switch` with a `not-stored` default and not an exhaustiveness `assertNever`. The shape is the point:
 * there is no code path in this module from an unrecognised value to `not-stored`, so a
 * structurally-invalid response (a future arm, a buggy handler, a hostile invoke result) degrades to the
 * conservative outcome and ADR 0005's "never mask an unreadable record as never-stored" holds by
 * construction rather than by a branch someone has to keep correct.
 *
 * `stored` maps to a FRESH literal, reconstructed rather than passed through, so nothing the union did
 * not declare can ride an IPC payload into renderer state and out into the row's render. That defence
 * matters more since the store became keyed: a response cannot smuggle a second field in, and — see
 * `loadHostLabelFor` — it could not be believed about the id even if it did.
 *
 * `label` is held VERBATIM: no trim, no coercion, no re-application of MAX_HOST_LABEL_LENGTH, no
 * escaping, no empty-to-null normalisation. #824 already bounded and classified it main-side and returns
 * the string untouched; re-checking here would duplicate a bound that can drift or, worse, invent an
 * absence. `''` therefore maps to `{ status: 'stored', label: '' }`, distinct from both other arms.
 * What the SCREEN shows for an empty or absent label is the row's decision, not this store's.
 */
export function mapHostLabel(res: HostLabelResult): HostLabelValue {
  if (res.status === 'stored') return { status: 'stored', label: res.label }
  if (res.status === 'not-stored') return { status: 'not-stored' }
  return { status: 'error' }
}

/**
 * ONE server's read: the injected, React-free load surface a unit test drives with a plain spy. It
 * resolves `invokeFor(serverId)`, writes `mapHostLabel(res)` into that server's slot, and on a rejection
 * writes `{ status: 'error' }` into the same slot.
 *
 * THE WRITE KEY IS THE ARGUMENT, NEVER A FIELD OF THE RESPONSE. `HostLabelResult` carries no id at all —
 * the bridge deliberately never echoes one, so a refusal is indistinguishable from an unreadable label —
 * and the id it was asked with is a client-held value off the paired-server list. Keying the write off
 * anything the main side sent back would reintroduce, from the other direction, exactly the bug this
 * path is fixing: one machine's answer landing on another machine's row.
 *
 * A rejected invoke means the handler is absent or the main process died mid-query: "the stored label
 * could not be read," which is `error` — never `not-stored`. Mapping it to `not-stored` would invent an
 * absence out of a transport failure, exactly the masking ADR 0005 forbids. The caught object is dropped
 * unread — never logged, interpolated, or stored — matching the handler's classify-don't-forward
 * discipline one layer down. Nothing on this path logs at all: any useful line would carry the label,
 * which is operator content, or the id, and neither belongs in a log (ADR 0007, CLAUDE.md).
 *
 * The returned promise ALWAYS resolves; it never rejects into the caller, so a late-arriving handler
 * failure cannot surface as an unhandled rejection in React. One server's failure is therefore confined
 * to one slot: the sibling reads are independent promises and neither can be settled by the other's
 * rejection. Assumes `invokeFor` returns a Promise and does not throw synchronously (the
 * `ipcRenderer.invoke` contract).
 */
export function loadHostLabelFor(
  invokeFor: (serverId: string) => Promise<HostLabelResult>,
  serverId: string,
  setHostLabelFor: (serverId: string, value: HostLabelValue) => void
): Promise<void> {
  return invokeFor(serverId)
    .then((res) => setHostLabelFor(serverId, mapHostLabel(res)))
    .catch(() => setHostLabelFor(serverId, { status: 'error' }))
}

/**
 * The one-shot guard over the WHOLE paired-server list, extracted from the effect so it is testable
 * without a DOM: raise one `active` flag, kick off one load per id with every write gated on it, and
 * return the cleanup that lowers it. `HostLabelData`'s effect body is a single expression that returns
 * this.
 *
 * The guarantee, precisely: under StrictMode the INVOKES run twice and exactly one WRITE PER SERVER is
 * applied — the first mount's cleanup lowers its flag, so its late-resolving writes are dropped and the
 * second mount's land. ONE flag covers all N reads rather than one flag each, because they share a
 * lifetime: they are started by one effect and cancelled by one cleanup, and a per-read flag would let a
 * partially-cancelled mount write half its servers.
 *
 * Do not dedupe the invokes with a module-level flag: that would also block the re-read on a genuine
 * remount, which is the whole point of mounting the binding per screen rather than once at launch.
 * Repeated invokes are cheap by construction — each is an independent local `store.loadFor()`, no
 * amplification, no state mutation, no secret returned — and their count is bounded by the number of
 * machines the user has paired.
 *
 * An empty list starts nothing, which is the launch frame: the paired-server read is itself a one-shot,
 * so the sidebar's first render names nobody and there is nothing to ask about yet.
 */
export function startHostLabelLoads(
  serverIds: readonly string[],
  invokeFor: (serverId: string) => Promise<HostLabelResult>,
  setHostLabelFor: (serverId: string, value: HostLabelValue) => void
): () => void {
  let active = true
  for (const serverId of serverIds) {
    void loadHostLabelFor(invokeFor, serverId, (id, value) => {
      if (active) setHostLabelFor(id, value)
    })
  }
  return () => {
    active = false
  }
}

/**
 * The separator joining the paired-server ids into the effect's dependency. A NUL cannot appear in a
 * server id in any pairing payload the client accepts, and the failure mode if one ever did is benign
 * and self-correcting: the id would split into fragments main does not know, each answering not-stored,
 * and the row would show the generic word rather than a wrong machine's name.
 */
const ID_SEPARATOR = '\u0000'

/**
 * The host-label data-path binding — a headless leaf (renders null). `window.pyry` is dereferenced only
 * inside the effect, so it server-renders to empty markup without a bridge mock (the ServerInfoData
 * discipline), and `window.pyry.hostLabelFor` is passed as a bare reference: the preload API is an arrow
 * closing over `ipcRenderer`, so there is no `this` to bind. One-shot invokes: no subscriptions, no
 * unsubscribe handles — cancellation is `startHostLabelLoads`'s flag alone.
 *
 * WHICH IDS. The paired-server list off `serverInfoStore`, filled by the `ServerInfoData` one-shot the
 * sidebar mounts beside this one. Client-held, never wire-supplied: a daemon-supplied lookup key would
 * let a confused or hostile server put one machine's name onto another machine's row, which is the rule
 * `conversationListStore`'s `selectConversationsFor` header states for its own read and which holds
 * identically here.
 *
 * WHY THE DEPENDENCY IS A DERIVED STRING AND NOT THE ARRAY. `selectServers` hands back the held array by
 * reference, so it changes identity on every `setServers` write — including one that writes an identical
 * list. Depending on the reference would re-issue N invokes for each such write; depending on a
 * value-derived key makes an identical list a no-op. The ids are round-tripped through the key rather
 * than read from the render closure, so the effect depends on nothing but what it was given and there is
 * no stale-closure question. In practice the list is written once per mount either way; the derived key
 * is what makes that a property of the code rather than of the current set of writers.
 */
export function HostLabelData(): null {
  const serverIds = useServerInfoStore(selectServers)
    .map((server) => server.serverId)
    .join(ID_SEPARATOR)

  useEffect(
    () =>
      startHostLabelLoads(
        serverIds === '' ? [] : serverIds.split(ID_SEPARATOR),
        window.pyry.hostLabelFor,
        (serverId, value) => hostLabelStore.getState().setHostLabelFor(serverId, value)
      ),
    [serverIds]
  )

  return null
}
