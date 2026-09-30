import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireAgent, WireModelOption } from '@shared/wire/types'
import type { ModelListEntry } from '../../store/modelListStore'
import { createRunSettingsWriteStore, selectEffectiveSettings } from '../../store/runSettingsWriteStore'
import { composerModelMenuModel, ComposerModelMenuView, type ComposerModelLayers } from './ComposerModelMenu'
import { ComposerOptionsPanel } from './ComposerOptionsPanel'
import { RunConfigView } from './RunConfigSections'
import { composerEffortMenuModel, selectDisplayedEffort } from './ComposerEffortMenu'

const row = (value: string, resolved_model: string, agent?: WireAgent): WireModelOption => ({
  value, resolved_model, display_name: `${value} published`, agent,
  effort_levels: ['low', 'high'], supports_auto_mode: false, truncated_fields: null
})
const alpha = { ...row('alpha', 'claude-alpha-5'), effort_levels: ['alpha-only'] }
const beta = { ...row('beta', 'claude-beta-5'), effort_levels: ['beta-only'] }
const fallback = row('default', 'claude-beta-5')
const base = [fallback, alpha, beta]
const layers = (stored: string | null = '', announced = '', picked = ''): ComposerModelLayers => ({ stored, announced, picked })
const list = (models: readonly WireModelOption[]): ModelListEntry => ({ models, droppedModels: 0 })
const noop = (): void => {}

type Case = [string, readonly WireModelOption[], ComposerModelLayers, string | null, string | null, WireAgent?]
const cases: Case[] = [
  ['no snapshot', base, layers(null), null, null],
  ['usable default', base, layers(), 'beta', 'Beta'],
  ['snapshot without any rows', [], layers(), null, 'Model'],
  ['pick before snapshot', base, layers(null, '', 'alpha'), 'alpha', 'Alpha'],
  ['resolution beats ambiguous family', [...base, row('alpha[1m]', 'claude-alpha-4')], layers('', 'claude-alpha-5'), 'alpha', 'Alpha'],
  ['saved default follows announcement', base, layers('default', 'claude-alpha-6'), 'alpha', 'Alpha'],
  ['opaque marked row uses published label', [fallback, row('[opaque]', '<unmeasured>')], layers('', '[opaque]'), '[opaque]', '[opaque] published'],
  ['saved default', base, layers('default'), 'beta', 'Beta'],
  ['empty resolution', [row('default', ''), alpha], layers(), null, 'Model'],
  ['unmeasured resolution', [row('default', '<unmeasured>'), alpha], layers(), null, 'Model'],
  ['unmatched resolution', [row('default', 'claude-zeta-5'), alpha], layers(), null, 'Zeta'],
  ['ambiguous default', [...base, row('beta[1m]', 'claude-beta-5')], layers(), null, 'Beta'],
  ['exact value beats recommendation', base, layers('', 'alpha'), 'alpha', 'Alpha'],
  ['exact resolution beats recommendation', base, layers('', 'claude-alpha-5'), 'alpha', 'Alpha'],
  ['family beats recommendation', base, layers('', 'claude-alpha-6'), 'alpha', 'Alpha'],
  ['empty announcement family', base, layers('', '[unknown]'), null, 'Beta'],
  ['unmatched announcement never marks default', base, layers('', 'claude-zeta-5'), null, 'Zeta'],
  ['ambiguous value stops', [...base, row('alpha', 'claude-other-5')], layers('', 'alpha'), null, 'Alpha'],
  ['ambiguous resolution stops before unique family', [...base, row('other', 'claude-alpha-5')], layers('', 'claude-alpha-5'), null, 'Alpha'],
  ['ambiguous family stops', [...base, row('alpha[1m]', 'claude-alpha-4')], layers('', 'claude-alpha-6'), null, 'Alpha'],
  ['exact value beats ambiguous resolution', [...base, row('other', 'alpha')], layers('', 'alpha'), 'alpha', 'Alpha'],
  ['announcement over no snapshot', base, layers(null, 'alpha'), 'alpha', 'Alpha'],
  ['explicit matched retains announced label', base, layers('beta', 'claude-alpha-5'), 'beta', 'Alpha'],
  ['explicit unmatched never maps family', base, layers('claude-alpha-5', 'beta'), null, 'Beta'],
  ['raw comparison does not trim', base, layers(' alpha '), null, ' alpha '],
  ['pick beats announcement and saved', base, layers('beta', 'beta', 'alpha'), 'alpha', 'Alpha'],
  ['unmatched pick', base, layers('beta', 'alpha', 'unknown'), null, 'Unknown'],
  ['Codex empty snapshot', [...base, row('delta', 'vendor-delta-5', 'codex')], layers(), null, 'Model', 'codex'],
  ['Codex no snapshot', [row('delta', 'vendor-delta-5', 'codex')], layers(null), null, null, 'codex'],
  ['Codex inherited resolution', [...base, row('delta', 'vendor-delta-5', 'codex')], layers('', 'vendor-delta-5'), 'delta', 'vendor-delta-5', 'codex'],
  ['Codex exact announcement label', [row('delta', 'vendor-delta-5', 'codex')], layers('', 'delta'), 'delta', 'delta published', 'codex'],
  ['agent filtering rejects foreign announcement', [...base, row('alpha', 'claude-alpha-5', 'codex')], layers('', 'beta'), null, 'beta', 'codex'],
  ['Claude ignores foreign ambiguity', [...base, row('other', 'claude-alpha-5', 'codex')], layers('', 'claude-alpha-5'), 'alpha', 'Alpha']
]

