import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_HOST_LABEL_LENGTH } from '@shared/ipc/pairing'
import { PairingView, PairingScreen } from './PairingScreen'
import type { PairingBridge, PairingState } from './pairingState'

// No DOM harness (jsdom/Testing Library) — mirrors ConversationScreen.test.tsx.
// PairingView is pure (props in, markup out), so a server-rendered string is
// enough to assert per-phase structure. The container glue (PairingScreen) is
// exercised only for "renders without throwing", exactly as the untested
// daemonEventBridge wiring is left to a smoke test. Interaction is proven on the
// pure runSubmit/runConfirm/pairingReducer seams in pairingState.test.ts.
const noop = (): void => {}

// The literal attribute six consumers outside this screen match on — the App.test.tsx:22 /
// PairedShell.test.tsx:32 PAIRING_MARKER idiom, restated here because this is the file that owns
// the markup those markers point at.
const PAIRING_FIELD_MARKER = 'aria-label="Pairing code"'

// The host-label field's own accessible name (#825). Deliberately shares no substring with the
// marker above, nor with the `exact: true` names "Pair" and "Clear pairing code".
const HOST_FIELD_MARKER = 'aria-label="Host name (optional)"'

/**
 * The rendered `<input …>` tags, in document order — the two fields of the paste phase.
 *
 * Every attribute assertion below matches CASE-INSENSITIVELY: this React's server renderer emits
 * the JSX prop spelling verbatim (`autoComplete="off"`, `maxLength="128"`) rather than lowercasing
 * it, which is fine — HTML attribute names are ASCII case-insensitive, so the DOM reads them the
 * same — but a case-sensitive matcher would pin an incidental renderer detail and break on a React
 * upgrade while the markup stayed correct.
 */
function inputTags(markup: string): string[] {
  return markup.match(/<input\b[^>]*>/g) ?? []
}

function renderView(state: PairingState): string {
  return renderToStaticMarkup(
    <PairingView
      state={state}
      onPasteChange={noop}
      onLabelChange={noop}
      onSubmit={noop}
      onConfirm={noop}
      onCancel={noop}
    />
  )
}

