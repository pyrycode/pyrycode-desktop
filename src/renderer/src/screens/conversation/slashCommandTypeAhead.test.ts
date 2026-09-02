import { describe, it, expect } from 'vitest'
import { completeSlashCommand, slashCommandTypeAheadRows } from './slashCommandTypeAhead'
import type { WireSlashCommand } from '@shared/wire/types'

// #939: the executable half of the ticket. Nothing in this repo can click — vitest.config.ts sets
// `environment: 'node'`, there is no jsdom and no @testing-library — so what the type-ahead DECIDES was
// written as a total function precisely so a vitest spec can execute it. Every acceptance criterion is
// proved HERE; #940's container is the untested reviewed glue.
//
// The rows are lifted from src/shared/wire/types.test.ts's `slash-command-list wire vocabulary (#935)`
// block, which lifted them from the daemon's committed fixtures — so a contract change shows up as a
// fixture diff rather than as two hand-written guesses disagreeing. Three additions, each named:
// `__remote-workflow` (a real capture name, and the one that carries no identifier charset), the alias
// `Workflow` on it (workspace-authored strings are not lowercase by contract, and the case fold has to be
// proved in BOTH directions), and the `truncated_fields: ['aliases']` row, which is hand-authored for the
// reason the wire spec records: no committed upstream fixture carries one.

const CLAUDE_API: WireSlashCommand = {
  name: 'claude-api',
  argument_hint: '',
  // Abridged upstream, and kept abridged here. Both measured byte-level properties of the real 1,145-byte
  // string survive: an embedded newline — `0x0a` is the only sub-`0x20` byte anywhere across the capture's
  // 51 entries' four string fields — and a non-ASCII rune. This module must neither match against a
  // description nor alter one, and this row is what proves both.
  description: 'Reference for the Claude API — model ids, pricing, params.\nTRIGGER — read first.',
  aliases: [],
  // A cut is reported, but of a DIFFERENT field. The control for AC3: naming `description` must not grant
  // the unknown-aliases exemption.
  truncated_fields: ['description']
}

const CLEAR: WireSlashCommand = {
  name: 'clear',
  argument_hint: '[name]',
  description:
    'Start a new session with empty context; previous session stays on disk (resumable with /resume)',
  // The ticket's own worked case: the desktop Actions menu's `reset` is an ALIAS of `clear`, not a
  // command name, so a name-only match tells a user who knows `reset` that the command does not exist.
  aliases: ['reset', 'new'],
  truncated_fields: null
}

const CONFIG: WireSlashCommand = {
  name: 'config',
  argument_hint: 'key=value',
  description: 'Set a setting by key',
  aliases: ['settings'],
  truncated_fields: null
}

const MODEL: WireSlashCommand = {
  name: 'model',
  argument_hint: '<model>',
  description: 'Set the AI model for Claude Code',
  aliases: [],
  truncated_fields: null
}

const USAGE: WireSlashCommand = {
  name: 'usage',
  argument_hint: '',
  description: "Show session cost, plan usage, and what's contributing to your limits",
  aliases: ['cost', 'stats'],
  truncated_fields: null
}

// The unknown-aliases row. `aliases: []` says NOTHING here: claude never emits an empty alias array (zero
// of the capture's 51 entries carry one, 42 omit the key and 9 carry a non-empty one), so absent and cut
// arrive as the identical value and `truncated_fields` is the only thing separating them.
const COMPACT: WireSlashCommand = {
  name: 'compact',
  argument_hint: '<instructions>',
  description: 'Compact the conversation',
  aliases: [],
  truncated_fields: ['aliases']
}

const REMOTE_WORKFLOW: WireSlashCommand = {
  name: '__remote-workflow',
  argument_hint: '',
  description: 'Run the workspace workflow remotely',
  aliases: ['Workflow'],
  truncated_fields: null
}

// Claude's published order, preserved exactly as the store holds it.
const COMMANDS: readonly WireSlashCommand[] = [
  CLAUDE_API,
  CLEAR,
  CONFIG,
  MODEL,
  USAGE,
  COMPACT,
  REMOTE_WORKFLOW
]

