// The renderer data path feeding the slash-command store: it observes the typed `slashCommandList`
// daemon event (#937 carries the last hop across IPC what #936 decoded fail-closed from the
// `slash_command_list` frame — one conversation id, the published rows, and the frame's drop count)
// and lands each frame in the app-singleton `slashCommandListStore` that #940's type-ahead and
// #681's Actions-menu grey-out will read. Reactive-only — like announcedModelBridge (#588) and
// backgroundTaskRosterBridge (#573), and unlike conversationListBridge, the daemon PUSHES the menu
// unsolicited from the `initialize` reply, so there is NO request half: no command sent, no
// connected-edge fetch, and none may be added. Delivery is best-effort with three published loss
// points, so a conversation that never receives a menu is a normal, permanent state that the store
// reports as `null` — never a retry and never a spinner.
//
// A FIFTH OBSERVER, not a new arm on an existing bridge, which is the call #937 explicitly left to
// this slice. All four exhaustive bridges KEEP their `slashCommandList` no-op cases permanently
// (`routeDaemonEvent`, `timelineWriteTarget`, `translateModalEvent`, `translateQuestionEvent`) —
// each is present only so the `assertNever` guard makes a NEW arm a compile error — so this is the
// announcedModelBridge / backgroundTaskRosterBridge shape, an independent subscriber, NOT the #493
// shape where `apiRetry` folded into timelineBridge's owned arm. Nothing in those four changes
// behaviour, and removing one would be a security regression rather than a tidy-up: those guards
// `JSON.stringify` the WHOLE event into an `Error`, so a dropped case would leak workspace-authored
// text into an error message.
//
// The two helpers are React-free and injected, so the whole path is unit-testable with plain spies
// (the announcedModelBridge idiom); `SlashCommandListData` is the thin React glue over them. Nothing
// here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload
// bridge and dispatches an already-typed event.
//
// SECURITY: the arm carries five string-typed fields per row plus every string in `aliases`, all
// WORKSPACE-AUTHORED — a lower trust tier than the claude-authored text `modelAnnounced` carries.
// This path copies named fields and interprets none of them: no parse, no normalisation, no
// `JSON.parse`, and NOTHING IS EVER LOGGED — there is deliberately no "dropped an unrelated event"
// or "no menu for this conversation" diagnostic here, because `0x0a` is the only sub-`0x20` byte
// across the capture's 51 entries and a logged description is a workspace author forging log
// records. The translator's `default: null` rather than an `assertNever` is part of that: an
// `assertNever` would stringify the event into an `Error`. The inert-plain-text obligation binds
// #940.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { slashCommandListStore, type SlashCommandListSnapshot } from './slashCommandListStore'

/**
 * The filter: map the one owned arm to its snapshot, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the queueBridge / modalBridge idiom — never `return event`, never a spread),
 * which is load-bearing rather than stylistic: a spread would carry the arm's `type` tag, and any
 * field a later arm gains, into a write unit that never agreed to hold it. `commands` passes through
 * BY REFERENCE — row order, row identity and snake_case preserved — because there is no per-row
 * mapping anywhere on this path, which is what keeps each row's own `truncated_fields: null`
 * distinct from `[]` and keeps `aliases` unnormalised by construction.
 *
 * UNCONDITIONAL — there is deliberately no `if (event.commands.length === 0) return null`. An empty
 * menu is a POSITIVE STATEMENT that claude offered nothing, never "no news", so it maps to a snapshot
 * like any other; see the `!== null` guard in `subscribeSlashCommandList`. `droppedCommands` is
 * copied including `0`, which is a value and is never consulted for truthiness.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended,
 * permanent behaviour: it is an independent subscriber in the announcedModelBridge posture, not one
 * of the four typecheck-gating exhaustive bridges (which already no-op this arm from #937). It is
 * also the safer default here, since an `assertNever` guard stringifies the whole event into an
 * `Error`. `null` means "NOT OUR ARM", NEVER "bad data": a malformed payload is already rejected
 * upstream, where #936's narrower throws inside `daemonConnection`'s decode guard and no event is
 * emitted at all. The arm it must NOT pick up is its structural twin `backgroundTaskRoster`, which
 * carries the identical shape — one conversation id, a row list and a frame-level drop count — so the
 * filter switches on the DISCRIMINANT and never on field names. React-free → unit-testable without a
 * DOM.
 */
