import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_HOST_LABEL_LENGTH } from '@shared/ipc/pairing'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import {
  EditHostDialogView,
  requestSetHostLabel,
  type EditHostSaveStatus
} from './EditHostDialog'

// The EditWorkspaceDialog test twin (#1180's idiom, itself #360's): server-render the pure view with
// injected props — no DOM harness, no store, no clicks (the `node` env fires none). Which rows draw the
// pen that opens this dialog is `ChannelList.test.tsx`'s; the click, the hover, the drawn box and the
// round trip are `e2e/sidebar-host-edit.spec.ts`'s. This file proves the dialog's own markup and the
// write helper's outcome routing (AC1/AC3).
const noop = (): void => {}

function renderView(name: string, status: EditHostSaveStatus = 'idle'): string {
  return renderToStaticMarkup(
    <EditHostDialogView
      name={name}
      status={status}
      onNameChange={noop}
      onCancel={noop}
      onSave={noop}
    />
  )
}

const SAVE_DISABLED = /edit-host__save"[^>]*disabled/
const CANCEL_DISABLED = /edit-host__cancel"[^>]*disabled/
const INPUT_DISABLED = /edit-host__input"[^>]*disabled/

describe('EditHostDialogView', () => {
  it('renders an accessible modal dialog titled Edit host (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="edit-host-title"')
    expect(markup).toContain('id="edit-host-title"')
    expect(markup).toContain('>Edit host</h2>')
  })

  it('seeds the Name field with the row’s stored label (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain('>Name</span>')
    expect(markup).toContain('value="pyrybox"')
    // Exactly one field: this dialog has no second input. The server id and relay URL lines are #1300's.
    expect(markup.split('<input').length - 1).toBe(1)
    // NOT autofocused, matching EditWorkspaceDialogView: the field opens seeded, and stealing focus into
    // a prefilled field invites an accidental overwrite of the name the user came to read.
    expect(markup).not.toContain('autofocus')
  })

  it('opens with an EMPTY field when no label is stored (AC1)', () => {
    // The other half of AC1's seed. `hostRowEditSeed` decides which of the two this is; the view just
    // renders what it is handed, and an empty value must not become an omitted attribute.
    expect(renderView('')).toContain('value=""')
  })

  it('renders Cancel and Save actions (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain('edit-host__cancel')
    expect(markup).toContain('edit-host__save')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Save</button>')
  })

  it('keeps Save ENABLED while the name is blank (AC3)', () => {
    // THE DEPARTURE FROM EditWorkspaceDialogView, which refuses blank. A blank name is a valid answer
    // here as it is at pairing: it means "no label", and the row falls back to the generic word.
    expect(renderView('')).not.toMatch(SAVE_DISABLED)
    expect(renderView('   ')).not.toMatch(SAVE_DISABLED)
  })

  it('disables Save past MAX_HOST_LABEL_LENGTH and enables it at exactly the bound (AC3)', () => {
    // Built from the IMPORTED constant rather than a restated 128, the call PairingScreen and its test
    // already make: change the bound and this test moves with it. The bound is measured on the TRIMMED
    // name, which is what Save sends, so surrounding whitespace can never push a legal name over it.
    const atBound = 'x'.repeat(MAX_HOST_LABEL_LENGTH)
    expect(renderView(`  ${atBound}  `)).not.toMatch(SAVE_DISABLED)
    expect(renderView(`x`.repeat(MAX_HOST_LABEL_LENGTH + 1))).toMatch(SAVE_DISABLED)
  })

  it('freezes Save and the field while the write is in flight, and never Cancel (AC3)', () => {
    // One click is one write, and the field cannot drift from the value the outstanding write carries.
    const markup = renderView('pyrybox', 'saving')
    expect(markup).toMatch(SAVE_DISABLED)
    expect(markup).toMatch(INPUT_DISABLED)
    expect(markup).not.toMatch(CANCEL_DISABLED)
  })

  it('never disables Cancel in any status (AC3)', () => {
    // Load-bearing rather than copied: `ipcRenderer.invoke` carries no timeout, so a main side that
    // never answers would otherwise leave the dialog frozen with no exit.
    for (const status of ['idle', 'saving', 'failed'] as const) {
      expect(renderView('pyrybox', status)).not.toMatch(CANCEL_DISABLED)
    }
  })

  it('renders the failure line only on a failed write, with Save re-enabled (AC3)', () => {
    const failed = renderView('pyrybox', 'failed')
    expect(failed).toContain('edit-host__error')
    expect(failed).not.toMatch(SAVE_DISABLED)
    expect(failed).not.toMatch(INPUT_DISABLED)
    expect(renderView('pyrybox', 'idle')).not.toContain('edit-host__error')
    expect(renderView('pyrybox', 'saving')).not.toContain('edit-host__error')
  })

  it('carries a client-owned, apostrophe-free failure line naming nothing (AC3)', () => {
    // `renderToStaticMarkup` escapes ' → &#x27; (the standing desktop lesson), and the line interpolates
    // neither the label nor the server id — so no untrusted text and no backend detail can reach it.
    const markup = renderView('pyrybox', 'failed')
    expect(markup).not.toContain('&#x27;')
    expect(markup).not.toContain('pyrybox</p>')
  })

  it('renders a hostile label as inert attribute text, never live markup', () => {
    // The assertion is about the DELIMITERS, not the payload's words: `onerror=boom` survives verbatim
    // inside the value and is inert there, because `<` and `>` are escaped so no tag is ever opened.
    const markup = renderView('Tom & <img src=x onerror=boom>')
    expect(markup).toContain('value="Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).not.toContain('<img')
  })

  it('lets the label reach no attribute but the field’s own value', () => {
    // `HostRow`'s four declined sinks, re-derived for this surface: no title, no aria-label built from
    // the label, no id and no class name derived from it. The dialog is named by its title element.
    const markup = renderView('pyrybox', 'failed')
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label=')
    expect(markup.split('pyrybox').length - 1).toBe(1)
  })
})