// The same list with the one cut-aliases row removed — the control for "a fragment nothing can match
// reports closed". With COMPACT present that fragment has a maybe-row and the panel is correctly open,
// so the closed case has to be asked of a list where every alias list is known.
const KNOWN_COMMANDS: readonly WireSlashCommand[] = COMMANDS.filter((c) => c !== COMPACT)

function names(text: string, commands: readonly WireSlashCommand[] | null = COMMANDS): string[] {
  return slashCommandTypeAheadRows(text, commands).map((command) => command.name)
}

describe('slashCommandTypeAheadRows — when the panel opens (AC1)', () => {
  it('opens on the whole list for a lone slash', () => {
    // No special case in the implementation: the empty fragment is a prefix of every name, so the whole
    // list falls out of the ordinary match in claude's published order.
    expect(names('/')).toStrictEqual([
      'claude-api',
      'clear',
      'config',
      'model',
      'usage',
      'compact',
      '__remote-workflow'
    ])
  })

  it('opens while the text is a slash followed by non-space characters', () => {
    expect(names('/cl')).toStrictEqual(['claude-api', 'clear', 'compact'])
    expect(names('/clear')).toStrictEqual(['clear', 'compact'])
  })

  it('stays closed for text that is not a slash fragment', () => {
    // The open rule is the parent ticket's four requirements in one predicate, and each closed case here
    // is one of them: nothing typed yet, a slash that is not the first character (claude only intercepts
    // a message that BEGINS with one), the slash deleted, and the space before an argument typed.
    expect(names('')).toStrictEqual([])
    expect(names('hello')).toStrictEqual([])
    expect(names('say /clear to reset')).toStrictEqual([])
    expect(names('clear')).toStrictEqual([])
    expect(names('/clear ')).toStrictEqual([])
    expect(names('/clear old-name')).toStrictEqual([])
    // Any whitespace terminates, not only U+0020: a fragment is one unbroken run by construction. JS's
    // `$` is strict end-of-input — unlike Python's it does not match before a trailing newline — so a
    // trailing newline closes rather than being ignored.
    expect(names('/clear\n')).toStrictEqual([])
    expect(names('/clear\t')).toStrictEqual([])
    expect(names(' /clear')).toStrictEqual([])
  })

  it('stays closed when there is no list, or an empty one', () => {
    // Two DIFFERENT states in the store — `null` is "no frame has arrived for this conversation" and `[]`
    // is "claude published an empty menu" — which this module deliberately does not distinguish: neither
    // has a row to show, and a panel with no rows is not a state this function can report.
    expect(names('/cl', null)).toStrictEqual([])
    expect(names('/cl', [])).toStrictEqual([])
    expect(names('/', null)).toStrictEqual([])
    expect(names('/', [])).toStrictEqual([])
  })

  it('stays closed when the fragment matches nothing, rather than showing an empty panel', () => {
    expect(names('/zzz', KNOWN_COMMANDS)).toStrictEqual([])
    expect(names('/clearx', KNOWN_COMMANDS)).toStrictEqual([])
  })
})

