import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DefaultWorkspaceRowView } from './DefaultWorkspaceRow'

// The ServerRow / ArchivedCountRow discipline (#334/#351): the null/path matrix is proven on the PURE
// view with injected props, server-rendered to a string. The store-bound container's write path
// (click-to-open → choose) is unreachable under renderToStaticMarkup, so it is untested reviewed glue —
// only the pure render seam is asserted here.
const noop = (): void => {}

const render = (defaultWorkspace: string | null): string =>
  renderToStaticMarkup(
    <DefaultWorkspaceRowView defaultWorkspace={defaultWorkspace} onActivate={noop} />
  )

describe('DefaultWorkspaceRowView', () => {
  it('shows the "scratch" placeholder when no default has been chosen (AC2)', () => {
    const markup = render(null)
    expect(markup).toContain('Default workspace') // the always-present primary label
    expect(markup).toContain('scratch') // the null-placeholder for the server default (Figma 17:59)
  })

  it('renders the stored path verbatim, not the placeholder, when a default is set (AC1/AC3)', () => {
    const markup = render('/home/juhana/projects/pyrycode')
    expect(markup).toContain('/home/juhana/projects/pyrycode') // opaque path, rendered whole
    expect(markup).not.toContain('scratch') // a real value replaces the placeholder
  })

  it('is a native <button> whose text is its accessible name (AC4)', () => {
    const markup = render(null)
    expect(markup).toContain('settings__default-workspace-row')
    expect(markup).toContain('<button') // interactive row, not a static div
    expect(markup).toContain('type="button"')
    expect(markup).not.toContain('aria-label=') // its label text IS the accessible name
  })

  it('marks the trailing chevron decorative (AC4)', () => {
    expect(render(null)).toContain('aria-hidden="true"')
  })
})
