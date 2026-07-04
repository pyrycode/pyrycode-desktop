import { useReducer } from 'react'
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
import type { PairingErrorReason } from '@shared/ipc/pairing'

// The desktop pairing screen: paste the payload printed by `pyry pair --print`, review the
// server-key fingerprint the background process derives, and confirm. Styled from the mobile
// "Paste pairing code" dialog (Figma node 19-54) stretched to the window; the reviewing/confirming
// phases are desktop-specific (the human fingerprint-verify step mobile's paste path skipped, #53).
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

export interface PairingViewProps {
  state: PairingState
  onPasteChange: (paste: string) => void
  onSubmit: () => void
  onConfirm: () => void
  onCancel: () => void
}

/** Pure presentational component — no hooks, no state, no effects. One render per phase. */
export function PairingView(props: PairingViewProps): JSX.Element {
  const { state, onPasteChange, onSubmit, onConfirm, onCancel } = props
  return (
    <div className="pairing">
      {(state.phase === 'editing' || state.phase === 'submitting') && (
        <EntryCard
          paste={state.paste}
          error={state.phase === 'editing' ? state.error : null}
          busy={state.phase === 'submitting'}
          onPasteChange={onPasteChange}
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

function EntryCard({
  paste,
  error,
  busy,
  onPasteChange,
  onSubmit,
  onCancel
}: {
  paste: string
  error: PairingErrorReason | null
  busy: boolean
  onPasteChange: (paste: string) => void
  onSubmit: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <>
      <h1 className="pairing__title">Paste pairing code</h1>
      <p className="pairing__instruction">
        Run <code className="pairing__accent">pyry pair --print</code> on your server and paste the
        output here.
      </p>
      <textarea
        className="pairing__paste"
        aria-label="Pairing code"
        placeholder="pyry://home.lan:7117?token=…"
        value={paste}
        disabled={busy}
        onChange={(e) => onPasteChange(e.target.value)}
      />
      {error !== null && (
        <p className="pairing__error" role="alert">
          {ERROR_COPY[error]}
        </p>
      )}
      <div className="pairing__actions">
        <button type="button" className="pairing__button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="pairing__button"
          disabled={busy || paste.trim() === ''}
          onClick={onSubmit}
        >
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </div>
    </>
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

  const handleSubmit = (): void => {
    if (state.phase !== 'editing') return
    const paste = state.paste // captured before the await — no check-then-act race
    dispatch({ type: 'submit' })
    void runSubmit(target, paste).then((event) => dispatch(event))
  }

  const handleConfirm = (): void => {
    if (state.phase !== 'reviewing') return
    dispatch({ type: 'confirm' })
    void runConfirm(target).then((event) => {
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
      onSubmit={handleSubmit}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
