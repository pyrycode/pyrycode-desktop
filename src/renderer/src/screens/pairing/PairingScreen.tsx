import { useReducer, useRef } from 'react'
import './pairing.css'
import {
  initialPairingState,
  pairingReducer,
  runSubmit,
  runConfirm,
  groupFingerprint,
  type PairingBridge,
  type PairingState
} from './pairingState'
import { MAX_HOST_LABEL_LENGTH, type PairingErrorReason } from '@shared/ipc/pairing'

// The desktop pairing screen: paste the payload printed by `pyry pair --print`, review the
// server-key fingerprint the background process derives, and confirm. The PASTE phase is drawn from
// desktop's OWN Figma frame (node 103-2901, 1280x1024) — a full-window page sharing the welcome
// screen's skeleton (#665). The reviewing/confirming phases still wear the mobile "Paste pairing
// code" dialog card (19-54) stretched to the window; they are desktop-specific (the human
// fingerprint-verify step mobile's paste path skipped, #53) and have no frame yet, so the flow looks
// deliberately inconsistent between the two treatments until that design lands.
//
// SECRET HYGIENE. The pasted payload is a bearer token (mobile's PasteCodeDialog.kt:25-26 carries the
// rule verbatim: it "must never reach Log.*"). It lives in reducer state, is handed opaquely to the
// one submitPairingPaste call, and reaches no logger, no diagnostic channel, and no console. The
// clear control below writes a CONSTANT empty string — it never reads the value it discards.
//
// Since #825 the hero holds a SECOND input — the optional host name — beside the token field, which
// is the one new exposure that arrangement creates: a <form> ancestor, or a `name`/`id` on either
// input, can make a password manager read the pair as a credential form and capture the pairing
// code. So neither input carries a `name` or an `id`, the two stay siblings under the hero div with
// no <form> anywhere, and both set autocomplete off and spellcheck off. PairingScreen.test.tsx pins
// all of that as a regex over the rendered <input> tags. The host name is NOT a secret and needs no
// handling of its own beyond that; the field's maxLength is a UX affordance, never the security
// bound — isPairingRequest remains the sole enforcement point (shared/ipc/pairing.ts:115-116).
//
// PairingView is pure (props in, markup out — what the tests render); PairingScreen is the thin
// container owning the reducer and the two handler-driven IPC calls, mirroring the tested
// sessionStore / untested daemonEventBridge split. Everything security-relevant lives in main:
// this screen only ever holds the paste it collects and the fingerprint/reason it gets back.

/**
 * Value-free copy for each PairingErrorReason category. The IPC layer surfaces only these coarse
 * categories (#54) — no secret, no path — so the mapping is a fixed Record with no interpolation.
 */
const ERROR_COPY: Record<PairingErrorReason, string> = {
  'invalid-paste': "That doesn't look like a valid pairing code — check you copied the whole thing.",
  'invalid-key': 'The server key in that code is malformed.',
  'malformed-request': 'Something went wrong sending the code. Try again.',
  'no-pending-pairing': 'The pairing expired — paste the code again.',
  'persist-failed': 'Couldn’t save the pairing — your system keychain may be unavailable.'
}

/**
 * Client-owned paste-phase copy — module-level constants (the WELCOME_COPY / ARCHIVE_COPY idiom).
 *
 * `footer` is RESTATED here rather than imported from WelcomeScreen.tsx even though the two frames
 * draw the same line: this codebase has no shared cross-screen module or stylesheet, and a
 * cross-screen import would make the pairing screen depend on the welcome screen's internals for a
 * string. The separator is U+00B7 MIDDLE DOT, not a hyphen or a bullet.
 *
 * `instruction` is flat text, deliberately WITHOUT the `<code className="pairing__accent">` wrapper
 * the deleted instruction paragraph gave `pyry pair --print`. M3 supporting text is a single 12px
 * type role, and the frame draws its supporting slot empty, so a mono accent inside it would be a
 * visual invention with no reference. `.pairing__accent` survives untouched for ReviewCard.
 */
