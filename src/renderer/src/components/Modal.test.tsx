import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Modal, type ModalProps } from './Modal'

const noop = (): void => {}
const props: ModalProps = {
  title: 'Workspace details',
  children: <p>Supplied workspace content</p>,
  cancelAction: { label: 'Go back', onClick: noop },
  confirmAction: { label: 'Create workspace', onClick: noop },
  onClose: noop
}

const renderModal = (overrides: Partial<ModalProps> = {}): string =>
  renderToStaticMarkup(<Modal {...props} {...overrides} />)

describe('Modal', () => {
  it('renders supplied title, content and action labels without Figma samples', () => {
    const markup = renderModal()
    expect(markup).toContain('>Workspace details</h2>')
    expect(markup).toContain('<p>Supplied workspace content</p>')
    expect(markup).toContain('>Go back</button>')
    expect(markup).toContain('>Create workspace</button>')
    for (const sample of ['Modal header', 'Server identity:', 'Relay address:', 'Pyrybox']) {
      expect(markup).not.toContain(sample)
    }
  })

  it('keeps empty content empty', () => {
    expect(renderModal({ children: null })).toContain('<div class="modal__content"></div>')
  })

  it('names each dialog from its own title using generated ids', () => {
    const markup = renderToStaticMarkup(<><Modal {...props} /><Modal {...props} /></>)
    const names = [...markup.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1])
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    for (const id of names) {
      expect(markup).toContain(`<h2 class="modal__title" id="${id}">Workspace details</h2>`)
    }
    expect(markup.match(/role="dialog" aria-modal="true"/g)).toHaveLength(2)
  })

  it('uses native non-submit buttons and an accessibly named decorative close icon', () => {
    const markup = renderModal()
    const buttons = markup.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(3)
    expect(buttons.every((button) => button.includes('type="button"'))).toBe(true)
    expect(buttons[0]).toContain('aria-label="Close dialog"')
    expect(markup).toMatch(/<img [^>]*alt=""[^>]*aria-hidden="true"/)
  })

  it.each([
    [false, false], [true, false], [false, true], [true, true]
  ])('honours independent disabled states (cancel %s, confirm %s)', (cancel, confirm) => {
    const markup = renderModal({
      cancelAction: { ...props.cancelAction, disabled: cancel },
      confirmAction: { ...props.confirmAction, disabled: confirm }
    })
    const buttons = markup.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).not.toContain('disabled')
    expect(buttons[1].includes('disabled')).toBe(cancel)
    expect(buttons[2].includes('disabled')).toBe(confirm)
  })

  it('escapes caller text without putting it in an attribute', () => {
    const text = '<script>Caller & title</script>'
    const markup = renderModal({ title: text, confirmAction: { label: text, onClick: noop } })
    expect(markup).not.toContain('<script>')
    expect(markup.match(/&lt;script&gt;Caller &amp; title&lt;\/script&gt;/g)).toHaveLength(2)
    expect(markup.match(/<[^>]+>/g)?.some((tag) => tag.includes('Caller'))).toBe(false)
  })

  it('defaults to 600 CSS pixels and accepts a caller width', () => {
    expect(renderModal()).toContain('style="--modal-width:600px"')
    expect(renderModal({ width: 646 })).toContain('style="--modal-width:646px"')
  })
})
