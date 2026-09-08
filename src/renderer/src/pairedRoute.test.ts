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

  it('openPairServer from settings opens the pair-server sub-route (#152, AC1/AC2)', () => {
    expect(nextPairedRoute('settings', { type: 'openPairServer' })).toBe('pairServer')
  })

  it('pairServerCancelled returns to settings — non-destructive, no server forgotten (#152, AC4)', () => {
    // Cancel lands back on `settings` (where the user launched pairing), NOT the list: this is a
    // distinct destination from a completed pair, so it needs its own arm — it cannot reuse `back`.
    //
    // #1303 turned that destination from a literal in the arm into the event's own `returnTo`, so this
    // case now states the SETTINGS ENTRY specifically rather than the arm's only behaviour. It is the
    // shipped path and it is unchanged: the Settings row is on `settings` when it is clicked, so that
    // is what the container records and that is where cancel lands.
    expect(nextPairedRoute('pairServer', { type: 'pairServerCancelled', returnTo: 'settings' })).toBe(
      'settings'
    )
  })

  it('pairServerCancelled from the sidebar plus returns to the list it was launched from (#1303, AC3)', () => {
    // The second entry (#1303): the Channels/Chats header plus, clicked while the pane was empty. The
    // rule is one rule for both entries — back to the surface pairing was launched from — and it is the
    // payload, not the arm, that says which surface that was.
    expect(nextPairedRoute('pairServer', { type: 'pairServerCancelled', returnTo: 'list' })).toBe(
      'list'
    )
  })

  it('pairServerCancelled from the sidebar plus returns to the open thread (#1303, AC3)', () => {
    // The case that separates #1303 from "cancel goes home": clicked while a chat was open, cancel
    // returns to that chat rather than dropping the operator onto the list. `paneKey` is untouched by
    // the pairing route, so the pane comes back up on the same conversation.
    expect(nextPairedRoute('pairServer', { type: 'pairServerCancelled', returnTo: 'thread' })).toBe(
      'thread'
    )
  })

  it('pairServerPaired goes home to the new server’s list (#152, AC3)', () => {
    // A successful pair is "done, go home to the new server", landing on `list` — a different
    // destination than cancel's `settings`, so the two exits are separate arms by design.
    expect(nextPairedRoute('pairServer', { type: 'pairServerPaired' })).toBe('list')
  })

  it('openArchive from the list opens the archive screen (#347, AC3)', () => {
    expect(nextPairedRoute('list', { type: 'openArchive' })).toBe('archive')
  })

  it('back from archive returns to the list — reuses the existing absolute back arm (#347, AC2)', () => {
    // Documents that Archive → channel-home needs no stack-aware back: the `back` arm is absolute
    // (current-independent), so it lands on `list` from `archive` exactly as it does from `settings`.
    expect(nextPairedRoute('archive', { type: 'back' })).toBe('list')
  })
})
