import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { effortDefaultToApply, EffortDefaultData, type EffortDefaultInput } from './EffortDefaultData'
import type { ModelListEntry } from '../../store/modelListStore'
import type { WireModelOption } from '@shared/wire/types'
import {
  createRunSettingsWriteStore,
  selectEffectiveSettings
} from '../../store/runSettingsWriteStore'
import type { RunConfigSnapshot } from '../../store/runConfigStore'

// #1169 — the apply decision, as data. `vitest.config.ts` is `environment: 'node'`, so no test in this
// repo runs a React effect: the leaf's effect is thin glue over this function, and every rule it obeys is
// asserted here directly.
//
// THE LEVELS ARE INVENTED, the sibling effort surfaces' rule: seeding the measured five would put back
// the vocabulary #976 deleted and would let a client-side fallback pass unnoticed. They are mutually
// non-substring, so a widened comparison would be visible rather than accidentally right.
const LEVELS = ['brisk', 'steady', 'deep']
const [, REMEMBERED] = LEVELS

const GRADED: WireModelOption = {
  value: 'graded',
  display_name: 'Graded pick',
  resolved_model: 'claude-graded-5',
  effort_levels: LEVELS,
  supports_auto_mode: true,
  truncated_fields: null
}

// #1168's inherited-default row: the value the daemon publishes for a chat nobody set a model on.
const INHERITED: WireModelOption = { ...GRADED, value: 'default' }

const models = (rows: readonly WireModelOption[]): ModelListEntry => ({
  models: rows,
  droppedModels: 0
})

/** The one input that applies. Each test below negates exactly one field of it. */
const APPLIES: EffortDefaultInput = {
  conversationId: 'chat-b',
  appliedFor: null,
  sessionId: 'session-b',
  effort: '',
  model: GRADED.value,
  models: models([GRADED]),
  remembered: REMEMBERED
}

describe('effortDefaultToApply', () => {
  it('applies the remembered level to a chat that reports none', () => {
    expect(effortDefaultToApply(APPLIES)).toBe(REMEMBERED)
  })

  it('applies nothing with no chat open', () => {
    expect(effortDefaultToApply({ ...APPLIES, conversationId: null })).toBeNull()
  })

  it('applies nothing with nothing remembered (AC4)', () => {
    expect(effortDefaultToApply({ ...APPLIES, remembered: null })).toBeNull()
  })

  it('applies nothing to a chat this opening has already been applied to (AC3)', () => {
    expect(effortDefaultToApply({ ...APPLIES, appliedFor: 'chat-b' })).toBeNull()
  })

  it('applies to a chat other than the one already applied to', () => {
    expect(effortDefaultToApply({ ...APPLIES, appliedFor: 'chat-a' })).toBe(REMEMBERED)
  })

  it('applies nothing to a chat that reports an effort of its own (AC2)', () => {
    expect(effortDefaultToApply({ ...APPLIES, effort: 'brisk' })).toBeNull()
    // Even when the session's own level is the remembered one: it already answered the question, so
    // there is nothing to send.
    expect(effortDefaultToApply({ ...APPLIES, effort: REMEMBERED })).toBeNull()
  })

  it('applies nothing with no addressable session id', () => {
    // `null` (never observed) and `''` (the daemon says it has no session to address) are both inert —
    // the second is what #1167's clear leaves standing for one round trip after a switch.
    expect(effortDefaultToApply({ ...APPLIES, sessionId: null })).toBeNull()
    expect(effortDefaultToApply({ ...APPLIES, sessionId: '' })).toBeNull()
  })

  it('applies nothing when the remembered level appears in no published level (AC4)', () => {
    expect(effortDefaultToApply({ ...APPLIES, remembered: 'unpublished' })).toBeNull()
  })

  it('applies nothing on a near-miss rather than widening the comparison', () => {
    const graded = { ...GRADED, effort_levels: ['xhigh'] }
    expect(
      effortDefaultToApply({ ...APPLIES, models: models([graded]), remembered: 'high' })
    ).toBeNull()
  })

  it('applies nothing with no list, no matching row, or an empty published list', () => {
    expect(effortDefaultToApply({ ...APPLIES, models: null })).toBeNull()
    expect(effortDefaultToApply({ ...APPLIES, models: undefined })).toBeNull()
    expect(effortDefaultToApply({ ...APPLIES, model: 'unmatched' })).toBeNull()
    expect(
      effortDefaultToApply({ ...APPLIES, models: models([{ ...GRADED, effort_levels: [] }]) })
    ).toBeNull()
  })

  it('resolves an empty model through the inherited-default row (#1168)', () => {
    // A chat nobody set a model on: the levels are knowable, so the default is appliable. This is the
    // common case for a brand-new chat, not an edge one.
    expect(effortDefaultToApply({ ...APPLIES, model: '', models: models([INHERITED]) })).toBe(
      REMEMBERED
    )
    // ...and with no inherited-default row published, still nothing.
    expect(
      effortDefaultToApply({ ...APPLIES, model: '', models: models([GRADED]) })
    ).toBeNull()
  })
})