describe('requestSetHostLabel', () => {
  const stored: HostLabelResult = { status: 'stored', label: 'pyrybox' }

  it('sends the TRIMMED name against the id it was given (AC2)', async () => {
    const calls: [string, string][] = []
    await requestSetHostLabel(
      async (serverId, label) => {
        calls.push([serverId, label])
        return stored
      },
      'server-a',
      '  pyrybox  '
    )
    expect(calls).toEqual([['server-a', 'pyrybox']])
  })

  it('answers the mapped value on stored, for the container to write (AC2)', async () => {
    const next = await requestSetHostLabel(async () => stored, 'server-a', 'pyrybox')
    expect(next).toEqual({ status: 'stored', label: 'pyrybox' })
  })

  it('answers the mapped value on not-stored — the blank-name clear (AC2)', async () => {
    const next = await requestSetHostLabel(async () => ({ status: 'not-stored' }), 'server-a', '  ')
    expect(next).toEqual({ status: 'not-stored' })
  })

  it('answers null on error, so the dialog stays open and no row moves (AC3)', async () => {
    expect(await requestSetHostLabel(async () => ({ status: 'error' }), 'server-a', 'x')).toBeNull()
  })

  it('answers null on an arm it does not recognise, never a store write', async () => {
    // The arms are tested POSITIVELY and the conservative outcome is the unconditional fallthrough —
    // `mapHostLabel`'s own shape. Under a negative `status === 'error'` test a rogue arm would reach the
    // mapper, collapse to `error`, land in the store and silently reset the row to the generic word.
    const rogue = { status: 'something-new', label: 'x' } as unknown as HostLabelResult
    expect(await requestSetHostLabel(async () => rogue, 'server-a', 'x')).toBeNull()
  })

  it('answers null on a rejected invoke and never rejects into the caller', async () => {
    // A rejection means the handler is absent or main died mid-write: the dialog stays open. The caught
    // object is dropped unread — never logged, interpolated or stored (loadHostLabelFor's discipline).
    const next = await requestSetHostLabel(
      () => Promise.reject(new Error('main is gone')),
      'server-a',
      'x'
    )
    expect(next).toBeNull()
  })
})
