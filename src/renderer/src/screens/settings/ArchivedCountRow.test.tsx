import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArchivedCountRow } from './ArchivedCountRow'

// The ServerRow discipline (#334): the null/count matrix is proven on the PURE view with injected props,
// server-rendered to a string. The store-bound container's loaded branch is unreachable under
// renderToStaticMarkup (zustand v5 reads the initial null), so the count paths are exercised here by
// passing the value a seeded selectArchivedCount would return straight in — never the global singleton.
const render = (archivedCount: number | null): string =>
  renderToStaticMarkup(<ArchivedCountRow archivedCount={archivedCount} />)

describe('ArchivedCountRow', () => {
  it('shows the neutral placeholder, not "0 archived", before the list loads (AC4)', () => {
    const markup = render(null)
    expect(markup).toContain('Archived conversations') // the always-present label
    expect(markup).toContain('—') // the em-dash placeholder
    expect(markup).not.toContain(' archived') // the placeholder replaces the count line
  })

  it('reads "0 archived" for a loaded, zero-archived list (AC3)', () => {
    expect(render(0)).toContain('0 archived')
  })

  it('reads "1 archived" — invariant word, no singular/plural branch (AC3)', () => {
    expect(render(1)).toContain('1 archived')
  })

  it('reads "5 archived" for a larger count (AC3)', () => {
    expect(render(5)).toContain('5 archived')
  })
})
