import { useEffect, useState } from 'react'
import { MAX_SYSTEM_PROMPT_BYTES } from '@shared/wire/types'
import { Modal } from '../../components/Modal'
import { systemPromptOverLimit } from './CreateChannelDialog'
import { requestSystemPrompt, translateSystemPrompt } from '../../store/systemPromptBridge'
import { submitSystemPrompt } from '../../store/systemPromptWriteBridge'
import { systemPromptWriteStore } from '../../store/systemPromptWriteStore'
import { conversationListStore } from '../../store/conversationListStore'
import { conversationMutedIn } from '../../store/pushNotifyBridge'

/**
 * The dialog's one client-owned string (#1476), in `EDIT_CHAT_COPY`'s idiom one dialog over: a module
 * constant, apostrophe-free, interpolating no conversation name. It sits here rather than inline because
 * IT IS A LOAD-BEARING e2e LOCATOR AND MAY NOT BE REWORDED — five specs find this dialog by
 * `getByRole('dialog', { name: … })`, one of them a `real-*` spec behind the live gate.
 *
 * SENTENCE CASE against the drawing's title-case "Edit Channel", matching every sibling dialog in this
 * directory (Edit chat, Edit host, Edit workspace, Create channel, Add workspace).
 *
 * NOT shared with `ChannelList`'s `EDIT_CHANNEL_CONTROL_LABEL`, which happens to carry the same two
 * words: that constant names the PEN and is read by its `aria-label` and its hover pill; this one names
 * the DIALOG. Folding them together would couple a control's accessible name to a modal's heading across
 * a module boundary for a coincidence of wording — the ruling `HOST_ROW_FALLBACK_LABEL` already records.
 */
const EDIT_CHANNEL_TITLE = 'Edit channel'

/**
 * #1438's button, and the SECOND load-bearing e2e locator in this file — its text is the button's
 * accessible name (no `aria-label`, which would put a string into an attribute), so it is what
 * `getByRole('button', { name: … })` matches in two specs. Client-owned and interpolating NEITHER the
 * channel's name NOR its id.
 *
 * ARCHIVE, NOT REMOVE, settled by the refiner on 2026-09-15 against the ticket's own filed title: the
 * drawing letters it this way, the sibling chat dialog one module over already ships `Archive chat` for
 * the identical act, and the act really is an archive — the channel lands in the Archive screen's
 * Channels tab and Restore brings it back. `Remove` beside Channel info's genuinely destructive `Delete`
 * would make the gentler of the two sound like the harsher.
 *
 * It is disjoint from `EDIT_CHAT_COPY.archive` only from its fifth-from-last character on
 * (`Archive cha|t` against `Archive cha|nnel`) — the same razor-thin margin the two pens' `Edit chat` /
 * `Edit channel` labels keep, and the same one a careless reword would close. Both this file's tests and
 * the chat dialog's assert the two literals apart on exactly that.
 */
const ARCHIVE_CHANNEL_LABEL = 'Archive channel'

/**
 * #1477's three client-owned lines, apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`). NO
 * DAEMON STRING REACHES ANY OF THEM.
 *
 * All three RESTATE wording that already ships rather than importing it — the label and the over-limit
 * line from `ChannelForm`, the reading line from `SystemPromptSection`'s `SYSTEM_PROMPT_LOADING`. That is
 * `ChannelForm`'s own stated ruling applied twice: the section module is sheet-scoped and drags two
 * stores and the write bridge into whatever imports it, and nothing in this directory imports from
 * `screens/conversation/`. The only thing that could drift NUMERICALLY is the bound, and every side reads
 * that from the one shared constant.
 */
const SYSTEM_PROMPT_LABEL = 'Channel system prompt:'
const SYSTEM_PROMPT_READING = 'Reading the stored prompt from the daemon'
const SYSTEM_PROMPT_OVER_LIMIT = `Over the ${MAX_SYSTEM_PROMPT_BYTES}-byte limit. Shorten it before saving.`

/**
 * #1608's checkbox label, the drawing's `Checkbox with label` (540:2158). Client-owned, and its text is
 * the native checkbox's accessible name through the wrapping `<label>`, so no `aria-label`.
 */
