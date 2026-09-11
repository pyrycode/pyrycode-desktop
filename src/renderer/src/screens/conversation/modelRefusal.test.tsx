import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerErrorSlot, ModelRefusalRow } from './ConversationScreen'
import type { ModelRefusalEvent } from '@shared/ipc/events'

const refusal: ModelRefusalEvent = { type: 'modelRefusalFallback', originalModel: 'opus', fallbackModel: 'sonnet',
  scope: 'session', refusalCategory: 'inert', banner: '<script>not markup</script>', truncatedFields: null, droppedFields: null }
it('renders the collapsed label and an accessible disclosure only for a nonempty banner', () => {
  const html = renderToStaticMarkup(<ModelRefusalRow refusal={refusal} />)
  expect(html).toContain('Refused on opus, continued on sonnet')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('not markup')
  const empty = renderToStaticMarkup(<ModelRefusalRow refusal={{ ...refusal, banner: '' }} />)
  expect(empty).not.toContain('<button')
  expect(empty).not.toContain('aria-expanded')
})
it('attributes escaped bounded text to Claude and handles empty model identifiers', () => {
  const html = renderToStaticMarkup(<ModelRefusalRow refusal={{ ...refusal, originalModel: '', fallbackModel: '', banner: refusal.banner + 'x'.repeat(9000) }} defaultExpanded />)
  expect(html).toContain('Refused on unknown model, continued on unknown model')
  expect(html).toContain('Claude:')
  expect(html).toContain('&lt;script&gt;not markup&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('x'.repeat(8193))
  const no = { type: 'modelRefusalNoFallback' as const, originalModel: '', banner: '', refusalCategory: '', truncatedFields: null, droppedFields: null }
  expect(renderToStaticMarkup(<ModelRefusalRow refusal={no} />)).toContain('Refused by unknown model')
  expect(renderToStaticMarkup(<ModelRefusalRow refusal={{ ...no, originalModel: 'x'.repeat(1000) }} />)).not.toContain('x'.repeat(257))
})
it('keeps connection errors and stopped-turn recovery above refusal, with usage below', () => {
  const connected = { type: 'connected' as const, ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] } }
  const props = { onRepair: () => {}, notice: <span>usage</span>, refusal: <span>swap</span> }
  expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={connected} />)).toBe('<span>swap</span>')
  expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={connected} recovery={<span>stopped</span>} />)).toBe('<span>stopped</span>')
  expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'disconnected' }} />)).toBe('')
  const html = renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'error', error: { code: 'transport', message: 'private', retryable: false } }} />)
  expect(html).toContain('Re-pair')
  expect(html).not.toContain('swap')
  expect(html).not.toContain('private')
})
