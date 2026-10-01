import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreateChatDialogView } from './CreateChatDialog'

describe('CreateChatDialogView', () => {
  it('offers confirmation and dismissal without a folder choice', () => {
    const html = renderToStaticMarkup(<CreateChatDialogView
      error={null} onCancel={() => {}} onCreate={() => {}}
    />)
    expect(html).toContain('Create chat')
    expect(html).toContain('default folder')
    expect(html).toContain('Close dialog')
    expect(html).toContain('Cancel')
    expect(html).toContain('OK')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<select')
  })
})