const MUTE_NOTIFICATIONS_LABEL = 'Mute notifications'

/**
 * The checkbox's ticked Selector (Figma `Checkbox` 347:6211): `QuestionTick`'s path restated under this
 * dialog's namespace rather than imported, because nothing in this directory imports from
 * `screens/conversation/`. Inline JSX for `QuestionTick`'s CSP reason: the window has no `img-src`, so
 * Figma's asset URL would draw nothing.
 */
function MuteTick(): JSX.Element {
  return (
    <svg
      className="edit-channel__mute-tick"
      viewBox="0 0 12 12"
      fill="currentColor"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M10.7051 1.63436C11.0243 1.85929 11.0957 2.29186 10.8636 2.60114L5.14911 10.2142C5.02634 10.3786 4.8366 10.4803 4.62678 10.4976C4.41695 10.5149 4.21382 10.4392 4.06649 10.2964L1.20927 7.52802C0.930244 7.25767 0.930244 6.81862 1.20927 6.54827C1.48829 6.27792 1.94143 6.27792 2.22046 6.54827L4.48615 8.74352L9.70951 1.78576C9.94166 1.47648 10.3881 1.40727 10.7073 1.6322L10.7051 1.63436Z" />
    </svg>
  )
}

/**
 * Which arm of the read the field is in — a SEALED UNION rather than a `value` beside a `reading` flag,
 * and that is load-bearing rather than stylistic: the `reading` arm has NO VALUE FIELD AT ALL, so a box
 * that has not been answered cannot show a draft it does not have, and the compiler says so.
 *
 * Both arms render the text area. The `reading` one renders it EMPTY and `disabled`; `disabled` and
 * emphatically not `readOnly`, for two reasons that point the same way. A disabled control stays out of
 * the tab order, which is what keeps `conversation-create-rename.spec.ts`'s two-Tab walk (input → Cancel
 * → OK) passing at a tier that never answers the ask — `conversationStateFake` handles neither verb of
 * this vertical, so the fake tier lives in this arm permanently. And `disabled` is one of the props React
 * accepts in place of `onChange` on a controlled field, so the arm needs no dead handler to stay quiet.
 */
export type EditChannelPrompt =
  | { state: 'reading' }
  | {
      state: 'read'
      value: string
      /** Derived by the container, which needs the same answer to disable OK. */
      overLimit: boolean
      onChange: (next: string) => void
    }

/**
 * Controlled presentation; callers retain draft, focus and dismissal ownership.
 *
 * `EditChatDialogView`'s shape MINUS `available`, and a separate module rather than a prop on it,
 * because the two dialogs' class namespaces must not collide: six shipped specs find the chat dialog
 * through `.rename-conversation*`, and #1438's own outlined button below the fields wears
 * `.edit-channel*`. Two locator sets is the whole reason for two files.
 *
 * NO `available` PROP — and #1438 ANSWERED THAT FORECAST "NO" RATHER THAN ADDING ONE. The earlier text
 * here predicted the prop arriving with "the second button that needs it". It does not need it. The twin
 * carries one because #1440's AC3 lives in the GAP between two buttons' disabled expressions — OK reads
 * `blank || !available`, Archive chat reads `!available` alone. #1438's AC1 removes that gap outright:
 * its button CARRIES NO DISABLED ARM OF ITS OWN, being live on a blank name and while the prompt read is
 * still outstanding, because those are OK's conditions and not its. With no disabled expression there is
 * nothing for the prop to feed, and a second host authority in the render could only disagree with the
 * interaction-time re-check that is already the only thing standing between a disconnect and a send.
 * The host guard stays the container's pair: the render gate on `connected(…)`, plus each caller's live
 * re-check at interaction time rather than against React state.
 *
 * #1477 DID NOT ADOPT `ChannelForm`, which draws this same field for the create dialog. Doing so would
 * have moved this dialog onto `.create-channel*` locators against the ruling above, and widening that
 * component's bundled `prompt` prop reaches nothing here — this view has always drawn its own field. The
 * text area's treatment is restated under this namespace instead, declaration for declaration, exactly
 * as #1476 restated the input's.
 */
