import { useEffect, useRef, useState } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'
import { subscribeNewFolder } from '../../store/newFolderBridge'
import {
  newFolderStore,
  useNewFolderStore,
  selectNewFolderRoundTrip,
  type NewFolderRoundTrip
} from '../../store/newFolderStore'
import { sessionStore, selectStatusFor } from '../../store/sessionStore'
import { titleFor } from './channelListViewModel'

// #274/#288: the Save-as-channel dialog — Figma 19:24. #274 shipped the naming half (title + Name field +
// Cancel/Save) that dispatches `promoteConversation` (#273), keeping the discussion in its current `cwd`.
// #288 adds the LOCATION CHOICE: the two radios from the same node — "Move to dedicated channel folder"
// (default) and "Keep in scratch". Scratch reuses the row's existing `cwd` (the #274 behaviour). Dedicated
// is a two-verb dance over already-shipped transport: dispatch `createWorkspaceFolder` (#381), observe the
// daemon's `workspaceFolderCreated { path }` reply via #397's newFolderStore round-trip, then promote with
// that RETURNED path VERBATIM (never the previewed string — the daemon EvalSymlinks-resolves promote's cwd
// and rejects a non-existent client-templated path; #288). No keys, sockets, or raw bytes here — the two
// commands are fire-and-forget through the preload bridge, and the daemon polices both paths server-side.
//
// Three exports mirror #398's CreateFolderDialog shape: the pure view (props-in / markup-out, SSR-testable),
// the two dispatch helpers, and the in-file interaction container (untested reviewed glue; `window.pyry`
// dereferenced only at interaction time). The round-trip + location are INJECTED props on the view, so every
// state is server-renderable without a store.

/** The location the promoted channel takes: a dedicated daemon-created folder (default) or the discussion's
 *  existing scratch `cwd`. The single source of the radio group's checked state (AC1). */
export type ChannelLocation = 'dedicated' | 'scratch'

// The parent directory for dedicated channel folders — a tilde-string the daemon expands SERVER-side
// (#887's expandTilde(parent) + $HOME confinement). Held as opaque text; the renderer resolves no path
// (the #381 security posture). Matches the Figma 19:35 preview prefix.
const CHANNELS_PARENT = '~/pyry-workspace/channels'

// A stable id tying the dialog's aria-labelledby to its title element (the PERMISSION_MODAL_TITLE_ID
// idiom). A single fixed id is safe: only one Save-as-channel dialog is open at a time.
const SAVE_AS_CHANNEL_TITLE_ID = 'save-as-channel-title'

// The radio group's shared `name` — groups the two native inputs so the browser enforces single-select.
const SAVE_AS_CHANNEL_LOCATION_NAME = 'save-as-channel-location'

// Client-owned failure copy (AC5) — apostrophe-free by design: renderToStaticMarkup escapes ' → &#x27;
// (the standing desktop lesson), and workspaceFolderRejected is bare (#396), so NO daemon error text ever
// reaches this line (the #398 precedent). A single generic message the user reads then retries against.
const SAVE_AS_CHANNEL_ERROR_COPY = 'Could not create that folder'

/**
 * Derive a folder `name` (a slug) from the channel's display name. Kebab-cased, guaranteed a
 * single-clean-element + non-empty string so it ALWAYS passes the daemon's name-shape guard (#887: no
 * `/`, no `..`, not absolute, non-empty). Any run of non-alphanumerics collapses to one hyphen — which
 * kills separators, `..`, and whitespace in one pass — then edge hyphens are trimmed; an empty result
 * (e.g. a punctuation-only name) falls back to `'channel'`. Only the on-disk FOLDER is slugged; the
 * channel's display name keeps the full typed text (the promote carries `name` unslugged). Divergence
 * from mobile's slug is cosmetic — the promote always uses the daemon-returned path (#288). Pure.
 */
export function slugForChannel(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'channel' : slug
}

/**
 * The pure dialog chrome. `name` and `location` are controlled state (container-owned); `roundTrip` is the
 * injected round-trip status (#397) that drives the disabled/error display. The four effects are REQUIRED
 * injected props (the "a view that cannot act is a bug" rule). Save is disabled while the name is blank
 * (empty OR whitespace-only, the #274 gate) OR the create is in-flight; the Name input and BOTH radios are
 * disabled while in-flight (freezing the choice mid-create) — all computed inline so the disabled state is
 * directly assertable in server-rendered markup. Exactly one radio is `checked` — `location` is the single
 * source (AC1). The dedicated preview line renders only while `location === 'dedicated'`, as plain
 * auto-escaped text (never dangerouslySetInnerHTML), and it is illustrative ONLY (AC2). When `rejected`, a
 * single generic failure line renders (AC5); any other status renders none.
 */
