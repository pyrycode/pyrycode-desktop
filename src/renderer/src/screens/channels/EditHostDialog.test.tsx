import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_HOST_LABEL_LENGTH } from '@shared/ipc/pairing'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import type { ServerInfoValue } from '../../store/serverInfoStore'
import {
  EditHostDialogView,
  requestSetHostLabel,
  runEditHostUnpair,
  type EditHostStatus
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

// #1422's slot effects. Defaulted here for the reason `ChannelList.test.tsx` defaults its own view props:
// every call site written before this ticket keeps rendering, and the button is now drawn in all of them,
// which is the point — `unpair` is a REQUIRED prop on the view, so the container must decide.
const UNPAIR_NOOPS = { onArm: noop, onCancel: noop, onConfirm: noop }

function renderView(
  name: string,
  status: EditHostStatus = 'idle',
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
      unpair={UNPAIR_NOOPS}
    />
  )
}

const SAVE_DISABLED = /modal__action--confirm"[^>]*disabled/
const CANCEL_DISABLED = /modal__action--cancel"[^>]*disabled/
const CLOSE_DISABLED = /modal__close"[^>]*disabled/
const INPUT_DISABLED = /edit-host__input"[^>]*disabled/

// #1422's slot. The answers are told apart by their own classes rather than by their text, because both
// the idle verb's button and the Cancel answer would otherwise match on class alone.
const UNPAIR_VERB = '>Unpair host</button>'
const UNPAIR_PROMPT = '>Forget this host?</span>'
const UNPAIR_CANCEL_DISABLED = /edit-host__unpair"[^>]*disabled/
const UNPAIR_CONFIRM_DISABLED = /edit-host__unpair edit-host__unpair--confirm"[^>]*disabled/

// EVERY arm of the widened status, enumerated ONCE. `satisfies` rather than a bare annotation, so
// widening the type without adding its arm here is a type error rather than a silently narrower sweep —
// which is what would let a new arm ship with no disabled-state or exclusivity assertion behind it.
const ALL_STATUSES = [
  'idle',
  'saving',
  'failed',
  'confirming-unpair',
  'unpairing',
  'unpair-failed'
] as const satisfies readonly EditHostStatus[]

// Each caption plus its value span opening, so an assertion pins a value to its own caption.
// Restated here rather than exported
// from the view: this is what the user reads, so a copy change must redden these lines loudly.
const ID_CAPTION = '<span class="edit-host__detail-label">Server identity:</span><span class="edit-host__detail-value">'
const RELAY_CAPTION = '<span class="edit-host__detail-label">Relay address:</span><span class="edit-host__detail-value">'

// `ChannelList.test.tsx`'s helper, restated (it is file-local there, not exported).
const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1