export function EditChannelDialogView({
  name,
  prompt,
  muted,
  onMutedChange,
  onNameChange,
  onCancel,
  onSave,
  onArchive
}: {
  name: string
  prompt: EditChannelPrompt
  /** #1608: the checkbox's current state. Required, per `onArchive`'s rule below: an optional pair would
   *  ship an inert control on whichever of the two mount sites nobody remembered. */
  muted: boolean
  onMutedChange: (next: boolean) => void
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
  // #1438: the archive button's effect. REQUIRED, not optional — the `EditWorkspaceArchive` rule the
  // chat dialog restates: a view that cannot act is a bug, so forgetting to wire it is a COMPILE ERROR
  // rather than an inert button. That matters more here than it did there, because this view's container
  // has TWO mount sites (the sidebar row's pen and, since #1431, the Channel info sheet's edit pill), and
  // an optional prop would have shipped a dead button on whichever one nobody remembered.
  //
  // NULLARY, because the dialog is open against exactly ONE conversation, whose id both callers already
  // hold; a parameter would be a value the caller reads straight back out of its own state.
  onArchive: () => void
}): JSX.Element {
  return (
    <div className="edit-channel-overlay">
      <div className="edit-channel-overlay__scrim" aria-hidden="true" />
      <Modal
        title={EDIT_CHANNEL_TITLE}
        width={640}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        // Disabled on a BLANK name alone. The "unchanged name sends nothing" half of AC2 is deliberately
        // NOT expressed here: OK stays live on an untouched field and dismisses, because a dialog whose
        // only exit went dead the moment you opened it reads as broken. The decision not to send is the
        // container's, taken beside the send where the row's seeded title is in scope.
        //
        // #1477 added ONE arm and deliberately not two. A prompt past the bound disables OK, because
        // main would refuse that write anyway. AN OUTSTANDING READ DOES NOT, which is this ticket's
        // headline: `system_prompt` is reply-only, so a relay that withholds the frame would leave a
        // blocked OK blocked forever — and at the fake tier, which answers the ask never, it would never
        // enable at all, taking three shipped specs down with it. The hazard a gate here would have
        // reached for is closed structurally instead: the `reading` arm has no draft to send, and the
        // container's write fires only on a DIFFERENCE from what was read.
        confirmAction={{
          label: 'OK',
          onClick: onSave,
          disabled: name.trim() === '' || (prompt.state === 'read' && prompt.overLimit)
        }}
        onClose={onCancel}
      >
        {/* The drawing's `Input large` (500:2118) — a semibold label above a filled, borderless field.
            The shared Modal already draws everything around it: the title, the close control, the rule
            under them and the centred Cancel/OK footer. */}
        <label className="edit-channel__field">
          <span className="edit-channel__label">Channel name:</span>
          <input
            type="text"
            className="edit-channel__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        {/* The drawing's `Text area large` (500:2151), the same component #1428 translated one dialog
            over. The wrapping label gives the box its accessible name from the visible label text — the
            name field's own idiom, no id/htmlFor pair. Four rows over a 20px line and 16px of vertical
            padding is the drawing's 112px box, and the 12px between the two fields is the shared Modal's
            own `.modal__content` gap rather than a rule of this ticket's.

            SECURITY — the prompt is operator-authored text that may hold a pasted credential, and unlike
            the create dialog's draft it arrives OVER THE NETWORK before it is ever shown. It reaches ONE
            sink: the controlled `<textarea value={…}>`, which React renders as an escaped TEXT CHILD
            server-side and sets as a DOM PROPERTY in the browser — never a serialized attribute, no
            dangerouslySetInnerHTML, no URL, no filename, no cache key, no React `key`, no `aria-label`.
            Nothing in this file logs, and nothing trims or normalises the value: it round-trips to the
            daemon as a write, so any normalisation would silently change what the operator stored. */}
        <label className="edit-channel__field">
          <span className="edit-channel__label">{SYSTEM_PROMPT_LABEL}</span>
          {prompt.state === 'reading' ? (
            <textarea className="edit-channel__textarea" rows={4} value="" disabled />
          ) : (
            <textarea
              className="edit-channel__textarea"
              rows={4}
              value={prompt.value}
              onChange={(e) => prompt.onChange(e.target.value)}
            />
          )}
        </label>
        {/* Both lines sit OUTSIDE the label — inside, either would join the field's accessible name —
            and deliberately NOT role="alert": the notice would re-announce on every keystroke past the
            bound, and the reading line reports progress rather than a settled failure. */}
        {prompt.state === 'reading' && (
          <p className="edit-channel__reading">{SYSTEM_PROMPT_READING}</p>
        )}
        {prompt.state === 'read' && prompt.overLimit && (
          <p className="edit-channel__notice">{SYSTEM_PROMPT_OVER_LIMIT}</p>
        )}
        {/* #1608 — the drawing's `Checkbox with label` (540:2158), between the text area and the
            Actions row. The native input is visually hidden and keeps focus, keyboard and the accessible
            name; the aria-hidden span draws the design's 20px ring and tick. Like Archive channel it has
            NO DISABLED ARM: it only edits a draft, and the write is taken at OK inside the caller's
            host re-check. */}
        <label className="edit-channel__mute">
          <input
            type="checkbox"
            className="edit-channel__mute-input"
            checked={muted}
            onChange={(e) => onMutedChange(e.target.checked)}
          />
          <span className="edit-channel__mute-control" aria-hidden="true">
            {muted && <MuteTick />}
          </span>
          <span className="edit-channel__mute-label">{MUTE_NOTIFICATIONS_LABEL}</span>
        </label>
        {/* #1438 — the content frame's own `Actions` row (502:2168), the drawing's LAST child of
            `Content`: below the text area, above the centred footer, with the drawing's 8px top inset.
            The two notice lines stay between it and the text area they describe.

            ⭐ NO `disabled` ARM, ON ANY BRANCH, and that is the whole shape of AC1 rather than an
            omission. OK's two conditions — a blank name, a prompt past the byte bound — are OK's: putting
            a channel away has nothing to do with what either field currently holds, and it is live while
            the prompt read is still outstanding for the same reason. Reusing OK's expression here is the
            regression the static tests are pointed at. The host guard is not missing either; it is taken
            at INTERACTION TIME by each caller's own re-check, against the live session store rather than
            against a render snapshot.

            Its classes share no name with the Edit chat, Edit host or Edit workspace dialogs — the
            Playwright-locator rule the Edit host dialog's knowledge page states and `channels.css`
            restates twice. The text is the accessible name; no `aria-label`. */}
        <div className="edit-channel__actions">
          <button type="button" className="edit-channel__archive" onClick={onArchive}>
            {ARCHIVE_CHANNEL_LABEL}
          </button>
        </div>
      </Modal>
    </div>
  )
}

