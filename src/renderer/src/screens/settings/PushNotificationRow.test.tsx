import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PushNotificationRowView } from './PushNotificationRow'

// The ServerRow / ArchivedCountRow / DefaultWorkspaceRow discipline (#334/#351/#404): the reflect matrix is
// proven on the PURE view with injected props, server-rendered to a string. The store-bound Control's write
// path (onToggle → setter) is unreachable under renderToStaticMarkup (no click), so it is untested reviewed
// glue — only the pure render seam is asserted here (the DefaultWorkspaceRow onChoose precedent).
const noop = (): void => {}

const render = (enabled: boolean): string =>
  renderToStaticMarkup(<PushNotificationRowView enabled={enabled} onToggle={noop} />)

describe('PushNotificationRowView', () => {
  it('reflects the enabled preference: aria-checked="true" + on-class (AC2)', () => {
    const markup = render(true)
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('Push notifications when claude responds') // the label names the control (AC4)
    expect(markup).toContain('settings__switch--on') // the on-position knob/track (Figma 17:68)
  })

  it('reflects the disabled preference: aria-checked="false", no on-class (AC2)', () => {
    const markup = render(false)
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('Push notifications when claude responds') // label present in both states (AC4)
    expect(markup).not.toContain('settings__switch--on') // off keeps the base switch class only
  })

  it('is keyboard-operable by construction: a native <button>, not a click-only <span> (AC4)', () => {
    // A native button activates its onClick on both Space and Enter with no onKeyDown — the deterministic
    // structural proxy for the keyboard AC in a harness that cannot dispatch key events. The row is a <div>,
    // so the sole <button> in the markup is the switch.
    const markup = render(true)
    expect(markup).toContain('<button')
    expect(markup).toContain('type="button"')
  })
})
