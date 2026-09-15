import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RendererCommand } from '@shared/ipc/commands'
import {
  EditWorkspaceDialogView,
  requestArchiveWorkspace,
  requestRenameWorkspace,
  type ArchivableRow,
  type EditWorkspaceArchive,
  type EditWorkspaceArchiveStatus
} from './EditWorkspaceDialog'

// The CreateChannelDialog test twin (#1179's idiom, itself #360's): server-render the pure view with
// injected props — no DOM harness, no store, no clicks (the `node` env fires none). Which rows draw the
// pen that opens this dialog is `ChannelList.test.tsx`'s; the click, the hover, the drawn box and the
// round trip are `e2e/sidebar-workspace-edit.spec.ts`'s. This file proves the dialog's own markup and
// the send helper's payload (AC4/AC5).
const noop = (): void => {}

// #1439's slot renders the arm it is given and reports intents; a static render fires none of the
// three, so the injected object is inert here and the clicks are `e2e/sidebar-workspace-edit.spec.ts`'s.
const inertArchive: EditWorkspaceArchive = { onArm: noop, onCancel: noop, onConfirm: noop }

function renderView(name: string, status: EditWorkspaceArchiveStatus = 'idle'): string {
  return renderToStaticMarkup(
    <EditWorkspaceDialogView
      name={name}
      status={status}
      onNameChange={noop}
      onCancel={noop}
      onSave={noop}
      archive={inertArchive}
    />
  )
}

/** Collect the commands a call hands to `sendCommand`, so a helper's whole output is assertable. */
function capture(run: (send: (command: RendererCommand) => void) => void): RendererCommand[] {
  const sent: RendererCommand[] = []
  run((command) => sent.push(command))
  return sent
}

