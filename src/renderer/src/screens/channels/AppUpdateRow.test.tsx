import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppUpdateRow } from './AppUpdateRow'
import type { AppUpdateState } from '@shared/ipc/appUpdate'
const render = (state: AppUpdateState) => renderToStaticMarkup(<AppUpdateRow state={state} onEvent={() => {}} />)
it('renders only ready/failed with the quiet copy and appropriate actions', () => {
  expect(render({ type: 'idle' })).toBe('')
  const ready = render({ type: 'ready', version: '1.2.3' })
  expect(ready).toContain('class="app-update__icon" aria-hidden="true"')
  for (const copy of ['Update ready', 'Version 1.2.3 installs when you restart.', 'Restart now', 'Later']) expect(ready).toContain(copy)
  expect(ready).not.toContain('Dismiss')
  expect(render({ type: 'ready', version: null })).toContain('An update installs when you restart.')
  const failed = render({ type: 'failed' })
  for (const copy of ['Update could not install', 'Pyrycode will try again next launch.', 'Dismiss']) expect(failed).toContain(copy)
  expect(failed).not.toContain('Restart now')
})
