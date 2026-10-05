import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollapseToolUsesRowView } from './CollapseToolUsesRow'

it.each([true, false])('renders an accessible native switch reflecting %s', (enabled) => {
  const html = renderToStaticMarkup(<CollapseToolUsesRowView enabled={enabled} onToggle={() => {}} />)
  expect(html).toContain('<p class="settings__notifications-row-label">Collapse assistant tool uses</p>')
  expect(html).toContain('<button type="button" role="switch"')
  expect(html).toContain(`aria-checked="${enabled}"`)
  expect(html).toContain('aria-label="Collapse assistant tool uses"')
  expect(html.includes('settings__switch--on')).toBe(enabled)
  expect(html).toContain('<span class="settings__switch-knob" aria-hidden="true"></span>')
  expect(html).not.toContain('disabled')
})