describe('slashCommandTypeAheadRows — filtering and order (AC2)', () => {
  it('filters on the name, keeping claude published order', () => {
    // `usage` is in this answer through its alias `cost`, which is what makes the published-order claim
    // about the whole answer rather than about the name matches alone.
    expect(names('/c')).toStrictEqual(['claude-api', 'clear', 'config', 'usage', 'compact'])
  })

  it('matches a name in the middle, not only at the start', () => {
    expect(names('/onfi', KNOWN_COMMANDS)).toStrictEqual(['config'])
  })

  it('sorts a prefix match above a contained-only one, whatever the published order says', () => {
    // The load-bearing case, and one no "return the filtered list" implementation can pass. Published
    // order is clear(1) before config(2); `se` PREFIXES config's alias `settings` and is CONTAINED in
    // clear's alias `reset`, so the answer inverts them. `compact` trails both as the maybe-row (AC3).
    expect(names('/se')).toStrictEqual(['config', 'clear', 'compact'])
  })

  it('folds case in both directions', () => {
    // Lower fragment against an upper alias and the reverse: workspace-authored strings carry no case
    // contract, so proving one direction proves half the rule. `Workflow` is an alias of
    // `__remote-workflow`; the row returned is the row itself, matched through it.
    expect(names('/CL')).toStrictEqual(names('/cl'))
    expect(names('/work', KNOWN_COMMANDS)).toStrictEqual(['__remote-workflow'])
    expect(names('/WORKFLOW', KNOWN_COMMANDS)).toStrictEqual(['__remote-workflow'])
  })

  it('matches an alias and returns the canonical row', () => {
    // The user story's stated failure, not happening: a user who knows `reset` must not be told the
    // command does not exist. What comes back is `clear` itself, so nothing downstream resolves an alias.
    expect(names('/reset', KNOWN_COMMANDS)).toStrictEqual(['clear'])
    expect(slashCommandTypeAheadRows('/reset', KNOWN_COMMANDS)[0]).toBe(CLEAR)
    expect(names('/stats', KNOWN_COMMANDS)).toStrictEqual(['usage'])
  })
})

describe('slashCommandTypeAheadRows — a cut alias list is unknown, never none (AC3)', () => {
  it('keeps a row whose visible aliases fail to match, when its alias list was cut', () => {
    // `aliases: []` on this row is a COLLAPSE, not a statement: an alias that matches may have been cut
    // away, and the module cannot know. Excluding it is how a working command gets hidden.
    expect(names('/se')).toContain('compact')
    expect(names('/zzz')).toStrictEqual(['compact'])
  })

  it('opens the panel when the maybe-row is the only candidate', () => {
    // `[]` means closed everywhere else in this module, so this assertion IS "open rather than closed".
    expect(slashCommandTypeAheadRows('/zzz', COMMANDS)).toHaveLength(1)
    expect(slashCommandTypeAheadRows('/zzz', COMMANDS)[0]).toBe(COMPACT)
  })

  it('never outranks a row that genuinely matched', () => {
    // Asserted as a POSITION rather than as membership: a maybe is not a match, and a user's own typed
    // fragment hitting a real name must not be pushed below a guess.
    expect(names('/se').indexOf('compact')).toBe(names('/se').length - 1)
    expect(names('/c').indexOf('compact')).toBe(names('/c').length - 1)
  })

  it('grants the exemption only to a cut naming aliases', () => {
    // The two controls that prove the bucket is driven by the flag and not by an empty alias array.
    // `model` has `aliases: []` with `truncated_fields: null` — genuinely no aliases — and `claude-api`
    // reports a cut of a DIFFERENT field. Neither may survive a fragment nothing visible matches.
    expect(names('/zzz')).not.toContain('model')
    expect(names('/zzz')).not.toContain('claude-api')
  })
})

