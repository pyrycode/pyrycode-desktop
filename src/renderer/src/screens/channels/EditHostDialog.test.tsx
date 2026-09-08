import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_HOST_LABEL_LENGTH } from '@shared/ipc/pairing'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import type { ServerInfoValue } from '../../store/serverInfoStore'
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
//
// #1300 adds the identity block, and this file is its ONLY unit home: `ChannelList.test.tsx` cannot
// render this dialog at all, because the container opens it off `editHostServerId` and that cell starts
// `null` in every static render. Which machine's entry the container looks up is `sidebar-host-edit`'s,
// where two servers can actually be paired.
const noop = (): void => {}

// The identity pair a populated lookup hands down. Shares no substring with `pyrybox`, the label every
// assertion in this file counts occurrences of, nor with any class name or caption here.
const SERVER: ServerInfoValue = {
  serverId: 'srv-attic-9',
  relayUrl: 'wss://relay.example/v1/client'
}

function renderView(
  name: string,
  status: EditHostSaveStatus = 'idle',
  server: ServerInfoValue | null = SERVER
): string {
  return renderToStaticMarkup(
    <EditHostDialogView
      name={name}
      status={status}
      server={server}
      onNameChange={noop}
      onCancel={noop}
      onSave={noop}
    />
  )
}

const SAVE_DISABLED = /edit-host__save"[^>]*disabled/
const CANCEL_DISABLED = /edit-host__cancel"[^>]*disabled/
const INPUT_DISABLED = /edit-host__input"[^>]*disabled/

// #1300 — each caption's whole opening-to-closing run, so an assertion can pin a value IMMEDIATELY
// after its own caption rather than merely somewhere in the markup. Restated here rather than exported
// from the view: this is what the user reads, so a copy change must redden these lines loudly.
const ID_CAPTION = '<span class="edit-host__detail-label">Server ID</span>'
const RELAY_CAPTION = '<span class="edit-host__detail-label">Relay</span>'

// `ChannelList.test.tsx`'s helper, restated (it is file-local there, not exported).
const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1

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

  it('shows the row’s server id and relay URL, each under its own caption (AC1)', () => {
    // The exact concatenation is the point: the value sits IMMEDIATELY after its caption's closing tag,
    // so this pins the pairing as well as the presence. A reader who can see only one of the two lines
    // still knows which value it is.
    const markup = renderView('pyrybox')
    expect(markup).toContain(`${ID_CAPTION}${SERVER.serverId}</p>`)
    expect(markup).toContain(`${RELAY_CAPTION}${SERVER.relayUrl}</p>`)
    // UNDER the Name field and above the actions — the field is what the user edits, the block is what
    // they check it against, and Save must stay the last thing in the panel.
    const details = markup.indexOf('edit-host__details')
    expect(details).toBeGreaterThan(markup.indexOf('edit-host__field'))
    expect(details).toBeLessThan(markup.indexOf('edit-host__actions'))
  })

  it('holds a long relay URL whole — the wrap is CSS, never a slice (AC1)', () => {
    // `hostRowLabel`'s 128-character idiom. A value the user opened the dialog to READ has to be
    // readable whole; an ellipsis or a slice here would answer nothing, which is why the panel took
    // .edit-workspace's max-height/overflow-y pair rather than bounding the string.
    const long = `wss://relay.example/${'x'.repeat(300)}`
    const markup = renderView('pyrybox', 'idle', { serverId: 'srv-1', relayUrl: long })
    expect(markup).toContain(`${RELAY_CAPTION}${long}</p>`)
  })

  it('names the same machine in every status (AC1)', () => {
    // Which machine the dialog names does not depend on whether a write is in flight — the identity
    // block is derived from the container's lookup, not from the round trip.
    for (const status of ['idle', 'saving', 'failed'] as const) {
      expect(renderView('pyrybox', status)).toContain(`${ID_CAPTION}${SERVER.serverId}</p>`)
    }
  })

  it('says Unavailable in both slots when the lookup missed, never a blank', () => {
    // A reseed or an unpair can empty `servers` under an open dialog. Three claims, and each is one the
    // ticket asks for by name: not a crash (a rendered arm, not a dereference), not a blank the reader
    // cannot tell from a real value, and not a dropped block that would make the panel jump.
    const markup = renderView('pyrybox', 'idle', null)
    expect(markup).toContain(`${ID_CAPTION}Unavailable</p>`)
    expect(markup).toContain(`${RELAY_CAPTION}Unavailable</p>`)
    expect(markup).not.toContain(`${ID_CAPTION}</p>`)
    expect(markup).not.toContain(`${RELAY_CAPTION}</p>`)
    // The dialog stays open and keeps its rename: the miss has nothing to do with the name being typed.
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('value="pyrybox"')
  })

  it('lets NEITHER identity value reach an attribute — the SENTINEL idiom (AC3)', () => {
    // `ChannelList.test.tsx`'s guard applied to this surface rather than reinvented. Markers with no
    // regex-, HTML- or attribute-significant character, each asserted to occur EXACTLY ONCE and
    // immediately after its own caption — which catches `title=`, `aria-label=`, an id, a React key, a
    // class-name interpolation and any attribute nobody thought to ban, in two assertions per value.
    const ID_SENTINEL = 'Serverid-Sentinel'
    const RELAY_SENTINEL = 'Relayurl-Sentinel'
    const markup = renderView('pyrybox', 'failed', {
      serverId: ID_SENTINEL,
      relayUrl: RELAY_SENTINEL
    })
    expect(countOf(markup, ID_SENTINEL)).toBe(1)
    expect(markup.indexOf(ID_SENTINEL)).toBe(markup.indexOf(ID_CAPTION) + ID_CAPTION.length)
    expect(countOf(markup, RELAY_SENTINEL)).toBe(1)
    expect(markup.indexOf(RELAY_SENTINEL)).toBe(
      markup.indexOf(RELAY_CAPTION) + RELAY_CAPTION.length
    )
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label=')
  })

  it('renders a hostile server id and relay URL as inert text, never live markup', () => {
    // Both are QR/paste-payload fields held verbatim (`pairedServerStore`'s own header), so the
    // assertion is about the DELIMITERS: `<`, `>` and `"` are escaped, so no tag is opened and no
    // attribute is broken out of. The relay URL is DISPLAYED, never dialled — no anchor, no `new URL`.
    const markup = renderView('pyrybox', 'idle', {
      serverId: 'srv"><img src=x onerror=boom>',
      relayUrl: 'wss://r.example/"onmouseover="alert(1)'
    })
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('"onmouseover="')
    expect(markup).not.toContain('<a ')
    expect(markup).not.toContain('href')
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