export function translateSlashCommandList(event: DaemonEvent): SlashCommandListSnapshot | null {
  switch (event.type) {
    case 'slashCommandList':
      return {
        conversationId: event.conversationId,
        commands: event.commands,
        droppedCommands: event.droppedCommands
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `slashCommandList` writes its snapshot into the
 * store via `setSlashCommandList`; every unrelated event no-ops. Returns the unsubscribe handle (the
 * daemonEventBridge off-handle idiom) so the React binding can use it as its effect cleanup.
 *
 * ONE ARM IN, ONE SETTER OUT — there is deliberately no `connected` branch and no branch of any other
 * kind, which is the half of `backgroundTaskRosterBridge` this path must NOT copy. That bridge's
 * reset is the sole enforcement of ITS AC5 and is why its store is absent from
 * `clearPairingScopedState`; this store's lifetime is the opposite case on both counts, so #955 put its
 * clear in that helper's dep set instead (the #588 → #593 precedent) and NONE of it reaches this file. A
 * reconnect to the same daemon in the same working directory does not invalidate a published menu, so
 * clearing on `connected` would blank a correct value that nothing on this path can re-fetch — there
 * is no request half. Now that the clear exists, keeping it out of here is what keeps it
 * daemon-UNREACHABLE: no event arriving on this subscription can invoke it, and it takes no
 * conversation id, so nothing the daemon says can steer which menus survive a pairing change.
 *
 * The `snapshot !== null` guard (not `if (snapshot)` and emphatically not `if (snapshot.commands.length)`)
 * is deliberate: it mirrors announcedModelBridge's `announced !== null`. A snapshot object is truthy
 * even when its `commands` are empty, so the way an empty menu would get dropped is a `length` check
 * at the translator — which is why the translator stays unconditional and this guard stays on the
 * RECORD's presence, never on the list's contents. A content guard would drop the drop count with it.
 * The listener only translates + dispatches — it never throws into React, and it logs nothing.
 */
export function subscribeSlashCommandList(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSlashCommandList: (snapshot: SlashCommandListSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    const snapshot = translateSlashCommandList(event)
    if (snapshot !== null) setSlashCommandList(snapshot)
  })
}

/**
 * The slash-command data-path binding — a headless component mounted app-level in App.tsx, alongside
 * AnnouncedModelData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the
 * route flips. App-level is load-bearing rather than conventional here: the daemon publishes the menu
 * from a conversation's `initialize` reply, so a frame can arrive for a conversation THE USER HAS
 * NEVER OPENED and long before #940 or #681 is ever mounted — a screen-scoped listener would miss
 * exactly the case the store exists for. A component (not a hook) isolates the subscription in its
 * own leaf so it never cascades a re-render into App; it renders nothing. `window.pyry` is
 * dereferenced only inside the effect, never during render, so it server-renders to `''` without a
 * bridge mock (the QueueData invariant, which App.test's no-window-stub <App/> render depends on).
 * Reactive-only: one subscribe effect, no request effect, no useState/useRef/useSessionStore, no
 * connected gate. Ships dormant — it populates the store, but nothing renders it yet (#940, #681).
 */
export function SlashCommandListData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode
    // double-mount nets exactly one live listener (the announcedModelBridge idiom). Each frame
    // replaces its own conversation's menu and leaves every other conversation untouched.
    return subscribeSlashCommandList(window.pyry.onDaemonEvent, (snapshot) =>
      slashCommandListStore.getState().setSlashCommandList(snapshot)
    )
  }, [])

  return null
}