describe('EditWorkspaceDialogView', () => {
  it('renders an accessible modal dialog titled Edit workspace (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(titleId).toBeTruthy()
    expect(markup).toContain(`id="${titleId}"`)
    expect(markup).toContain('--modal-width:640px')
    expect(markup).toContain('>Edit workspace</h2>')
  })

  it('seeds the Name field with the row’s current label (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('>Workspace name (optional):</span>')
    expect(markup).toContain('value="Second Brain"')
    // Only the optional name appears; host and folder are held by the container.
    expect(markup.split('<input').length - 1).toBe(1)
    // NOT autofocused, unlike the Create-channel dialog: that field opens empty, this one opens
    // seeded, and stealing focus into a prefilled field invites an accidental overwrite.
    expect(markup).not.toContain('autofocus')
  })

  it('renders only the name field in shared modal content', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('modal__content')
    expect(markup).not.toContain('edit-workspace__path')
    expect(markup).toContain('aria-label="Close dialog"')
  })

  it('renders Cancel and OK actions (AC4)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('modal__action--cancel')
    expect(markup).toContain('modal__action--confirm')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
  })

  it('enables OK when the trimmed name is blank', () => {
    expect(renderView('')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(renderView('   ')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('disables OK past 128 characters and enables it at exactly 128 (AC4)', () => {
    // The bound is measured on the TRIMMED name, which is what OK sends — so surrounding whitespace
    // can never push an otherwise-legal name over. `x`.repeat is a client-owned literal, not daemon text.
    expect(renderView(`  ${'x'.repeat(128)}  `)).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(renderView('x'.repeat(129))).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('enables OK on an ordinary name and never disables Cancel (AC4)', () => {
    const markup = renderView('Kitchen Ledger')
    expect(markup).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(markup).not.toMatch(/modal__action--cancel"[^>]*disabled/)
  })

  it('renders a hostile label as inert attribute text, never live markup (AC4)', () => {
    // The assertion is about the DELIMITERS, not the payload's words: `onerror=boom` survives verbatim
    // inside the value and is inert there, because `<` and `>` are escaped so no tag is ever opened.
    const markup = renderView('Tom & <img src=x onerror=boom>')
    expect(markup).toContain('value="Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).not.toContain('<img src=x')
  })

  it('counts astral characters as two UTF-16 code units', () => {
    expect(renderView('😀'.repeat(64))).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(renderView('😀'.repeat(65))).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

})

// #1439 — the archive slot's two arms, the only tier that can read them: a static render proves WHICH
// markup each arm draws, and `e2e/sidebar-workspace-edit.spec.ts` proves that arming sends nothing and
// confirming sends. The arms are mutually exclusive by the union's shape, so each assertion below states
// both halves — what the arm draws AND what it must not.
describe('EditWorkspaceDialogView — the archive slot', () => {
  const PROMPT = 'Archive this workspace? Its chats and channels move to the Archive screen.'
  const occurrences = (markup: string, needle: string): number => markup.split(needle).length - 1

  it('renders the idle Archive workspace button below the field and above the footer (AC1)', () => {
    const markup = renderView('Second Brain')
    expect(markup).toContain('edit-workspace__actions')
    expect(markup).toContain('<button type="button" class="edit-workspace__archive">Archive workspace</button>')
    expect(markup).not.toContain(PROMPT)
    // Inside the shared content slot, which is what puts it after the field and before the footer —
    // `Modal` renders children before `.modal__footer`, so the DOM order IS the drawn and tab order.
    const content = markup.indexOf('modal__content')
    expect(content).toBeGreaterThan(-1)
    expect(markup.indexOf('edit-workspace__field')).toBeGreaterThan(content)
    expect(markup.indexOf('edit-workspace__actions')).toBeGreaterThan(
      markup.indexOf('edit-workspace__field')
    )
    expect(markup.indexOf('modal__footer')).toBeGreaterThan(markup.indexOf('edit-workspace__actions'))
  })

  it('replaces the button with a prompt and two answers in the same slot (AC2)', () => {
    const markup = renderView('Second Brain', 'confirming-archive')
    expect(markup).toContain(`class="edit-workspace__archive-prompt">${PROMPT}</span>`)
    expect(markup).not.toContain('>Archive workspace</button>')
    expect(markup).toContain('>Archive</button>')
    // One slot, not two: the answers sit in the container the button vacated.
    expect(occurrences(markup, 'edit-workspace__actions')).toBe(1)
    expect(occurrences(markup, 'class="edit-workspace__archive"')).toBe(2)
  })

  it('keeps the confirm answer on the outlined recipe rather than an error role (AC2)', () => {
    // The act is reversible, so the answer takes no modifier at all — and a modifier class with no CSS
    // rule behind it is what #1422's second rework leg was, which is why the absence is pinned here.
    const markup = renderView('Second Brain', 'confirming-archive')
    expect(markup).not.toContain('edit-workspace__archive--')
  })

  it('names the two answers apart from the footer Cancel only by their slot (AC2)', () => {
    // Both Cancels read the same word; the class on the container is what tells them apart, which is
    // the locator contract the e2e drive depends on.
    const idle = renderView('Second Brain')
    const armed = renderView('Second Brain', 'confirming-archive')
    expect(occurrences(idle, '>Cancel</button>')).toBe(1)
    expect(occurrences(armed, '>Cancel</button>')).toBe(2)
    expect(armed).toContain('<span class="edit-workspace__archive-prompt">')
  })

  it('leaves the field, Cancel, OK and the close control untouched in both arms (AC1)', () => {
    for (const markup of [renderView('Second Brain'), renderView('Second Brain', 'confirming-archive')]) {
      expect(markup).toContain('>Workspace name (optional):</span>')
      expect(markup).toContain('value="Second Brain"')
      expect(markup).toContain('modal__action--cancel')
      expect(markup).toContain('>OK</button>')
      expect(markup).toContain('>Edit workspace</h2>')
      // Every button's TEXT is its accessible name; the only `aria-label` in the dialog stays the
      // shared close control's, so no `cwd`, label or id can reach an attribute (AC5).
      expect(occurrences(markup, 'aria-label=')).toBe(1)
      expect(markup).toContain('aria-label="Close dialog"')
    }
  })

  it('says “this workspace”, naming neither the label nor the path, apostrophe-free (AC5)', () => {
    const markup = renderView('Second Brain', 'confirming-archive')
    expect(markup).toContain('Archive this workspace?')
    expect(markup).not.toContain('Second Brain</span>')
    expect(markup).not.toContain('/home/me')
    // `renderToStaticMarkup` escapes ' → &#x27;, so client copy is written without one.
    expect(markup).not.toContain('&#x27;')
  })
})

describe('requestArchiveWorkspace', () => {
  const HOST = 'host-a'
  const CWD = '/home/me/second-brain'
  const row = (over: Partial<ArchivableRow> & { id: string }): ArchivableRow => ({
    cwd: CWD,
    is_archived: false,
    serverId: HOST,
    ...over
  })

  /** The ids the helper asks to archive, in order — a plain spy, no store and no `window`. */
  const archived = (
    rows: readonly ArchivableRow[],
    cwd: string = CWD,
    serverId: string = HOST
  ): string[] => {
    const ids: string[] = []
    requestArchiveWorkspace((id) => ids.push(id), rows, cwd, serverId)
    return ids
  }

  it('asks once per active row in that folder on that host, ids verbatim and in order (AC3)', () => {
    expect(archived([row({ id: 'chat-1' }), row({ id: 'channel-2' })])).toEqual(['chat-1', 'channel-2'])
  })

  it('asks nothing for an empty list', () => {
    expect(archived([])).toEqual([])
  })

  it('skips rows already archived in that folder (AC3)', () => {
    expect(archived([row({ id: 'gone', is_archived: true }), row({ id: 'live' })])).toEqual(['live'])
  })

  it('skips another workspace on the same host, matching the cwd EXACTLY (AC3)', () => {
    // A trailing separator is a different group to `groupByWorkspace`, which keys on the raw `cwd` and
    // normalises nothing — so the selection must disagree with it in no way.
    const rows = [
      row({ id: 'sibling', cwd: '/home/me/second-brain-notes' }),
      row({ id: 'trailing', cwd: `${CWD}/` }),
      row({ id: 'child', cwd: `${CWD}/sub` }),
      row({ id: 'mine' })
    ]
    expect(archived(rows)).toEqual(['mine'])
  })

  it('skips another host and every unattributed row, even at the same path (AC3)', () => {
    const rows = [
      row({ id: 'other-host', serverId: 'host-b' }),
      row({ id: 'unstamped', serverId: undefined }),
      row({ id: 'null-stamped', serverId: null }),
      row({ id: 'mine' })
    ]
    expect(archived(rows)).toEqual(['mine'])
  })

  it('passes a hostile-looking id through as an opaque routing value', () => {
    // The id is daemon-asserted text used as nothing but the payload's `conversation_id`: no join, no
    // lookup path, no interpolation into copy.
    const hostile = '../../etc/passwd'
    expect(archived([row({ id: hostile })])).toEqual([hostile])
  })

  it('matches a traversal-shaped cwd by equality rather than resolving it', () => {
    const odd = '/home/me/../../etc'
    expect(archived([row({ id: 'odd', cwd: odd }), row({ id: 'mine' })], odd)).toEqual(['odd'])
  })
})

describe('requestRenameWorkspace', () => {
  it.each(['', '   ', ' second-brain '])('clears an optional name: %j', (name) => {
    expect(capture(send => requestRenameWorkspace(send, '/home/me/second-brain', name, 'host-b')))
      .toEqual([{ type: 'renameWorkspace', serverId: 'host-b',
        payload: { path: '/home/me/second-brain', label: null } }])
  })

  it('routes exactly one rename to the selected host without changing its path', () => {
    expect(capture(send => requestRenameWorkspace(send, '/fake/../workspace ', ' Ledger ', 'host-a')))
      .toEqual([{ type: 'renameWorkspace', serverId: 'host-a',
        payload: { path: '/fake/../workspace ', label: 'Ledger' } }])
  })

  it('sends exactly one renameWorkspace carrying the cwd and the trimmed name (AC5)', () => {
    const sent = capture((send) =>
      requestRenameWorkspace(send, '/home/me/second-brain', '  Kitchen Ledger  ')
    )
    expect(sent).toEqual([
      {
        type: 'renameWorkspace',
        payload: { path: '/home/me/second-brain', label: 'Kitchen Ledger' }
      }
    ])
  })

  it('sends label: null when the trimmed name is the FOLDER segment, not the current label (AC5)', () => {
    // The way back to the folder name is OK itself. The comparison is against `workspaceLabelFor`'s
    // segment — the daemon may be holding a quite different label at the time, and that is irrelevant.
    const sent = capture((send) =>
      requestRenameWorkspace(send, '/home/me/second-brain', ' second-brain ')
    )
    expect(sent).toEqual([
      { type: 'renameWorkspace', payload: { path: '/home/me/second-brain', label: null } }
    ])
  })

  it('names the label key unconditionally, so null is a value and never an absence (AC5)', () => {
    const [command] = capture((send) =>
      requestRenameWorkspace(send, '/home/me/second-brain', 'second-brain')
    )
    // Narrowed on the discriminant rather than cast: `RendererCommand` has payload-free members, so a
    // cast here would be a real bypass of the one gate that typechecks this file.
    if (command.type !== 'renameWorkspace') throw new Error(`sent ${command.type}`)
    // An ABSENT key is a contract violation the daemon rejects as malformed; a literal `null` is the
    // value "clear this workspace's label". `toEqual` above is blind to the difference — this is not.
    expect(Object.keys(command.payload).sort()).toEqual(['label', 'path'])
  })

  it('passes a traversal-shaped cwd through VERBATIM rather than sanitising it', () => {
    // The daemon looks the path up by byte-for-byte equality against a stored `cwd`, never by a join,
    // so a `../` value is answered `workspace.not_found` rather than traversing anything. Normalising
    // it here would make this client disagree with the daemon about which workspace was named.
    const hostile = '/home/me/../../etc'
    const sent = capture((send) => requestRenameWorkspace(send, hostile, 'Ledger'))
    expect(sent).toEqual([
      { type: 'renameWorkspace', payload: { path: hostile, label: 'Ledger' } }
    ])
  })

  it('still sends the trimmed name when the cwd has no usable segment', () => {
    // `workspaceLabelFor('')` is null, which a non-blank trimmed name can never equal — so the
    // folder-segment branch needs no special case for the unknown-workspace shape.
    const sent = capture((send) => requestRenameWorkspace(send, '', 'Ledger'))
    expect(sent).toEqual([{ type: 'renameWorkspace', payload: { path: '', label: 'Ledger' } }])
  })
})