// The availability hazard this design introduces is a self-inflicted write loop against the daemon:
// "empty effort ⇒ apply" re-arms itself every time a rejection drops the pending record. These pins run
// against the REAL write store rather than a hand-built input, so they assert the composition rather
// than a belief about it.
describe('effortDefaultToApply against the real write store', () => {
  const BLANK: RunConfigSnapshot = {
    model: GRADED.value,
    effort: '',
    yolo: false,
    permissionMode: 'default',
    usedTokens: 0,
    windowTokens: 0
  }

  const decide = (
    store: ReturnType<typeof createRunSettingsWriteStore>,
    appliedFor: string | null
  ): string | null => {
    const effective = selectEffectiveSettings(BLANK, store.getState())
    return effortDefaultToApply({
      ...APPLIES,
      appliedFor,
      effort: effective.effort,
      model: effective.model
    })
  }

  it('refuses a second apply the moment the first is recorded, and again once confirmed', () => {
    const store = createRunSettingsWriteStore()

    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'id-1',
      change: { field: 'effort', value: REMEMBERED }
    })
    // The optimistic overlay makes the composed effort non-empty in the SAME synchronous step as the
    // send is recorded, so no second frame can go out even with the marker ignored.
    expect(decide(store, null)).toBeNull()

    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'id-1' })
    expect(decide(store, null)).toBeNull()
  })

  it('refuses to re-apply a refused level even after an unrelated change clears the rejection', () => {
    // THE REGRESSION THE SECURITY REVIEW FOUND. Guarding on `runSettingsWriteStore.error` looks right and
    // is clearable: `changeDispatched` resets it, so an operator picking a MODEL after the default was
    // refused would re-arm the apply while the chat's effort is still '' — the refused level goes out
    // again, once per unrelated setting change. The marker has no such coupling.
    const store = createRunSettingsWriteStore()

    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'id-1',
      change: { field: 'effort', value: REMEMBERED }
    })
    store.getState().dispatch({ type: 'settingsRejected', changeId: 'id-1' })
    // The rollback is real: the composed effort is empty again, so the marker is the only thing left.
    expect(selectEffectiveSettings(BLANK, store.getState()).effort).toBe('')
    expect(decide(store, APPLIES.conversationId)).toBeNull()

    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'id-2',
      change: { field: 'model', value: 'graded' }
    })
    expect(store.getState().error).toBeNull()
    expect(decide(store, APPLIES.conversationId)).toBeNull()
  })
})

describe('EffortDefaultData (container)', () => {
  // Headless: it renders null and dereferences window.pyry only inside its effect, so a server render
  // (effects never run) produces empty markup with no bridge mock — the RunSettingsWriteData idiom. Its
  // emptiness is load-bearing rather than cosmetic: it mounts inside `.composer__footer`, where several
  // e2e specs count anchors, buttons and the row's geometry.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(
        createElement(EffortDefaultData, { conversationId: 'chat-b' })
      )
    }).not.toThrow()
    expect(markup).toBe('')
  })

  it('server-renders to empty markup with no conversation open', () => {
    expect(
      renderToStaticMarkup(createElement(EffortDefaultData, { conversationId: null }))
    ).toBe('')
  })
})


it.each([undefined, null, '', 'brisk'])('recalls with applied reading %j when the explicit choice is empty', effectiveEffort => {
  const writes = createRunSettingsWriteStore()
  const snapshot: RunConfigSnapshot = { model: GRADED.value, effort: '', effectiveEffort,
    yolo: false, permissionMode: 'default', usedTokens: 0, windowTokens: 0 }
  const explicit = selectEffectiveSettings(snapshot, writes.getState())
  expect(effortDefaultToApply({ ...APPLIES, ...explicit })).toBe(REMEMBERED)
  for (const remembered of ['', 'STEADY', ' steady ', '__proto__', 'unpublished']) {
    expect(effortDefaultToApply({ ...APPLIES, ...explicit, remembered })).toBeNull()
  }
})

// #1651 — on a Codex conversation the remembered effort joins the Codex row's levels only. Claude's
// inherited-default row is in the list, so an unset Codex model would inherit its levels if the agent
// were ignored.
describe('#1651 — effortDefaultToApply reads the conversation agent\'s row', () => {
  const CODEX: WireModelOption = { ...GRADED, value: 'vendor', agent: 'codex' }
  const MERGED = models([INHERITED, GRADED, CODEX])

  it('applies nothing on a Codex conversation with no model set', () => {
    expect(effortDefaultToApply({ ...APPLIES, model: '', models: MERGED, agent: 'codex' })).toBeNull()
    expect(effortDefaultToApply({ ...APPLIES, model: '', models: MERGED })).toBe(REMEMBERED)
  })

  it('applies a level the chosen Codex row lists, and never a Claude row\'s', () => {
    expect(effortDefaultToApply({ ...APPLIES, model: CODEX.value, models: MERGED, agent: 'codex' })).toBe(REMEMBERED)
    expect(effortDefaultToApply({ ...APPLIES, model: GRADED.value, models: MERGED, agent: 'codex' })).toBeNull()
  })
})
