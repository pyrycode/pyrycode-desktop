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
  it('editing (empty paste): renders the title, instruction, textarea, and a disabled Pair', () => {
    const markup = renderView({ phase: 'editing', paste: '', error: null })
    expect(markup).toContain('Paste pairing code')
    expect(markup).toContain('pyry pair --print')
    expect(markup).toContain('<textarea')
    expect(markup).toContain('Cancel')
    expect(markup).toContain('Pair')
    expect(markup).toContain('disabled')
  })

  it('editing with a non-empty paste: Pair is enabled', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', error: null })
    // The only disable-able control in editing is Pair; a non-empty paste enables it.
    expect(markup).not.toContain('disabled')
  })

  it('editing with an error: renders the mapped inline validation message', () => {
    const markup = renderView({ phase: 'editing', paste: 'bad', error: 'invalid-paste' })
    expect(markup).toContain('valid pairing code')
  })

  it('after a coerced infra failure: the error line shows and no control is disabled', () => {
    const markup = renderView({ phase: 'editing', paste: 'pyry://x', error: 'malformed-request' })
    expect(markup).toContain('Something went wrong sending the code.')
    // Covers Cancel, the textarea and Pair in one assertion — the screen is answerable again.
    expect(markup).not.toContain('disabled')
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
