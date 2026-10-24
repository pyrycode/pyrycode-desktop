type Delivery = {
  roots: { requestId: string | null; sequence: number; id: number; status: string; attachment: string; filename: string }[]
  finals: { requestId: string; sequence: number }[]
}

export function completedAttachmentDelivery(evidence: Delivery, requestId: string,
  expected: { id: number; attachment: string; filename: string }): boolean {
  return evidence.roots.some(root => root.requestId === requestId && root.id === expected.id &&
    root.status === 'delivered' && root.attachment === expected.attachment && root.filename === expected.filename &&
    evidence.finals.some(final => final.requestId === requestId && final.sequence > root.sequence))
}