describe('completeSlashCommand — what a picked row puts in the box (AC4)', () => {
  it('yields the canonical name with its leading slash', () => {
    expect(completeSlashCommand(CLEAR)).toBe('/clear ')
    expect(completeSlashCommand(USAGE)).toBe('/usage')
  })

  it('adds exactly one trailing space when the argument hint is non-empty, and none when it is empty', () => {
    // Both branches are ordinary: 33 of the capture's 51 entries carry an empty hint.
    expect(completeSlashCommand(MODEL)).toBe('/model ')
    expect(completeSlashCommand(CONFIG)).toBe('/config ')
    expect(completeSlashCommand(CLAUDE_API)).toBe('/claude-api')
    // Exactly one, asserted as a length rather than by eye — a template that always appends a space and
    // trims the empty case would pass `toBe` on the hinted rows and fail here.
    expect(completeSlashCommand(CLEAR)).toHaveLength('/clear'.length + 1)
    expect(completeSlashCommand(CLAUDE_API).endsWith(' ')).toBe(false)
  })

  it('completes a row reached by an alias, and one with unknown aliases, to the canonical name', () => {
    const [byAlias] = slashCommandTypeAheadRows('/reset', KNOWN_COMMANDS)
    expect(completeSlashCommand(byAlias)).toBe('/clear ')
    const [maybe] = slashCommandTypeAheadRows('/zzz', COMMANDS)
    expect(completeSlashCommand(maybe)).toBe('/compact ')
  })

  it('carries a name outside any identifier charset verbatim', () => {
    expect(completeSlashCommand(REMOTE_WORKFLOW)).toBe('/__remote-workflow')
  })

  it('gets out of the way exactly when an argument is about to be typed', () => {
    // The two rules agree BY CONSTRUCTION — a hinted completion ends in a space, and a slash followed by
    // a space is closed — so the agreement is pinned as an executable property rather than as a comment.
    expect(slashCommandTypeAheadRows(completeSlashCommand(CLEAR), COMMANDS)).toStrictEqual([])
    // And the un-hinted completion leaves the panel open on the row just picked, which is why the
    // container closes it itself rather than relying on this function. Asked of the known-aliases list:
    // against the full one the answer also carries `compact`, correctly — nothing visible on that row
    // matches `usage` and its alias list was cut, so it is still a maybe (AC3).
    expect(names(completeSlashCommand(USAGE), KNOWN_COMMANDS)).toStrictEqual(['usage'])
    expect(names(completeSlashCommand(USAGE))).toStrictEqual(['usage', 'compact'])
  })
})

describe('slash type-ahead — pure, total, and untrusted-safe (AC5)', () => {
  it('returns the caller own row objects, never a copy or a projection', () => {
    // The strongest available form of "verbatim": identity. A description carrying an embedded newline
    // and a non-ASCII rune is neither matched against nor altered on the way through.
    const rows = slashCommandTypeAheadRows('/', COMMANDS)
    expect(rows[0]).toBe(CLAUDE_API)
    expect(rows[0].description).toContain('\n')
    expect(rows[0].description).toContain('—')
    rows.forEach((row, index) => expect(row).toBe(COMMANDS[index]))
  })

  it('never matches against the description', () => {
    // `pricing` and `TRIGGER` occur only in claude-api's description. A module that searched it would
    // open the panel here, and would hand the user a command whose NAME they never typed.
    expect(names('/pricing')).not.toContain('claude-api')
    expect(names('/TRIGGER')).not.toContain('claude-api')
  })

  it('mutates neither the list nor any row', () => {
    const before = structuredClone(COMMANDS.map((c) => ({ ...c })))
    slashCommandTypeAheadRows('/', COMMANDS)
    slashCommandTypeAheadRows('/se', COMMANDS)
    slashCommandTypeAheadRows('/zzz', COMMANDS)
    COMMANDS.forEach((command) => completeSlashCommand(command))
    expect(COMMANDS.map((c) => ({ ...c }))).toStrictEqual(before)
  })

  it('answers every text with a subset of the list it was given, in one of its orders (totality)', () => {
    // The property that makes #940's `options[index]` lookup safe. `resolveComposerOptionsKey` is already
    // range-guarded for a focusedIndex left over from a longer list, and this sweep is the other half:
    // whatever the text, the answer is drawn from the input and repeats nothing.
    const texts = [
      '',
      '/',
      '//',
      '/c',
      '/C',
      '/se',
      '/zzz',
      '/clear ',
      '/clear\n',
      ' ',
      'x/c',
      '/__',
      '/-',
      '/ ',
      '/💥'
    ]
    for (const commands of [COMMANDS, KNOWN_COMMANDS, [], null]) {
      for (const text of texts) {
        const rows = slashCommandTypeAheadRows(text, commands)
        expect(Array.isArray(rows)).toBe(true)
        for (const row of rows) expect(commands).toContain(row)
        expect(new Set(rows).size).toBe(rows.length)
      }
    }
  })

  it('completes every row in the list without throwing, and always leads with one slash', () => {
    for (const command of COMMANDS) {
      const completion = completeSlashCommand(command)
      expect(completion.startsWith('/')).toBe(true)
      expect(completion.slice(1).startsWith('/')).toBe(false)
      expect(completion).toContain(command.name)
    }
  })
})
