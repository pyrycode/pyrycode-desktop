import { describe, it, expect } from 'vitest'
import {
  markUnavailableActions,
  slashCommandMenuProvesAbsence
} from './composerActionAvailability'
import { COMPOSER_ACTIONS } from './ComposerActionsMenu'
import type { ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import type { SlashCommandListEntry } from '../../store/slashCommandListStore'
import type { WireSlashCommand } from '@shared/wire/types'

// #681 — the whole grey-out decision as data. Both functions are total and framework-free, which is what
// lets this tier carry the proof: vitest runs the `node` environment, so a markup test could observe the
// affordance but never the four UNKNOWN readings that decide it.

function command(overrides: Partial<WireSlashCommand> & { name: string }): WireSlashCommand {
  return { argument_hint: '', description: '', aliases: [], truncated_fields: null, ...overrides }
}

function entry(overrides: Partial<SlashCommandListEntry> = {}): SlashCommandListEntry {
  return { commands: [], droppedCommands: 0, ...overrides }
}

// The two entries claude publishes in the fixtures below; `/knowledge-capture` is deliberately never
// among them, so it is the row every "absence is provable" case greys out.
const PUBLISHED = [command({ name: 'clear' }), command({ name: 'compact' })]

/** The ids the marking reports unavailable, in the order they were given. */
function unavailableIds(options: readonly ComposerOptionsPanelOption[]): string[] {
  return options.filter((option) => option.unavailable === true).map((option) => option.id)
}

describe('slashCommandMenuProvesAbsence', () => {
  // AC2's first case, and the one a slow or older daemon lands on. Best-effort delivery names three loss
  // points, so "no frame" is a normal permanent state rather than an error to wait out.
  it('is false when no frame has arrived', () => {
    expect(slashCommandMenuProvesAbsence(null)).toBe(false)
  })

  it('is true for a complete published list', () => {
    expect(slashCommandMenuProvesAbsence(entry({ commands: PUBLISHED }))).toBe(true)
  })

  // `commands: []` with nothing dropped is claude's POSITIVE statement that it offers no verbs here — a
  // different thing from an absent frame, and the one case where an empty list greys everything out.
  it('is true for an empty menu claude actually published', () => {
    expect(slashCommandMenuProvesAbsence(entry({ commands: [] }))).toBe(true)
  })

  // The frame-level report. A dropped row may be the very one we are asking about, so the whole list stops
  // proving absence — `commands.length + droppedCommands` is the menu's true size.
  it('is false when the frame dropped rows', () => {
    expect(slashCommandMenuProvesAbsence(entry({ commands: PUBLISHED, droppedCommands: 1 }))).toBe(
      false
    )
  })

  // THE INVERSION. slashCommandTypeAhead.ts's hasUnknownAliases deliberately IGNORES a cut name; here a
  // cut name is unknowable text that could have been the match, so it reads as unknown too.
  it('is false when a row reports a cut name', () => {
    const commands = [command({ name: 'clea', truncated_fields: ['name'] }), ...PUBLISHED]
    expect(slashCommandMenuProvesAbsence(entry({ commands }))).toBe(false)
  })

  it('is false when a row reports a cut alias list', () => {
    const commands = [...PUBLISHED, command({ name: 'model', truncated_fields: ['aliases'] })]
    expect(slashCommandMenuProvesAbsence(entry({ commands }))).toBe(false)
  })

  // Only `name` and `aliases` can hide a match. A cut description or argument hint is text this decision
  // never reads, so it must not lock the menu — over-reading truncation would make a busy daemon's every
  // frame useless.
  it('is true when the only cuts are on fields the match never reads', () => {
    const commands = [
      command({ name: 'clear', truncated_fields: ['description'] }),
      command({ name: 'compact', truncated_fields: ['argument_hint', 'description'] })
    ]
    expect(slashCommandMenuProvesAbsence(entry({ commands }))).toBe(true)
  })

  // `truncated_fields: []` and `null` say the same thing — nothing was cut for this row — and the wire
  // type states upstream normalises neither into the other.
  it('is true when a row reports an empty cut list', () => {
    const commands = [command({ name: 'clear', truncated_fields: [] }), ...PUBLISHED]
    expect(slashCommandMenuProvesAbsence(entry({ commands }))).toBe(true)
  })
})

describe('markUnavailableActions', () => {
  // AC2, all four readings. Each one leaves EVERY entry available, including the one no published row
  // names: a menu locked by a slow, busy or older daemon is the exact failure this ticket prevents,
  // inverted.
  it.each([
    ['no frame has arrived', null],
    ['the frame dropped rows', entry({ commands: PUBLISHED, droppedCommands: 3 })],
    [
      'a row reports a cut name',
      entry({ commands: [...PUBLISHED, command({ name: 'know', truncated_fields: ['name'] })] })
    ],
    [
      'a row reports a cut alias list',
      entry({ commands: [...PUBLISHED, command({ name: 'model', truncated_fields: ['aliases'] })] })
    ]
  ])('marks nothing unavailable when %s (AC2)', (_case, incomplete) => {
    expect(unavailableIds(markUnavailableActions(COMPOSER_ACTIONS, incomplete))).toEqual([])
  })

  // The identity the security review pins: when nothing is unavailable the caller's own array comes back,
  // so the common case allocates nothing and no per-render array churn reaches the panel.
  it('returns the given options by reference when nothing is unavailable', () => {
    expect(markUnavailableActions(COMPOSER_ACTIONS, null)).toBe(COMPOSER_ACTIONS)
  })

  it('marks the one entry a complete list does not publish (AC1)', () => {
    const marked = markUnavailableActions(COMPOSER_ACTIONS, entry({ commands: PUBLISHED }))
    expect(unavailableIds(marked)).toEqual(['/knowledge-capture'])
  })

  it('marks every entry when claude published an empty menu', () => {
    const marked = markUnavailableActions(COMPOSER_ACTIONS, entry({ commands: [] }))
    expect(unavailableIds(marked)).toEqual(COMPOSER_ACTIONS.map((action) => action.id))
  })

  // AC3's alias arm, proven on a row whose NAME cannot match: `kc` publishes `knowledge-capture` only as
  // an alias, so a name-only rule would grey out a command that works.
  it('counts an entry present when only an alias matches (AC3)', () => {
    const commands = [...PUBLISHED, command({ name: 'kc', aliases: ['knowledge-capture'] })]
    expect(unavailableIds(markUnavailableActions(COMPOSER_ACTIONS, entry({ commands })))).toEqual([])
  })

  // One rule for all three entries — `/clear` and `/compact` are not special-cased, so removing `clear`
  // from the published list greys it out exactly as an absent `/knowledge-capture` is greyed.
  it('applies the same rule to /clear as to every other entry (AC3)', () => {
    const commands = [command({ name: 'compact' }), command({ name: 'knowledge-capture' })]
    expect(unavailableIds(markUnavailableActions(COMPOSER_ACTIONS, entry({ commands })))).toEqual([
      '/clear'
    ])
  })

  // The entry id carries a leading slash and a published `name` never does, so exactly one slash is
  // stripped before comparison — a row that published `/clear` verbatim is a different string and does
  // NOT match.
  it('strips exactly one leading slash and compares the rest verbatim', () => {
    const commands = [command({ name: '/clear' }), command({ name: 'compact' })]
    expect(unavailableIds(markUnavailableActions(COMPOSER_ACTIONS, entry({ commands })))).toEqual([
      '/clear',
      '/knowledge-capture'
    ])
  })

  // Exact equality, the publishedRowFor posture: no case fold, no trim, no normalisation of text the
  // daemon bounds without sanitizing. The type-ahead folds case only because typing asked it to.
  it('does not case-fold or trim a published name', () => {
    const commands = [command({ name: 'CLEAR' }), command({ name: ' compact ' })]
    expect(unavailableIds(markUnavailableActions(COMPOSER_ACTIONS, entry({ commands })))).toEqual([
      '/clear',
      '/compact',
      '/knowledge-capture'
    ])
  })

  // THE SECURITY PROPERTY. The marking adds one boolean and carries `id` and `label` through untouched —
  // an implementation that rebuilt the rows from published data would move workspace-authored text into
  // the string this menu SENDS.
  it('carries every id and label through unchanged', () => {
    const marked = markUnavailableActions(COMPOSER_ACTIONS, entry({ commands: PUBLISHED }))
    expect(marked.map(({ id, label }) => ({ id, label }))).toEqual(
      COMPOSER_ACTIONS.map(({ id, label }) => ({ id, label }))
    )
  })

  it('does not mutate the options it is given', () => {
    const before = COMPOSER_ACTIONS.map((action) => ({ ...action }))
    markUnavailableActions(COMPOSER_ACTIONS, entry({ commands: [] }))
    expect(COMPOSER_ACTIONS).toStrictEqual(before)
  })
})