function assertSurfaces(models: ModelListEntry, input: ComposerModelLayers, expected: string | null, label: string | null, agent: WireAgent = 'claude'): void {
  const menu = composerModelMenuModel(models, input, agent)
  expect(menu?.currentId ?? null).toBe(expected)
  expect(menu?.label ?? null).toBe(label)
  const panel = renderToStaticMarkup(<ComposerOptionsPanel options={menu?.options ?? []} currentId={menu?.currentId ?? null}
    onSelect={noop} ariaLabel="Model" focusedIndex={0} />)
  const sheet = renderToStaticMarkup(<RunConfigView model={input.picked || input.stored || ''} modelLayers={input}
    effort="low" yolo={false} usedTokens={0} windowTokens={0} models={models} agent={agent}
    announced={input.announced ? { model: input.announced, truncated: false } : null} />)
  const selected = expected === null ? [] : [expected]
  expect([...sheet.matchAll(/class="run-config__model-row"[\s\S]*?<\/div><\/div>/g)]
    .filter(match => match[0].includes('aria-label="Current model"'))
    .map(match => /class="run-config__model-name">([^<]*)</.exec(match[0])?.[1])).toEqual(selected.map(id => `${id} published`))
  expect((panel.match(/aria-current="true"/g) ?? []).length).toBe(selected.length)
  const visibleRows = models.models.filter(row => (row.agent ?? 'claude') === agent && row.value !== 'default')
  const markedPositions = [...panel.matchAll(/<button\b[^>]*role="menuitem"[\s\S]*?<\/button>/g)]
    .flatMap((match, index) => match[0].includes('aria-current="true"') ? [index] : [])
  expect(markedPositions).toEqual(selected.map(id => visibleRows.findIndex(row => row.value === id)))
  expect(sheet).not.toContain('>default published<')
  expect(panel).not.toContain('>Default<')
  const trigger = renderToStaticMarkup(<ComposerModelMenuView models={models} layers={input} agent={agent} />)
  if (label === null) expect(trigger).toBe('')
  else expect(trigger).toContain(`>${label}</span>`)
}

describe('running-model inputs shared by dropdown and sheet', () => {
  it.each(cases)('%s', (_name, rows, input, expected, label, agent) => {
    assertSurfaces(list(rows), input, expected, label, agent)
  })

  it('uses pending, confirmed and rejected picks on both surfaces', () => {
    const store = createRunSettingsWriteStore()
    const check = (expected: string, label: string): void => assertSurfaces(list(base),
      layers('', 'alpha', selectEffectiveSettings(null, store.getState()).model), expected, label)
    check('alpha', 'Alpha')
    store.getState().dispatch({ type: 'changeDispatched', changeId: 'one', change: { field: 'model', value: 'beta' } })
    check('beta', 'Beta')
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'one' })
    check('beta', 'Beta')
    store.getState().dispatch({ type: 'changeDispatched', changeId: 'two', change: { field: 'model', value: 'alpha' } })
    check('alpha', 'Alpha')
    store.getState().dispatch({ type: 'settingsRejected', changeId: 'two' })
    check('beta', 'Beta')
  })

  it.each([
    ['applied beats saved', 'high', 'low', undefined, 'high'],
    ['pending beats null', null, 'low', 'high', 'high'],
    ['pending beats applied', 'high', 'low', 'low', 'low'],
    ['saved when unavailable', undefined, 'low', undefined, 'low'],
    ['saved when empty applied', '', 'low', undefined, 'low'],
    ['explicit null has no mark', null, 'low', undefined, null]
  ] as const)('%s effort on both surfaces, with internal default offerings', (_name, applied, saved, pending, expected) => {
    const store = createRunSettingsWriteStore()
    if (pending) store.getState().dispatch({ type: 'changeDispatched', changeId: 'effort', change: { field: 'effort', value: pending } })
    const snapshot = { model: '', effort: saved, effectiveEffort: applied, yolo: false, permissionMode: 'default', usedTokens: 0, windowTokens: 0 }
    const effort = selectDisplayedEffort(snapshot, store.getState())
    const menu = composerEffortMenuModel(list(base), '', effort)
    const sheet = renderToStaticMarkup(<RunConfigView model="" effort={effort} yolo={false} usedTokens={0} windowTokens={0} models={list(base)} announced={{ model: 'alpha', truncated: false }} />)
    expect(menu.currentId).toBe(expected ?? '')
    expect([...sheet.matchAll(/aria-current="true">([^<]*)</g)].map(match => match[1])).toEqual(expected ? [expected] : [])
    expect(sheet).toContain('>low</')
    expect(sheet).toContain('>high</')
    expect(sheet).not.toContain('>alpha-only</')
  })
})
