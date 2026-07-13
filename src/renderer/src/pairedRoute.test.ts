import { describe, it, expect } from 'vitest'
import { nextPairedRoute } from './pairedRoute'

// nextPairedRoute is the paired region's pure inner-nav transition — the appRoute.ts / pairingState.ts
// precedent: a total (state, event) => state function tested with no React, store, or Electron.
// Exhaustiveness over PairedNav is compile-checked by the assertNever default in nextPairedRoute (a
// missing arm fails `npm run typecheck`), so it is not a runtime test here (as appRoute.test.ts notes).
describe('nextPairedRoute', () => {
  it('open pushes the thread view', () => {
    expect(nextPairedRoute('list', { type: 'open' })).toBe('thread')
  })

  it('back returns to the list view', () => {
    expect(nextPairedRoute('thread', { type: 'back' })).toBe('list')
  })

  it('open from the thread is idempotent — stays on the thread', () => {
    expect(nextPairedRoute('thread', { type: 'open' })).toBe('thread')
  })

  it('back at the list home is a no-op — stays on the list', () => {
    expect(nextPairedRoute('list', { type: 'back' })).toBe('list')
  })

  it('openSettings pushes the settings view (#333)', () => {
    expect(nextPairedRoute('list', { type: 'openSettings' })).toBe('settings')
  })

  it('back from settings returns to the list — reuses the existing absolute back arm (#333)', () => {
    // Documents that Settings → channel-home needs no stack-aware back: the `back` arm is absolute
    // (current-independent), so it lands on `list` from `settings` exactly as it does from `thread`.
    expect(nextPairedRoute('settings', { type: 'back' })).toBe('list')
  })
})