/**
 * The read's two arms, held as ONE cell so the seed and the draft cannot disagree about whether a reply
 * has landed. `seed` is what the daemon said; `draft` is what the box holds now, started equal to it.
 *
 * The `reading` arm carries NEITHER, which is what makes AC2's "a modal whose reading never arrived sends
 * nothing whatever it shows" a type-level fact rather than a guard somebody can forget: there is no draft
 * to send and nothing to compare it against.
 */
export type PromptState =
  | { type: 'reading' }
  | { type: 'read'; seed: string; draft: string }

/**
 * The reading's prompt as a seed string, `SystemPromptSection`'s `seedFor` spelling restated for this
 * dialog's cell.
 *
 * THE TRI-STATE SURVIVES THE TRIP BECAUSE THIS IS AN EXPLICIT `=== undefined`, not `?? ''` and not a
 * truthiness read. An ABSENT prompt (`undefined`) and an explicitly EMPTY one (`''`) both seed an empty
 * box — they are indistinguishable to the operator, and that collapse is deliberate and one-way. It is
 * the WRITE rule below, comparing the draft against this seed, that decides `null` versus text on the way
 * back, which is why nothing is lost by seeding them alike and why a `?? ''` written here instead would
 * have made the clear path unreachable with no type error and no failing test unless one is written.
 */
function seedFrom(systemPrompt: string | undefined): string {
  if (systemPrompt === undefined) return ''
  return systemPrompt
}

