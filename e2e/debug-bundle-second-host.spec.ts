import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, DebugBundleChunkPayload, Envelope } from '../src/shared/wire/types'

// #1692: with two hosts paired, Log data's Download addresses the open conversation's host. A bare
// request is refused as ambiguous and nothing answers it, so the section used to hang on "Downloading…".
// Each daemon streams a DIFFERENT number of chunks, so the caption itself names which host answered.

const ROUNDTRIP_TIMEOUT_MS = 15_000
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const FIRST_CHUNKS = 5
const SECOND_CHUNKS = 3

function chunkFrames(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, seq) => encodeEnvelope({
    id: 1,
    type: 'debug_bundle_chunk',
    ts: FIXED_TS,
    payload: { seq, data: Buffer.from([seq]).toString('base64') } satisfies DebugBundleChunkPayload
  }))
}

// Seeds this daemon's own row and streams `chunks` frames per bundle request, recording every inbound.
function capturingFake(row: ConversationSummary, chunks: number, captured: Envelope[]) {
  return (inbound: Uint8Array): Uint8Array[] => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    if (env.type === 'list_conversations') return [seedConversationsFrame(row)]
    if (env.type === 'request_debug_bundle') return chunkFrames(chunks)
    return []
  }
}

const bundleRequests = (captured: Envelope[]): number =>
  captured.filter(e => e.type === 'request_debug_bundle').length

test('Download in a second-host conversation asks only that host and shows its progress', async ({ launchPairedApp }) => {
  const first: Envelope[] = []
  const second: Envelope[] = []
  const { page } = await launchPairedApp(
    { buildReplyFrames: capturingFake(SEEDED_ROW, FIRST_CHUNKS, first) },
    { secondServer: { buildReplyFrames: capturingFake(SECOND_SEEDED_ROW, SECOND_CHUNKS, second) } }
  )

  await page.getByRole('button', { name: SECOND_SEEDED_ROW.name ?? '', exact: true }).click()
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Run configuration', exact: true }).click()
  await page.locator('.log-data__download').click()

  await expect.poll(() => bundleRequests(second), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  await expect(page.locator('.log-data__status'))
    .toContainText(`Downloading… ${SECOND_CHUNKS} chunks received`, { timeout: ROUNDTRIP_TIMEOUT_MS })
  expect(bundleRequests(first)).toBe(0)
})