describe('PairingView', () => {
  it('editing (empty paste): renders the field, the supporting instruction, and a disabled Pair', () => {
    const markup = renderView({ phase: 'editing', paste: '', error: null })
    expect(markup).toContain('pyry pair --print')
    expect(markup).toContain(PAIRING_FIELD_MARKER)
    expect(markup).toContain('<input')
    expect(markup).toContain('Cancel')
    expect(markup).toContain('Pair')
    expect(markup).toContain('disabled')
    // AC3 — no clear control with nothing to clear. This is also what keeps the `disabled`
    // assertion above honest: Pair is the ONLY disabled control in this state.
    expect(markup).not.toContain('Clear pairing code')
  })

  it('editing with a non-empty paste: Pair is enabled and the clear control appears', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', error: null })
    // The only disable-able control in editing is Pair; a non-empty paste enables it. The clear
    // control asserted below must never render `disabled` (AC3), which this also covers.
    expect(markup).not.toContain('disabled')
    expect(markup).toContain('aria-label="Clear pairing code"')
  })

  // The one branch of the new control the four editing cases cannot reach. AC3's "never renders
  // disabled" holds "including while busy", and the `disabled` substring proxy the cases above lean
  // on stops working here — the input and both CTAs carry it in flight — so this asserts the clear
  // control's PRESENCE instead. It needs no disabled-guard of its own: pairingReducer's
  // `paste-changed` arm returns state unchanged outside `editing` (pairingState.ts:67-70), which is
  // what makes a mid-submit click an already-safe no-op.
  it('submitting: the clear control is still rendered and Pair shows the in-flight label', () => {
    const markup = renderView({ phase: 'submitting', paste: 'pyry://x' })
    expect(markup).toContain('aria-label="Clear pairing code"')
    expect(markup).toContain('Pairing…')
  })

  it('editing with an error: the supporting line shows the mapped message INSTEAD of the instruction', () => {
    const markup = renderView({ phase: 'editing', paste: 'bad', error: 'invalid-paste' })
    expect(markup).toContain('valid pairing code')
    // AC4's slot holds one line or the other, never both — pinned so a future edit cannot
    // quietly stack the error under the instruction and collapse the 20px slot's geometry.
    expect(markup).not.toContain('pyry pair --print')
  })

  it('after a coerced infra failure: the error line shows and no control is disabled', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', error: 'malformed-request' })
    expect(markup).toContain('Something went wrong sending the code.')
    // Covers Cancel, the input, Pair and the clear control in one assertion — the screen is
    // answerable again.
    expect(markup).not.toContain('disabled')
  })

  // The deterministic net under C1, a contract enforced only by six string-matching consumers
  // outside this file (four e2e attribute selectors, two rendered-markup substring markers). A
  // wrapping <label>, a duplicated attribute, or a second element adopting the name would leave
  // every one of them silently matching nothing — three of those consumers are count-0
  // assertions that pass vacuously against a stale selector. Counting here fails loudly instead.
  // Since #825 this also guards the SECOND field on the screen out of that match set: the host
  // field's own accessible name must stay clear of "Pairing code" (counted here), and of "Pair" and
  // "Clear pairing code", which pairingArrival and live-drive.mjs match with `exact: true`.
  it('editing: exactly one element carries the literal aria-label="Pairing code"', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', error: null })
    expect(markup.split(PAIRING_FIELD_MARKER)).toHaveLength(2)
  })

  // AC3 — the field bounds its own length against the SAME constant the IPC guard enforces, so a
  // value cannot pass one boundary and fail the other. The expected substring is BUILT from the
  // import: change MAX_HOST_LABEL_LENGTH and this test moves with it, while a restated 128 in the
  // component would fail here.
  it('editing: the host field bounds its length against MAX_HOST_LABEL_LENGTH', () => {
    const markup = renderView({ phase: 'editing', paste: '', error: null })
    const hostInput = inputTags(markup).find((tag) => tag.includes(HOST_FIELD_MARKER))
    expect(hostInput).toMatch(new RegExp(`\\smaxlength="${MAX_HOST_LABEL_LENGTH}"`, 'i'))
  })

  // All the static tier can prove about the controlled input: its value is a function of reducer
  // state, not of anything component-local. Typing itself is covered on the reducer seam.
  it('editing: the host field renders the label held in reducer state', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', label: 'Pyrybox', error: null })
    expect(markup).toContain('value="Pyrybox"')
  })

  // AC5 — the secret-hygiene posture PairingScreen.tsx's header records, now with a second input
  // beside the bearer-token one. A <form> ancestor or a name/id on either input can make a password
  // manager read the pair as a credential form and capture the pairing code.
  //
  // The name/id check is a REGEX OVER THE <input> TAGS, not a bare ' name="' substring: the host
  // field's accessible name contains the word "name", so a naive substring matcher would fail for
  // the wrong reason and mislead whoever renames the field next.
  it('editing: neither input carries a name or an id, and there is no form ancestor', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', label: 'Pyrybox', error: null })
    const inputs = inputTags(markup)
    expect(inputs).toHaveLength(2)
    for (const tag of inputs) {
      expect(tag).not.toMatch(/\sname=/i)
      expect(tag).not.toMatch(/\sid=/i)
      expect(tag).toMatch(/\sautocomplete="off"/i)
      expect(tag).toMatch(/\sspellcheck="false"/i)
    }
    expect(markup).not.toContain('<form')
  })

  // The host field dims in flight like the code field does. The two `not.toContain('disabled')`
  // cases above stay green because React omits `disabled={false}` from the markup entirely.
  it('submitting: the host field renders disabled', () => {
    const markup = renderView({ phase: 'submitting', paste: 'pyry://x', label: 'Pyrybox' })
    const hostInput = inputTags(markup).find((tag) => tag.includes(HOST_FIELD_MARKER))
    expect(hostInput).toContain('disabled')
  })

  // The unit-tier tripwire under C2: smoke.spec.ts binds `.pairing` ONCE and asserts it visible on
  // the paste phase and count 0 after Cancel, so dropping the class from either treatment makes the
  // negative half pass for the wrong reason.
  it('the root keeps the .pairing class in both the page and the card treatment', () => {
    expect(renderView({ phase: 'editing', paste: '', error: null })).toContain('class="pairing ')
    expect(
      renderView({ phase: 'reviewing', paste: 'pyry://x', fingerprint: 'aa:bb:cc:dd:ee:ff:11:22' })
    ).toContain('class="pairing ')
  })

  it('reviewing: renders the fingerprint and Confirm/Cancel', () => {
    const markup = renderView({
      phase: 'reviewing',
      paste: 'pyry://x',
      fingerprint: 'aa:bb:cc:dd:ee:ff:11:22'
    })
    // Every byte-pair of the fingerprint must be present, in order.
    for (const group of ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', '11', '22']) {
      expect(markup).toContain(group)
    }
    expect(markup).toContain('Confirm')
    expect(markup).toContain('Cancel')
  })

  it('paired: renders a terminal success marker', () => {
    const markup = renderView({ phase: 'paired' })
    expect(markup).toContain('Paired')
  })
})

describe('PairingScreen', () => {
  it('renders its initial editing markup without throwing', () => {
    const bridge: PairingBridge = {
      submitPairingPaste: async () => ({ ok: true, fingerprint: 'aa:bb:cc:dd:ee:ff:11:22' }),
      confirmPairing: async () => ({ ok: true })
    }
    expect(() => renderToStaticMarkup(<PairingScreen bridge={bridge} />)).not.toThrow()
  })
})
