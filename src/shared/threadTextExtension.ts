const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => record(child)
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child)

/** A combined field/suffix update keeps its final revision. Only text may grow. */
export function isSameRevisionTextExtension(before: unknown, after: unknown): boolean {
  if (!record(before) || !record(after) || before.id !== after.id || before.rev !== after.rev ||
      before.kind !== after.kind || !['user_message', 'assistant_message'].includes(String(before.kind)) ||
      !record(before.content) || !record(after.content)) return false
  const prior = before.content.text, next = after.content.text
  if (typeof prior !== 'string' || typeof next !== 'string' || next.length <= prior.length || !next.startsWith(prior)) return false
  return canonical({ ...before, content: { ...before.content, text: '' } }) ===
    canonical({ ...after, content: { ...after.content, text: '' } })
}
