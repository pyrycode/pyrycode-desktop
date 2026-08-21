import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
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

function renderView(state: PairingState): string {
  return renderToStaticMarkup(
    <PairingView
      state={state}
      onPasteChange={noop}
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
  it('editing: exactly one element carries the literal aria-label="Pairing code"', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', error: null })
    expect(markup.split(PAIRING_FIELD_MARKER)).toHaveLength(2)
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