/**
 * What OK should send for this cell, or `null` for "send nothing" (AC2). Pure and exported so the whole
 * write rule is provable without a DOM — no renderer spec in this repo can click, so a helper like this
 * is the only place the decision is reachable at the unit tier.
 *
 * Note the two different `null`s, which is the one thing to read carefully here: THIS function's `null`
 * return means SEND NOTHING, while the `string | null` it wraps is the wire's own tri-state where `null`
 * means CLEAR. Hence the `{ prompt }` box on the send branch — an unwrapped `string | null` return could
 * not tell "send a clear" from "send nothing" at all.
 *
 * The rule, in the order the AC states it: a cell still `reading` sends nothing (there is no draft); a
 * draft equal to the seed sends nothing, which covers both an untouched box and a box empty before and
 * after; an EMPTIED box sends `null` to clear; anything else sends its text VERBATIM AND UNTRIMMED,
 * because the value round-trips to the daemon as a write and normalising it here would silently change
 * what the operator stored.
 *
 * The emptied-box-is-a-clear rule DIVERGES FROM `SystemPromptSection`, whose docblock rules that a clear
 * is a control the operator presses and is never inferred from an empty box. The divergence is
 * deliberate: that section has a Save and a Clear, this modal has one OK, so an emptied box is the only
 * spelling a clear has here. Its one consequence is accepted — this modal cannot store an explicitly
 * empty `''`, only `null`, and the two are indistinguishable in the box anyway. Do not "correct" this
 * toward the section's ruling.
 */
export function promptWriteFor(state: PromptState): { prompt: string | null } | null {
  if (state.type !== 'read') return null
  if (state.draft === state.seed) return null
  return { prompt: state.draft === '' ? null : state.draft }
}

/**
 * #1608's checkbox cell: `seed` is the host's value when the dialog opened, `draft` what the box holds.
 * A cell rather than a bare boolean for `PromptState`'s reason: the write rule needs what was read.
 */
export type MuteState = { seed: boolean; draft: boolean }

/**
 * What OK should send for the mute cell, or `null` for "send nothing" — an unchanged box writes nothing
 * (AC3). Pure and exported for `promptWriteFor`'s reason: no renderer spec here can click.
 */
export function muteWriteFor(state: MuteState): { muted: boolean } | null {
  if (state.draft === state.seed) return null
  return { muted: state.draft }
}

/**
 * The Edit channel dialog's container (#1477) — the `CreateChannelDialog` shape, and a container at all
 * rather than three more cells in `ChannelList` for one reason that does the work of several: it is
 * mounted only while a row's dialog is open, SO ITS SUBSCRIPTION'S LIFETIME IS THE DIALOG'S OPEN LIFETIME.
 * That is what makes AC2's "a reopen starts from a fresh ask rather than the abandoned draft" true BY
 * CONSTRUCTION, with no reset code to write and nothing extra to clear on host loss. `ChannelList` is
 * past 2500 lines and already clears five dialogs' cells in one subscription; a sixth set would be three
 * more things an edit to that branch could forget.
 *
 * PRIMITIVE PROPS, not the row. `SidebarRow` is module-local to `ChannelList`, and exporting a type
 * across this boundary to hand over an object whose two useful fields are both strings would widen the
 * seam for no gain.
 *
 * WHY THIS MODAL ASKS FOR ITSELF. It opens from ANY row, not only the open conversation, so it cannot
 * read `systemPromptStore`: that store holds the open chat's reading alone, and `subscribeSystemPrompt`
 * beside it drops every reply whose `conversationId` is not the open one — which is the whole reason this
 * subscribes for itself rather than reusing that helper. `translateSystemPrompt` IS reused, being
 * React-free and arm-scoped.
 *
 * This is therefore a SECOND ASK SITE beside `PairedShell`'s activation ask: one shot per open, NEVER A
 * RETRY, with no `connected`-edge refresh and no turn-end refresh. `systemPromptBridge`'s header forbids
 * anything more — a client-side retry against a relay that withholds a reply-only frame is a
 * self-inflicted spin driven by an on-path party. Checked for an amplification path and found none: a
 * `connected` flap CLOSES this dialog (`ChannelList`'s subscription clears the row) rather than reopening
 * it, so a flapping host cannot pump asks.
 *
 * THE MODAL WRITES NOTHING INTO `systemPromptStore`, but its ask can still cause a write there: when the
 * edited row IS the open conversation, the app-level `SystemPromptData` subscriber matches the same reply
 * and stores it. That is harmless and correct — do not add a check asserting the read store is untouched.
 *
 * NOTHING HERE LOGS, ON ANY BRANCH, and that is a security decision rather than an omission. There is
 * deliberately no "dropped an unrelated reply" diagnostic on either gate and no `sendDiagnostic` of this
 * container's own, unlike `CreateChannelDialog`: every field that would make one useful here — the
 * conversation id, the prompt, its length — is forbidden. For the same reason this file must NEVER switch
 * exhaustively over `DaemonEvent`: an `assertNever` guard `JSON.stringify`s the whole event into an
 * `Error` message, which for this arm is the operator's prompt text on a path that can reach a console or
 * a crash reporter. Reusing `translateSystemPrompt`'s `default: null` is how that bound is inherited.
 */
