import { describe, expect, it } from 'vitest'
import { completedAttachmentDelivery } from './compactAttachmentEvidence'

const expected = { id: 1, attachment: 'daemon-attachment', filename: 'compact-authority.png' }
const root = { ...expected, status: 'delivered', requestId: 'navigation', sequence: 2 }
const final = { requestId: 'navigation', sequence: 3 }

describe('request-owned compact attachment delivery', () => {
  it('accepts the owning attachment root followed by its successful final', () => {
    expect(completedAttachmentDelivery({ roots: [root], finals: [final] }, 'navigation', expected)).toBe(true)
  })

  it.each([
    { name: 'empty completed reply with only retained send-time facts', roots: [{ ...root, requestId: null }], finals: [final] },
    { name: 'data belonging to another query', roots: [{ ...root, requestId: 'send-time' }], finals: [final] },
    { name: 'final belonging to another query', roots: [root], finals: [{ ...final, requestId: 'send-time' }] },
    { name: 'missing data', roots: [], finals: [final] },
    { name: 'missing final', roots: [root], finals: [] },
    { name: 'final before data', roots: [root], finals: [{ ...final, sequence: 1 }] },
    { name: 'another root', roots: [{ ...root, id: 2 }], finals: [final] },
    { name: 'another attachment', roots: [{ ...root, attachment: 'optimistic-attachment' }], finals: [final] },
    { name: 'another filename', roots: [{ ...root, filename: 'optimistic.png' }], finals: [final] },
    { name: 'queued rather than delivered replacement', roots: [{ ...root, status: 'queued' }], finals: [final] }
  ])('rejects $name', ({ roots, finals }) => {
    expect(completedAttachmentDelivery({ roots, finals }, 'navigation', expected)).toBe(false)
  })
})