describe('EditHostDialogView', () => {
  it('renders an accessible modal dialog titled Edit host (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('class="modal"')
    expect(markup).toContain('--modal-width:646px')
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(titleId).toBeTruthy()
    expect(markup).toContain(`id="${titleId}"`)
    expect(markup).toContain('>Edit host</h2>')
  })

  it('seeds the Name field with the row’s stored label (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain('>Host name:</span>')
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

  it('renders Cancel, OK and close actions (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain('modal__action--cancel')
    expect(markup).toContain('modal__action--confirm')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
    expect(markup).toContain('aria-label="Close dialog"')
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
    expect(markup).not.toMatch(CLOSE_DISABLED)
  })

  it('never disables Cancel in any status (AC3; #1422 AC4)', () => {
    // Load-bearing rather than copied: `ipcRenderer.invoke` carries no timeout, so a main side that
    // never answers would otherwise leave the dialog frozen with no exit. #1422 extends the sweep to the
    // three unpair arms, where AC4 names the same rule — the footer Cancel stays enabled mid-erase.
    for (const status of ALL_STATUSES) {
      expect(renderView('pyrybox', status)).not.toMatch(CANCEL_DISABLED)
      expect(renderView('pyrybox', status)).not.toMatch(CLOSE_DISABLED)
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
    expect(markup.match(/<img /g)).toHaveLength(1)
    expect(markup).toContain('alt="" aria-hidden="true"')
    expect(markup).not.toContain('<img src=x')
  })

  it('shows the row’s server id and relay URL, each under its own caption (AC1)', () => {
    // The exact concatenation is the point: the value sits in the span after its own caption,
    // so this pins the pairing as well as the presence. A reader who can see only one of the two lines
    // still knows which value it is.
    const markup = renderView('pyrybox')
    expect(markup).toContain(`${ID_CAPTION}${SERVER.serverId}</span></p>`)
    expect(markup).toContain(`${RELAY_CAPTION}${SERVER.relayUrl}</span></p>`)
    // Read-only identity comes before the editable field; confirmation remains in the footer.
    const details = markup.indexOf('edit-host__details')
    expect(details).toBeLessThan(markup.indexOf('edit-host__field'))
    expect(details).toBeLessThan(markup.indexOf('modal__footer'))
  })

  it('holds a long relay URL whole — the wrap is CSS, never a slice (AC1)', () => {
    // `hostRowLabel`'s 128-character idiom. A value the user opened the dialog to READ has to be
    // readable whole; an ellipsis or a slice here would answer nothing, which is why the panel took
    // .edit-workspace's max-height/overflow-y pair rather than bounding the string.
    const long = `wss://relay.example/${'x'.repeat(300)}`
    const markup = renderView('pyrybox', 'idle', { serverId: 'srv-1', relayUrl: long })
    expect(markup).toContain(`${RELAY_CAPTION}${long}</span></p>`)
  })

  it('names the same machine in every status (AC1)', () => {
    // Which machine the dialog names does not depend on whether a write is in flight — the identity
    // block is derived from the container's lookup, not from the round trip.
    for (const status of ALL_STATUSES) {
      expect(renderView('pyrybox', status)).toContain(`${ID_CAPTION}${SERVER.serverId}</span></p>`)
    }
  })

  it('says Unavailable in both slots when the lookup missed, never a blank', () => {
    // A reseed or an unpair can empty `servers` under an open dialog. Three claims, and each is one the
    // ticket asks for by name: not a crash (a rendered arm, not a dereference), not a blank the reader
    // cannot tell from a real value, and not a dropped block that would make the panel jump.
    const markup = renderView('pyrybox', 'idle', null)
    expect(markup).toContain(`${ID_CAPTION}Unavailable</span></p>`)
    expect(markup).toContain(`${RELAY_CAPTION}Unavailable</span></p>`)
    expect(markup).not.toContain(`${ID_CAPTION}</span></p>`)
    expect(markup).not.toContain(`${RELAY_CAPTION}</span></p>`)
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
    expect(markup.match(/aria-label="[^"]*"/g)).toEqual(['aria-label="Close dialog"'])
  })

  it('renders a hostile server id and relay URL as inert text, never live markup', () => {
    // Both are QR/paste-payload fields held verbatim (`pairedServerStore`'s own header), so the
    // assertion is about the DELIMITERS: `<`, `>` and `"` are escaped, so no tag is opened and no
    // attribute is broken out of. The relay URL is DISPLAYED, never dialled — no anchor, no `new URL`.
    const markup = renderView('pyrybox', 'idle', {
      serverId: 'srv"><img src=x onerror=boom>',
      relayUrl: 'wss://r.example/"onmouseover="alert(1)'
    })
    expect(markup.match(/<img /g)).toHaveLength(1)
    expect(markup).toContain('alt="" aria-hidden="true"')
    expect(markup).not.toContain('<img src=x')
    expect(markup).not.toContain('"onmouseover="')
    expect(markup).not.toContain('<a ')
    expect(markup).not.toContain('href')
  })

  it('lets the label reach no attribute but the field’s own value', () => {
    // `HostRow`'s four declined sinks, re-derived for this surface: no title, no aria-label built from
    // the label, no id and no class name derived from it. The dialog is named by its title element.
    const markup = renderView('pyrybox', 'failed')
    expect(markup).not.toContain('title=')
    expect(markup.match(/aria-label="[^"]*"/g)).toEqual(['aria-label="Close dialog"'])
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

// #1422 — the unpair slot. The Settings row's `UnpairAction` shape, proven the way `ServerRow.test.tsx`
// proves that one: server-render the pure view with an injected phase and assert on markup. The click,
// the hover and the real erase stay with `e2e/`; the erase→refresh→route decision is
// `unpairServerAction.test.ts`'s and is not re-proven here.
describe('EditHostDialogView — the unpair slot (#1422)', () => {
  it('renders the outlined verb button between the field and the footer (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain(UNPAIR_VERB)
    expect(markup).toContain('edit-host__actions')
    // Below the Host name field and above the centred footer — the Figma's content-slot Actions frame.
    // Order asserted by position rather than by eye, so a later reshuffle reddens here.
    const actions = markup.indexOf('edit-host__actions')
    expect(markup.indexOf('edit-host__field')).toBeLessThan(actions)
    expect(actions).toBeLessThan(markup.indexOf('modal__footer'))
    // Idle draws ONLY the verb: no prompt, no answers armed behind it.
    expect(markup).not.toContain(UNPAIR_PROMPT)
  })

  it('leaves Cancel and OK in the footer, untouched by the new button (AC1)', () => {
    const markup = renderView('pyrybox')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
    // The new button is NOT in the footer, and the footer still has exactly its two actions.
    expect(markup.indexOf(UNPAIR_VERB)).toBeLessThan(markup.indexOf('modal__footer'))
    expect(countOf(markup, 'modal__action ')).toBe(2)
  })

  it('replaces the button with a prompt and two answers when armed (AC2)', () => {
    const markup = renderView('pyrybox', 'confirming-unpair')
    expect(markup).toContain(UNPAIR_PROMPT)
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Confirm</button>')
    // IN THE SAME SLOT — the verb is gone, not merely joined, and the answers sit inside the same
    // actions row the button occupied. A slot that grew a second row is the failure this pins.
    expect(markup).not.toContain(UNPAIR_VERB)
    expect(countOf(markup, 'edit-host__actions')).toBe(1)
    // Arming touches neither the field nor OK: AC2 is a confirmation, not a freeze.
    expect(markup).not.toMatch(INPUT_DISABLED)
    expect(markup).not.toMatch(SAVE_DISABLED)
    expect(markup).not.toMatch(UNPAIR_CANCEL_DISABLED)
    expect(markup).not.toMatch(UNPAIR_CONFIRM_DISABLED)
  })

  it('freezes both answers, the field and OK while the erase is in flight (AC4)', () => {
    const markup = renderView('pyrybox', 'unpairing')
    expect(markup).toMatch(UNPAIR_CANCEL_DISABLED)
    expect(markup).toMatch(UNPAIR_CONFIRM_DISABLED)
    expect(markup).toMatch(INPUT_DISABLED)
    expect(markup).toMatch(SAVE_DISABLED)
    // The footer's own Cancel is the one exit that stays open — AC4 names it, and the invoke has no
    // timeout, so freezing it would leave a hung main side with no way out of the dialog.
    expect(markup).not.toMatch(CANCEL_DISABLED)
    expect(markup).not.toMatch(CLOSE_DISABLED)
    // The confirm answer says so rather than looking idle under a frozen click.
    expect(markup).toContain('>Forgetting…</button>')
  })

  it('returns the slot to the idle button and re-enables the field and OK on failure (AC4)', () => {
    const markup = renderView('pyrybox', 'unpair-failed')
    expect(markup).toContain(UNPAIR_VERB)
    expect(markup).not.toContain(UNPAIR_PROMPT)
    expect(markup).not.toMatch(INPUT_DISABLED)
    expect(markup).not.toMatch(SAVE_DISABLED)
    // The dialog stays OPEN — a failed erase is retried from here, not from a reopen.
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('value="pyrybox"')
  })

  it('keeps the two failure lines exclusive, in the one message slot (AC4)', () => {
    // The widened status is ONE union precisely so these cannot both be true. Asserting the negative on
    // each arm is what makes that a tested property rather than a claim in the type's docblock.
    const renameFailed = renderView('pyrybox', 'failed')
    expect(renameFailed).toContain('Could not save that name')
    expect(renameFailed).not.toContain('Could not unpair this host')
    const unpairFailed = renderView('pyrybox', 'unpair-failed')
    expect(unpairFailed).toContain('Could not unpair this host')
    expect(unpairFailed).not.toContain('Could not save that name')
    // Same slot, same class — one message element, never two stacked.
    expect(countOf(unpairFailed, 'edit-host__error')).toBe(1)
    for (const status of ['idle', 'confirming-unpair', 'unpairing'] as const) {
      expect(renderView('pyrybox', status)).not.toContain('edit-host__error')
    }
  })

  it('carries client-owned copy naming neither the host nor its id (AC4)', () => {
    // `UNPAIR_COPY`'s idiom: apostrophe-free (renderToStaticMarkup escapes ' → &#x27;), interpolating
    // neither the label nor the server id, so no operator- or daemon-authored text reaches this voice.
    for (const status of ['confirming-unpair', 'unpairing', 'unpair-failed'] as const) {
      const markup = renderView('pyrybox', status, { serverId: 'Serverid-Sentinel', relayUrl: 'r' })
      expect(markup).not.toContain('&#x27;')
      // Each identity value still appears exactly once — in its own caption's span, never in the copy.
      expect(countOf(markup, 'Serverid-Sentinel')).toBe(1)
      expect(countOf(markup, 'pyrybox')).toBe(1)
    }
  })

  it('gives every answer its own text as its accessible name, and no aria-label (AC1)', () => {
    // `UnpairAction`'s ruling: naming the host in an aria-label would put operator-authored text into an
    // attribute, which CLAUDE.md forbids outright. The dialog's only aria-label stays Modal's close.
    for (const status of ALL_STATUSES) {
      const markup = renderView('pyrybox', status)
      expect(markup.match(/aria-label="[^"]*"/g)).toEqual(['aria-label="Close dialog"'])
    }
  })

  it('keeps the slot’s Cancel distinguishable from the footer’s (AC2)', () => {
    // Both answers read 'Cancel', and they do DIFFERENT things — the slot's disarms, the footer's closes
    // the dialog. This tier cannot click, so the property it can pin is that the two are separately
    // addressable: distinct classes, in distinct containers, with the slot's inside the content area and
    // the footer's inside the footer. That is also what `e2e/` needs to target them apart.
    const markup = renderView('pyrybox', 'confirming-unpair')
    expect(countOf(markup, '>Cancel</button>')).toBe(2)
    expect(markup).toContain('class="edit-host__unpair"')
    expect(markup).toContain('class="modal__action modal__action--cancel"')
    const slotCancel = markup.indexOf('class="edit-host__unpair"')
    expect(slotCancel).toBeLessThan(markup.indexOf('modal__footer'))
    // The confirm answer carries its own modifier, so it is never selected by the Cancel locator.
    expect(markup).toContain('class="edit-host__unpair edit-host__unpair--confirm"')
  })
})

describe('runEditHostUnpair (#1422)', () => {
  const deps = (
    outcome: 'ok' | 'error'
  ): { unpair: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } => ({
    unpair: vi.fn(async () => outcome),
    setStatus: vi.fn(),
    close: vi.fn()
  })

  it('marks the dialog in flight BEFORE the erase is awaited (AC4)', async () => {
    // The ordering is the whole of AC4's freeze: set afterwards, the field and both answers would stay
    // live for the length of the round trip and a second confirm could land.
    const order: string[] = []
    const setStatus = vi.fn((next: EditHostStatus) => order.push(`status:${next}`))
    await runEditHostUnpair({
      unpair: async () => {
        order.push('unpair')
        return 'ok'
      },
      setStatus,
      close: () => order.push('close')
    })
    expect(order).toEqual(['status:unpairing', 'unpair', 'close'])
  })

  it('closes on ok and writes no further status (AC3)', async () => {
    const d = deps('ok')
    await runEditHostUnpair(d)
    expect(d.close).toHaveBeenCalledTimes(1)
    // Only the in-flight mark — nothing after it. On the last-host path the shell unmounts with the
    // route flip and takes this dialog with it, so a trailing write would land on nothing anyway.
    expect(d.setStatus.mock.calls).toEqual([['unpairing']])
  })

  it('keeps the dialog OPEN on error and shows the failed arm (AC4)', async () => {
    const d = deps('error')
    await runEditHostUnpair(d)
    expect(d.close).not.toHaveBeenCalled()
    expect(d.setStatus.mock.calls).toEqual([['unpairing'], ['unpair-failed']])
  })

  it('erases exactly once per call (AC3)', async () => {
    // One confirmed answer is one erase. The disabled answers are the UI half of that; this is the
    // helper's own half — no retry loop, no second attempt on error.
    const d = deps('error')
    await runEditHostUnpair(d)
    expect(d.unpair).toHaveBeenCalledTimes(1)
  })
})
