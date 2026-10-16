import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRecording, RecordedExchange } from './recordedExchange'
import { encodeEnvelope } from '../../src/main/transport/codec'

it('accepts a named client capture with explicit scenario inputs, without weakening request matching', () => {
  const original = JSON.parse(readFileSync('e2e/recordings/permission-allow.json', 'utf8'))
  original.scenario = { id: 'daemon-rename', inputs: { nonce: 1792140000000 } }
  const recording = parseRecording(JSON.stringify(original))
  expect(recording.scenario.id).toBe('daemon-rename')
  const replay = new RecordedExchange(recording)
  const first = recording.wire[0].message
  expect(() => replay.reply(encodeEnvelope({ ...first, payload: { unexpected: true } }))).toThrow('request mismatch')
})

it('rejects unnamed captures and missing or invalid replay inputs', () => {
  const original = JSON.parse(readFileSync('e2e/recordings/permission-allow.json', 'utf8'))
  for (const scenario of [{ id: '../escape', inputs: { nonce: 1 } }, { id: 'daemon-rename' },
    { id: 'daemon-rename', inputs: { nonce: 'today' } }]) {
    expect(() => parseRecording(JSON.stringify({ ...original, scenario }))).toThrow('Invalid daemon recording')
  }
})
