import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunConfigData } from './RunConfigData'

// Server-render container sanity — the LogDataSection.test container idiom. RunConfigData is
// headless (renders null) and dereferences window.pyry only inside effects, so a server render
// (effects never run) produces empty markup without a bridge mock.
describe('RunConfigData (container)', () => {
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(<RunConfigData />)
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