export function SaveAsChannelDialogView({
  name,
  location,
  roundTrip,
  onNameChange,
  onLocationChange,
  onCancel,
  onSave
}: {
  name: string
  location: ChannelLocation
  roundTrip: NewFolderRoundTrip
  onNameChange: (next: string) => void
  onLocationChange: (next: ChannelLocation) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  const blank = name.trim() === ''
  const busy = roundTrip.status === 'in-flight'
  const rejected = roundTrip.status === 'rejected'
  return (
    <div className="save-as-channel-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed — the permission-modal-overlay__scrim idiom. */}
      <div className="save-as-channel-overlay__scrim" aria-hidden="true" />
      <div
        className="save-as-channel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={SAVE_AS_CHANNEL_TITLE_ID}
      >
        <h2 id={SAVE_AS_CHANNEL_TITLE_ID} className="save-as-channel__title">
          Save as channel
        </h2>
        {/* The Figma outlined Name field (19:26). The wrapping <label> gives the input its accessible
            name from the "Name" text — no id/htmlFor pair needed. Disabled while in-flight (freezes the
            typed name that the created-effect promotes with). */}
        <label className="save-as-channel__field">
          <span className="save-as-channel__label">Name</span>
          <input
            type="text"
            className="save-as-channel__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={busy}
          />
        </label>
        {/* The location radio group (Figma 19:29) — two native radios sharing one `name`, so exactly one is
            checked (AC1). Each wrapping <label> gives its radio the option text as accessible name. Both are
            disabled while in-flight so the choice can't change under an outstanding create. */}
        <div className="save-as-channel__location">
          <label className="save-as-channel__option">
            <input
              type="radio"
              className="save-as-channel__radio"
              name={SAVE_AS_CHANNEL_LOCATION_NAME}
              value="dedicated"
              checked={location === 'dedicated'}
              onChange={() => onLocationChange('dedicated')}
              disabled={busy}
            />
            <span className="save-as-channel__option-body">
              <span className="save-as-channel__option-label">Move to dedicated channel folder</span>
              {/* The illustrative slug preview (Figma 19:35) — rendered only while dedicated is selected,
                  updating live with the name (AC2). Plain auto-escaped text; ILLUSTRATIVE ONLY — the
                  promote uses the daemon-returned path, never this string (#288). */}
              {location === 'dedicated' && (
                <span className="save-as-channel__preview">
                  {`${CHANNELS_PARENT}/${slugForChannel(name)}/`}
                </span>
              )}
            </span>
          </label>
          <label className="save-as-channel__option">
            <input
              type="radio"
              className="save-as-channel__radio"
              name={SAVE_AS_CHANNEL_LOCATION_NAME}
              value="scratch"
              checked={location === 'scratch'}
              onChange={() => onLocationChange('scratch')}
              disabled={busy}
            />
            <span className="save-as-channel__option-label">Keep in scratch</span>
          </label>
        </div>
        {/* The rejected failure line (AC5) — spec-added, not in the Figma. Generic and apostrophe-free;
            reads NO daemon error text (workspaceFolderRejected is bare, #396). Absent in every other status. */}
        {rejected && <p className="save-as-channel__error">{SAVE_AS_CHANNEL_ERROR_COPY}</p>}
        {/* The action row (Figma 19:39): Cancel + Save both right-aligned (justify-end in the node) —
            this dialog groups both trailing, unlike PermissionModal's leading-dismissive Cancel. */}
        <div className="save-as-channel__actions">
          <button type="button" className="save-as-channel__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="save-as-channel__save"
            onClick={onSave}
            disabled={blank || busy}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Fire the `promoteConversation` command (#273 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained, exactly
 * as `requestNewConversation` inlines its command. All three payload fields are REQUIRED strings (the
 * deliberate opposite of create's nullable fields): `conversation_id ← conversationId`, `name ← name.trim()`
 * (a promoted channel should not carry accidental edge whitespace), and `cwd` passed VERBATIM by the caller.
 * `cwd` is externalized (#288): the scratch branch passes the row's existing `cwd`, the dedicated branch
 * passes the daemon-RETURNED path — never a client-templated string, which promote's server-side
 * EvalSymlinks would reject. It is opaque display/routing text the renderer never resolves. The view
 * disables Save on a blank name, so this is never reached with one. Fire-and-forget: `sendCommand` is `void`.
 */
export function requestPromoteConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string,
  name: string,
  cwd: string
): void {
  sendCommand({
    type: 'promoteConversation',
    payload: { conversation_id: conversationId, name: name.trim(), cwd }
  })
}

/**
 * Fire the `createWorkspaceFolder` command (#381) for the dedicated-folder branch. Distinct from #398's
 * requestCreateWorkspaceFolder (which passes `parent` + `name` raw): this one PINS the channels parent and
 * SLUGS the channel name, so the folder created and the folder previewed are the same string. An inline
 * literal typed as RendererCommand — the requestPromoteConversation twin (fire-and-forget: `sendCommand` is
 * void). `parent`/`name` are renderer strings the daemon polices server-side ($HOME confinement + the
 * single-clean-element name guard, #887); the renderer resolves no path (the #381 security posture).
 */
export function requestCreateChannelFolder(
  sendCommand: (command: RendererCommand) => void,
  channelName: string,
  serverId?: string
): void {
  sendCommand({
    type: 'createWorkspaceFolder',
    payload: { parent: CHANNELS_PARENT, name: slugForChannel(channelName) },
    ...(serverId === undefined ? {} : { serverId })
  })
}

/**
 * The Save-as-channel dialog's interaction container (the CreateFolderDialog clone, swapping the tail). Owns
 * the controlled `name` + `location` state, reads the round-trip store, mounts the dormant #397 bridge so the
 * daemon reply resolves, and owns the created-outcome side effect. Exported so ChannelList imports it.
 * `window.pyry` is dereferenced only inside interaction callbacks / the effect, never during render.
 */
export function SaveAsChannelDialog({
  row,
  onDismiss,
  onPromoted
}: {
  row: ConversationSummary & { readonly serverId?: string | null }
  // Cancel: close the dialog only.
  onDismiss: () => void
  // scratch-save OR created→promote: close the dialog.
  onPromoted: () => void
}): JSX.Element {
  // The controlled field, seeded from the row's displayed title on mount — the container mounts fresh each
  // open (ChannelList gates the mount on a non-null row), so a lazy initializer suffices with no re-seed
  // effect (the renameName precedent, moved in-container). Transient UI state → useState, not the store.
  const [name, setName] = useState(() => titleFor(row.name))
  // The location choice — dedicated by default (AC1 / Figma). Transient UI state → useState.
  const [location, setLocation] = useState<ChannelLocation>('dedicated')
  const roundTrip = useNewFolderStore(selectNewFolderRoundTrip)
  const abandoned = useRef(false)
  const pending = useRef(false)
  const serverId = row.serverId


  useEffect(() => {
    const offStatus = sessionStore.subscribe((state) => {
      if (!abandoned.current && (typeof serverId !== 'string' || selectStatusFor(serverId)(state)?.type !== 'connected')) {
        abandoned.current = true
        pending.current = false
        newFolderStore.getState().dispatch({ type: 'reset' })
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'abandoned' })
      }
    })
    const offFolder = subscribeNewFolder(
      (listener) => window.pyry.onDaemonEvent((event) => {
        if (!abandoned.current && pending.current && event.serverId === serverId) listener(event)
      }),
      (event) => newFolderStore.getState().dispatch(event)
    )
    return () => { offStatus(); offFolder() }
  }, [serverId])

  // Reset the store to idle on unmount — the single deterministic mechanism covering EVERY close path
  // (Cancel, scratch-save, created→onPromoted, Escape). Because the store is an app singleton, any close
  // that left it non-idle would show stale state on the next open; this guarantees every open starts idle.
  useEffect(() => () => newFolderStore.getState().dispatch({ type: 'reset' }), [])

  // The created side effect (AC4 second half): promote to the daemon's RETURNED path VERBATIM (never a
  // client-reconstructed parent+slug — that is EvalSymlinks-rejected daemon-side, the #288 lesson), then
  // close. The path is read BEFORE onPromoted() triggers the unmount, so the promote never races the store
  // reset. `name` is included in deps (it rides into the promote); it is frozen because the input is
  // disabled while in-flight, so it holds the value typed before Save. Only fires in the dedicated branch —
  // the scratch branch never dispatches createRequested, so the store never reaches `created`.
  useEffect(() => {
    if (roundTrip.status === 'rejected' && pending.current) {
      pending.current = false
      window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'folder-rejected' })
    }
    if (roundTrip.status !== 'created' || abandoned.current || !pending.current || !isHostConnected(serverId)) return
    pending.current = false
    requestPromoteConversation(window.pyry.sendCommand, row.id, name, roundTrip.path)
    window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'sent' })
    onPromoted()
  }, [roundTrip, row.id, name, onPromoted, serverId])

  return (
    <>
      <SaveAsChannelDialogView
        name={name}
        location={location}
        roundTrip={roundTrip}
        onNameChange={setName}
        onLocationChange={setLocation}
        onCancel={onDismiss}
        // Branch on the location choice. Scratch (AC3): promote immediately with the row's existing cwd,
        // no round-trip. Dedicated (AC4 first half): dispatch createRequested (→ in-flight; disables Save +
        // input + radios) THEN send the slugged createWorkspaceFolder; the created-effect does the promote,
        // NOT here. window.pyry is dereferenced only here (interaction time, never render).
        onSave={() => {
          if (abandoned.current || !isHostConnected(serverId) || pending.current || name.trim() === '') return
          if (location === 'scratch') {
            requestPromoteConversation(window.pyry.sendCommand, row.id, name, row.cwd)
            window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'sent' })
            onPromoted()
            return
          }
          pending.current = true
          newFolderStore.getState().dispatch({ type: 'createRequested' })
          requestCreateChannelFolder(window.pyry.sendCommand, name, typeof serverId === 'string' ? serverId : undefined)
          window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'folder-requested' })
        }}
      />
    </>
  )
}

function isHostConnected(serverId: string | null | undefined): boolean {
  return typeof serverId === 'string' &&
    selectStatusFor(serverId)(sessionStore.getState())?.type === 'connected'
}