export function EditChannelDialog({
  conversationId,
  serverId,
  name,
  onNameChange,
  onCancel,
  onSave,
  onArchive
}: {
  conversationId: string
  serverId: string
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  /**
   * #1438's archive intent, forwarded VERBATIM to the view and given no guard, no send and no log of its
   * own here. Both live with the caller, deliberately: the two mount sites re-check different halves of
   * the same question — `ChannelList` with `canMutateHost`, which also emits the one content-free
   * `sidebar-mutation` diagnostic on refusal, and the Channel info sheet with
   * `connectedConversationHostNow`, because it acts on the open conversation — and this container is in
   * no position to choose between them. Importing either would also reach across a boundary this module
   * keeps closed: `ChannelList` already imports this file, and nothing in this directory imports from
   * `screens/conversation/`.
   *
   * NOTHING ON THIS PATH MAY CALL `writePrompt`. The archive sends exactly one command and dismisses;
   * saving the in-progress draft on the way past would put the operator's system prompt — which #1477's
   * own header treats as possibly holding a pasted credential — onto the wire from a click that promised
   * to send nothing else. The draft simply dies with this container's unmount.
   */
  onArchive: () => void
  /**
   * #1476's OK — its host re-check, its own rename comparison and its dismissal — with this ticket's
   * prompt write handed IN to be run inside that same guard.
   *
   * A callback parameter rather than a boolean return, and that shape is the point: the write is only
   * REACHABLE from inside the guarded body, so it cannot be sent to a host that just went away however
   * this container is later edited. A `() => boolean` would have left that property resting on a caller
   * remembering to read the result. It also keeps the refusal path emitting EXACTLY ONE
   * `sidebar-mutation` diagnostic — there is still only one guard — and it avoids the import cycle that
   * exporting `canMutateHost` out of `ChannelList` would have created, that module importing this one.
   */
  onSave: (writePrompt: () => void) => void
}): JSX.Element {
  const [prompt, setPrompt] = useState<PromptState>({ type: 'reading' })
  // #1608: seeded ONCE, at mount, from this server's own row — the container mounts only while the
  // dialog is open, so a reopen re-reads the host's value by construction, and a list refresh while it is
  // open never moves the operator's draft.
  const [mute, setMute] = useState<MuteState>(() => {
    const seed = conversationMutedIn(conversationListStore.getState(), serverId, conversationId)
    return { seed, draft: seed }
  })

  useEffect(() => {
    // Subscribe BEFORE asking, so a reply that arrives inside the same tick cannot outrun the listener.
    // The returned off handle is the effect cleanup — the whole cancellation path for this dialog, since
    // nothing here starts a promise, a timer or an interval, so there is no AbortController to thread. A
    // StrictMode double-mount therefore nets exactly one live listener (the `announcedModelBridge` idiom)
    // and two idempotent asks in development; the e2e tier runs the production bundle and sees one. DO
    // NOT "fix" that with a fired-once ref — it would also suppress the fresh ask a REOPEN must fire.
    const off = window.pyry.onDaemonEvent((event) => {
      // Both gates run on the RAW EVENT, before the translator, and return before any setter — never a
      // partial write. The host stamp first, the `CreateChannelDialog` idiom: inspect main's original
      // mark before flattening, because these replies carry no renderer request id.
      if (serverId === '' || event.serverId !== serverId) return
      // Then attribution, `subscribeSystemPrompt`'s gate with the open-conversation compare swapped for
      // THIS ROW's id — which is the entire reason that helper could not be reused. Both sides of the
      // comparison are client-owned: `conversationId` came from the row this app listed, and the reply's
      // is resolved in the background process from the request this app itself sent, never parsed off the
      // network.
      if (event.type === 'systemPromptReceived' && event.conversationId !== conversationId) return
      const reading = translateSystemPrompt(event)
      if (reading === null) return
      // FIRST MATCHING REPLY WINS. Seeding only out of the `reading` arm is what stops a duplicate or
      // late second reply from clobbering a draft the operator has already started — the hazard
      // `deriveSystemPromptSection`'s docblock names, closed here by the arm rather than by a separate
      // "has the draft been touched" test. `sessionPromptStatus` rides along on the reading and is
      // DROPPED ON THE FLOOR: the `differs` notice belongs to the section, which has a Reset session
      // control to point at, and a modal with one OK has nothing to do with it.
      setPrompt((current) =>
        current.type === 'reading'
          ? { type: 'read', seed: seedFrom(reading.systemPrompt), draft: seedFrom(reading.systemPrompt) }
          : current
      )
    })
    requestSystemPrompt(window.pyry.sendCommand, conversationId)
    return off
  }, [conversationId, serverId])

  return (
    <EditChannelDialogView
      name={name}
      onNameChange={onNameChange}
      onCancel={onCancel}
      onArchive={onArchive}
      muted={mute.draft}
      onMutedChange={(next) => setMute((current) => ({ ...current, draft: next }))}
      prompt={
        prompt.type === 'reading'
          ? { state: 'reading' }
          : {
              state: 'read',
              value: prompt.draft,
              // The typing-time bound, imported from the create dialog rather than re-derived: it reads
              // the one shared `MAX_SYSTEM_PROMPT_BYTES` that main enforces independently with
              // `Buffer.byteLength`, and a second authority here could only disagree with the first.
              overLimit: systemPromptOverLimit(prompt.draft),
              onChange: (next) =>
                setPrompt((current) =>
                  current.type === 'read' ? { ...current, draft: next } : current
                )
            }
      }
      onSave={() =>
        onSave(() => {
          const write = promptWriteFor(prompt)
          // Not an early return since #1608: the mute write below must still be reached.
          if (write !== null) {
            try {
              submitSystemPrompt(
                {
                  sendCommand: window.pyry.sendCommand,
                  dispatch: (event) => systemPromptWriteStore.getState().dispatch(event)
                },
                conversationId,
                write.prompt
              )
            } catch {
              // Deliberately silent, `writePrompt`'s ruling one dialog over: `sendCommand` can throw
              // locally, an exception escaping here would abort the caller's dismissal and strand this
              // modal over a channel it has already renamed, and it would carry the failed command —
              // prompt included — onto an error path this file does not control. The in-flight marker
              // `submitSystemPrompt` records before sending is swept by the write store's `reconnected`
              // arm, and there is nothing loggable here that is not forbidden.
            }
          }
          // #1608: the mute write, in its OWN try so a local throw from the prompt send cannot suppress
          // it and vice versa. Only reachable inside the caller's host re-check, so it reaches the
          // channel's own host and never a disconnected one. The `conversationMuteResult` it earns is
          // deliberately unread: OK dismisses, and a reopen shows the host's value.
          const muteWrite = muteWriteFor(mute)
          if (muteWrite === null) return
          try {
            window.pyry.sendCommand({
              type: 'setConversationMuted',
              payload: { conversation_id: conversationId, muted: muteWrite.muted },
              attemptId: crypto.randomUUID()
            })
          } catch {
            // Silent for the prompt write's reason above.
          }
        })
      }
    />
  )
}