const PAIRING_COPY = {
  instruction: 'Run pyry pair --print on your server and paste the output here.',
  footer: 'Open source · github.com/pyrycode/pyrycode-desktop',
  // One constant for the host field's visible span AND its aria-label: label-in-name requires the
  // two to match, and a single source is the only way that stays true through a rename. "(optional)"
  // is part of the name on purpose — it is the sole affordance saying the field may be skipped,
  // since this field has no supporting line. The name must also stay clear of "Pairing code" (which
  // PairingScreen.test.tsx counts) and of "Pair" / "Clear pairing code" (which pairingArrival and
  // live-drive.mjs match with `exact: true`).
  hostFieldLabel: 'Host name (optional)'
} as const

export interface PairingViewProps {
  state: PairingState
  onPasteChange: (paste: string) => void
  onLabelChange: (label: string) => void
  onSubmit: () => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Pure presentational component — no hooks, no state, no effects. One render per phase.
 *
 * The root carries `.pairing` in EVERY phase and adds the treatment as a second class. That is a
 * contract, not a style choice: e2e/smoke.spec.ts:81 binds `page.locator('.pairing')` ONCE and
 * asserts it visible on the paste phase (:86) and count 0 after Cancel (:93). Renaming the paste
 * phase's root would fail the first outright and make the second pass for the wrong reason.
 */
export function PairingView(props: PairingViewProps): JSX.Element {
  const { state, onPasteChange, onLabelChange, onSubmit, onConfirm, onCancel } = props
  const isPaste = state.phase === 'editing' || state.phase === 'submitting'
  return (
    <div className={`pairing ${isPaste ? 'pairing-page' : 'pairing-card'}`}>
      {isPaste && (
        <EntryPage
          paste={state.paste}
          // The optionality is resolved HERE, once, so EntryPage takes a plain string and its input
          // is unconditionally controlled. An absent key means "never typed" in state; at the field
          // it is simply an empty value.
          label={state.label ?? ''}
          error={state.phase === 'editing' ? state.error : null}
          busy={state.phase === 'submitting'}
          onPasteChange={onPasteChange}
          onLabelChange={onLabelChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
      {(state.phase === 'reviewing' || state.phase === 'confirming') && (
        <ReviewCard
          fingerprint={state.fingerprint}
          busy={state.phase === 'confirming'}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
      {state.phase === 'paired' && <p className="pairing__success">Paired ✓</p>}
    </div>
  )
}

/**
 * The paste phase as the full-window Pair Screen (Figma 103-2901): the M3 filled field centred in the
 * free space — since #825 joined below by the optional host-name field, which the frame does not draw
 * — and the CTA stack pinned to the bottom. No heading: the frame draws none, and this renderer has
 * no visually-hidden utility to compensate with (adding one is unticketed); the screen is left
 * navigable by its named fields and two named buttons.
 */
function EntryPage({
  paste,
  label,
  error,
  busy,
  onPasteChange,
  onLabelChange,
  onSubmit,
  onCancel
}: {
  paste: string
  label: string
  error: PairingErrorReason | null
  busy: boolean
  onPasteChange: (paste: string) => void
  onLabelChange: (label: string) => void
  onSubmit: () => void
  onCancel: () => void
}): JSX.Element {
  // The clear control UNMOUNTS ITSELF (it is gone the moment `paste` is ''), and a self-removing
  // control drops document.activeElement to <body> — ejecting a keyboard or screen-reader user to
  // the top of the tab order right after a successful action, on a screen with no heading and only
  // three named controls. Focus goes back to the input, which is where the user wants to be after
  // clearing anyway. The `setState-then-ref.current?.focus()` shape is the house focus-return idiom
  // (ConversationScreen.tsx:2099-2107). A ref is SSR-safe, so this leaves the server-rendered test
  // tier — and the props-in/markup-out arrangement — undisturbed.
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <div className="pairing-page__hero">
        <div className="pairing-field">
          {/* The row, not the field, is the positioned element: .pairing-field's translucent-fill
              pseudo is absolutely positioned, and an absolute box with z-index: auto paints ABOVE
              its non-positioned in-flow siblings — so without this the fill would hide the label,
              the value and the glyph. See pairing.css on the painting order. */}
          <div className="pairing-field__row">
            <div className="pairing-field__content">
              {/* Visual only, and NOT a wrapping <label>. Two reasons, both load-bearing: HTML
                  forbids interactive content inside a <label>, so the clear <button> could not sit
                  in this row under that idiom; and a label would put a SECOND element under the
                  accessible name "Pairing code". aria-hidden keeps the accessibility tree at exactly
                  one — the input below — which is C1 restated for the a11y tree. The accepted cost
                  is that clicking the label text does not focus the input; the input takes the rest
                  of the 48px content box, so nearly all of the field's surface is the input itself. */}
              <span className="pairing-field__label" aria-hidden="true">
                Pairing code
              </span>
              {/*
                `aria-label` is an EXPLICIT ATTRIBUTE, never an accessible name inherited from a
                wrapping <label>. Six consumers outside this screen match the raw attribute and would
                all go dark on a name that emits no attribute: the CSS attribute selector
                `[aria-label="Pairing code"]` (e2e/unpair-repair.spec.ts:42,73,
                e2e/paired-shell-navigation.spec.ts:47, e2e/fixtures/pairingArrival.ts:54) and the
                rendered-markup substring marker (App.test.tsx:22, PairedShell.test.tsx:32). Three of
                those are count-0 assertions that pass VACUOUSLY against a stale selector, so the
                breakage would be silent; PairingScreen.test.tsx counts the attribute to catch it.

                type="text", never `password` (it would mask a value the operator may need to eyeball)
                and never `url` (the payload is a base64url blob, not a URL — see
                src/main/pairingPayload.ts:89). No `name`, no `id`, and no <form> ancestor, with
                autocomplete off and spellcheck off: a bearer token must not reach the autofill,
                spellcheck, or password-manager surfaces the old <textarea> never attracted. Vendor
                manager opt-outs (data-1p-ignore and friends) are deliberately absent — browser
                extensions cannot inject into this sandboxed renderer, so they would be dead weight.

                No placeholder: the frame draws none (the label is persistent), and the one this
                replaces — `pyry://home.lan:7117?token=…` — MISDESCRIBED the payload, which
                parsePairingPayload requires to be strict base64url.
              */}
              <input
                ref={inputRef}
                type="text"
                className="pairing-field__input"
                aria-label="Pairing code"
                autoComplete="off"
                spellCheck={false}
                value={paste}
                disabled={busy}
                onChange={(e) => onPasteChange(e.target.value)}
              />
            </div>
            {/* Deliberately absent on an empty field, diverging from the frame (which draws it
                always): offering "clear" with nothing to clear is noise. `paste !== ''`, not
                `.trim()`, because a field holding only whitespace is still worth clearing. It never
                renders `disabled` — even mid-submit it needs no guard, since pairingReducer's
                `paste-changed` arm returns state unchanged outside `editing`
                (pairingState.ts:67-70), making the click an already-safe no-op. Its own accessible
                name is distinct from both "Pairing code" (which would break the count above) and
                "Pair" (which the ten pairingArrival drives and live-drive.mjs match with
                `exact: true` while this control is on screen).

                onPasteChange takes a CONSTANT — this handler never reads the secret it discards.
                The focus call runs before React commits, so it lands on the input while this button
                is still mounted; the unmount that follows then cannot strand focus on <body>. */}
            {paste !== '' && (
              <button
                type="button"
                className="pairing-field__clear"
                aria-label="Clear pairing code"
                onClick={() => {
                  onPasteChange('')
                  inputRef.current?.focus()
                }}
              >
                <ClearIcon />
              </button>
            )}
          </div>
        </div>
        {/*
          The supporting slot the M3 field component already has (Figma I103:2904;52798:24384, drawn
          empty in this instance) holds the instruction OR the error, never both and never neither —
          so the 20px line never collapses and an error causes no layout shift. TWO elements rather
          than one whose `role` flips: a role="alert" element is announced when it is INSERTED, and
          flipping the role on a live element at the same moment its text changes is unreliable
          across screen readers. Mobile routes its pairing error through the same slot
          (PasteCodeDialog.kt:40-45).

          THE KEYS ARE LOAD-BEARING — DO NOT DELETE THEM. They look redundant (this is not a list),
          but without them the two branches are not two elements to React, only to a reader. The
          reconciler matches the slot on `key` (updateSlot: `newChild.key === key`, both null here),
          then updateElement sees `current.elementType === elementType` ('p' === 'p') and calls
          useFiber — the existing fiber and its DOM NODE ARE REUSED. No Placement effect, so a
          failed submit would add role="alert" to a LIVE node in the same commit that rewrites its
          text, which is exactly the flip ruled out above. Distinct keys make the reconciler delete
          and place instead, restoring the genuine insertion `main` got for free when the slot was
          empty until an error arrived. Nothing at the server-render tier can see this — the markup
          is identical either way — so this comment is the only guard.
        */}
        {error === null ? (
          <p key="instruction" className="pairing-field__supporting">
            {PAIRING_COPY.instruction}
          </p>
        ) : (
          <p
            key="error"
            className="pairing-field__supporting pairing-field__supporting--error"
            role="alert"
          >
            {ERROR_COPY[error]}
          </p>
        )}
        {/*
          The optional host name (#825) — the operator's display label for the machine they are
          pairing with, so they are not hunting for a settings screen afterwards. THE FIGMA FRAME
          DRAWS NO SUCH FIELD (node 103:2901 holds exactly one text-field instance, re-verified
          2026-08-27): this is a genuine design gap, and the treatment here is provisional, derived
          from the M3 filled field above — the only in-repo reference for what a field on this
          screen looks like. The label copy, the field order, and the `(optional)` affordance are the
          three things most likely to move when the updated frame lands.

          BELOW the code field, deliberately: the code is required and gates Pair, the name is
          optional garnish, and the supporting slot above must stay adjacent to the field it
          describes. This field gets no supporting line of its own — the slot in this hero belongs
          to the code field, and `(optional)` in the name is the whole affordance telling the
          operator they may skip it. The Pair button's enabled condition is untouched: an empty
          label never blocks pairing.

          Two omissions from the code field's structure, both intentional. No clear control: a few
          hundred base64url characters are not select-and-delete-able but a short name is, and a
          second control here would mean a second accessible name to keep clear of the `exact: true`
          matchers. No wrapping <label>, for the same reason as above — an aria-hidden visual span
          keeps exactly one element under this name in the accessibility tree.
        */}
        <div className="pairing-field pairing-field--host">
          <div className="pairing-field__row">
            <div className="pairing-field__content">
              <span className="pairing-field__label" aria-hidden="true">
                {PAIRING_COPY.hostFieldLabel}
              </span>
              {/* maxLength comes from the SHARED constant the IPC guard bounds against
                  (shared/ipc/pairing.ts:41), never a restated 128 — a field bound disagreeing with
                  the write bound would let a value pass one boundary and fail the other. It is a UX
                  affordance only; the guard stays the enforcement point (see the header). It also
                  truncates a mis-paste of the pairing payload into this field, which is the only
                  thing bounding that mistake.

                  type="text", and no `name`/`id`, autocomplete off, spellcheck off — the file
                  header's secret-hygiene paragraph, restated as attributes. */}
              <input
                type="text"
                className="pairing-field__input"
                aria-label={PAIRING_COPY.hostFieldLabel}
                autoComplete="off"
                spellCheck={false}
                maxLength={MAX_HOST_LABEL_LENGTH}
                value={label}
                disabled={busy}
                onChange={(e) => onLabelChange(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="pairing-page__ctas">
        <button
          type="button"
          className="pairing-page__pair"
          disabled={busy || paste.trim() === ''}
          onClick={onSubmit}
        >
          {busy ? 'Pairing…' : 'Pair'}
        </button>
        <button type="button" className="pairing-page__cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {/* A <p>, never an <a> — the welcome screen's footer reasoning applies unchanged: a link
            here would be a second, unspecified external-open surface. */}
        <p className="pairing-page__footer">{PAIRING_COPY.footer}</p>
      </div>
    </>
  )
}

/**
 * The M3 kit's `cancel` glyph in its unfilled form — an outlined ring with an x, the shape classic
 * Material Icons ships as `highlight_off`. Inline JSX rather than a bundled .svg: that is the house
 * idiom (WelcomeScreen.tsx:105-107, ConversationScreen.tsx:1259-1268) and the renderer ships no .svg
 * files at all. The path is the canonical 24-box art, whose ring already spans 2..22 — i.e. the 20x20
 * glyph inset 8.33% inside a 24x24 box that the frame exports, so the plain `0 0 24 24` viewBox
 * reproduces it at the drawn size with no re-scaling. aria-hidden: the button names the action.
 */
function ClearIcon(): JSX.Element {
  return (
    <svg
      className="pairing-field__clear-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M14.59 8 12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8" />
    </svg>
  )
}

function ReviewCard({
  fingerprint,
  busy,
  onConfirm,
  onCancel
}: {
  fingerprint: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <>
      <h1 className="pairing__title">Confirm fingerprint</h1>
      <p className="pairing__instruction">
        Check this matches what <code className="pairing__accent">pyry pair</code> printed on your
        server.
      </p>
      <div className="pairing__fingerprint" aria-label="Server key fingerprint">
        {groupFingerprint(fingerprint).map((group, index) => (
          <span key={index} className="pairing__fingerprint-group">
            {group}
          </span>
        ))}
      </div>
      <div className="pairing__actions">
        <button type="button" className="pairing__button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="pairing__button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
    </>
  )
}

export interface PairingScreenProps {
  bridge?: PairingBridge // default: window.pyry (structurally assignable)
  onPaired?: () => void // fired once on successful confirm — the future navigation seam
  onCancel?: () => void // fired on cancel — the future dismiss/navigation seam
}

/**
 * Thin container — the untested React wiring (precedent: useDaemonEventBridge). Owns the reducer
 * and orchestrates the two one-shot IPC calls from user-interaction handlers (React's idiomatic
 * home for interaction side effects), so there is no useEffect and no StrictMode double-invoke
 * concern. In-flight re-entrancy is blocked at the view (disabled Pair/Confirm while
 * submitting/confirming); a dispatch after unmount is a harmless React-18 no-op.
 */
export function PairingScreen({ bridge, onPaired, onCancel }: PairingScreenProps = {}): JSX.Element {
  const target: PairingBridge = bridge ?? window.pyry
  const [state, dispatch] = useReducer(pairingReducer, initialPairingState)

  const handlePasteChange = (paste: string): void => dispatch({ type: 'paste-changed', paste })

  const handleLabelChange = (label: string): void => dispatch({ type: 'label-changed', label })

  const handleSubmit = (): void => {
    if (state.phase !== 'editing') return
    const paste = state.paste // captured before the await — no check-then-act race
    dispatch({ type: 'submit' })
    void runSubmit(target, paste).then((event) => dispatch(event))
  }

  const handleConfirm = (): void => {
    if (state.phase !== 'reviewing') return
    const label = state.label // captured before the await, as handleSubmit does with the paste
    dispatch({ type: 'confirm' })
    void runConfirm(target, label).then((event) => {
      dispatch(event)
      if (event.type === 'confirm-succeeded') onPaired?.()
    })
  }

  const handleCancel = (): void => {
    dispatch({ type: 'cancel' })
    onCancel?.()
  }

  return (
    <PairingView
      state={state}
      onPasteChange={handlePasteChange}
      onLabelChange={handleLabelChange}
      onSubmit={handleSubmit}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
