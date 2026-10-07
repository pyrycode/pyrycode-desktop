import { memo, useState } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Nodes, RootContent } from 'mdast'
import type { AllowElement } from 'react-markdown'
import { AssistantMarkdown, remarkGfmSubset } from './AssistantMarkdown'

const parser = unified().use(remarkParse).use(remarkGfmSubset)
const inlineTypes = new Set(['emphasis', 'strong', 'delete', 'inlineCode', 'link', 'image'])
function descendants(node: Nodes): Nodes[] {
  return [node, ...('children' in node ? node.children.flatMap(descendants) : [])]
}
function parseMarkdown(source: string) { return parser.parse(source) }
function signature(nodes: RootContent[], source: string, offset: number): string {
  const lines = source.slice(0, offset).split('\n').length - 1
  return JSON.stringify(nodes, (key, value) =>
    key === 'offset' ? value + offset : key === 'line' ? value + lines : value)
}

type Partition = { source: string; frozen: { text: string; offset: number }[]; offset: number; whole: boolean }
/** Only verified, context-independent source units freeze. Source replacements discard the cache. */
export function partitionMarkdown(source: string, previous?: Partition): Partition {
  const state = previous && source.startsWith(previous.source)
    ? previous : { source: '', frozen: [], offset: 0, whole: false }
  if (source === state.source) return state
  const tail = source.slice(state.offset)
  const tree = parseMarkdown(tail)
  if (state.whole || descendants(tree).some(node => node.type === 'definition')) {
    return { source, frozen: [], offset: 0, whole: true }
  }
  const frozen = [...state.frozen]
  let start = 0
  for (let end = 1; end < tree.children.length; end++) {
    const last = tree.children[end - 1]
    const next = tree.children[end]
    const nextOffset = next.position?.start.offset
    if (nextOffset === undefined || last === undefined) continue
    const cut = tail.lastIndexOf('\n', nextOffset - 1) + 1
    if (tail.slice(cut).split('\n').length < 3) continue
    if (last.type === 'list' || last.type === 'blockquote') continue
    if (last.type === 'code' && !/^[ \t]*(?:`{3,}|~{3,})/.test(tail.slice(last.position?.start.offset ?? 0))) continue
    const unit = tail.slice(start, cut)
    const remainder = tail.slice(cut)
    if (signature(parseMarkdown(unit).children, tail, start) !== signature(tree.children.slice(
      tree.children.findIndex(node => (node.position?.start.offset ?? 0) >= start), end), tail, 0)) continue
    if (signature(parseMarkdown(remainder).children, tail, cut) !== signature(tree.children.slice(end), tail, 0)) continue
    frozen.push({ text: unit, offset: state.offset + start })
    start = cut
  }
  return { source, frozen, offset: state.offset + start, whole: false }
}

/** Complete only the final header candidate, preserving enclosing quote prefixes and original bytes. */
function pendingTable(source: string): { text: string; start: number; end: number } | null {
  const lines = source.split('\n')
  while (lines.length > 1 && lines.at(-1) === '') lines.pop()
  const last = lines.at(-1) ?? ''
  const delimiter = lines.length > 1 && (lines.at(-2)?.includes('|') ?? false)
    && /^(?:\s*>\s*)*[ |:\-]*$/.test(last)
  const headerIndex = lines.length - (delimiter ? 2 : 1)
  const header = lines[headerIndex]
  if (header === undefined || !header.includes('|')) return null
  const headerStart = lines.slice(0, headerIndex).join('\n').length + (headerIndex ? 1 : 0)
  const quote = /^(?: {0,3}> ?)+/.exec(header)?.[0] ?? ''
  if (descendants(parseMarkdown(source)).some(node => node.type === 'table'
    && node.position?.start.offset === headerStart + quote.length)) return null
  const insertion = source.trimEnd().length
  const existing = delimiter ? last.slice(quote.length) : ''
  const lastCell = existing.split('|').at(-1)?.trim() ?? ''
  const completion = lastCell === '' ? '---' : lastCell.includes('-') ? '' : '-'
  for (let cells = 1; cells <= header.split('|').length; cells++) {
    const suffix = delimiter
      ? completion + ' | ---'.repeat(cells - 1)
      : '\n' + quote + '---' + ' | ---'.repeat(cells - 1)
    const text = source.slice(0, insertion) + suffix + source.slice(insertion)
    const table = descendants(parseMarkdown(text)).find(node => node.type === 'table' && node.position?.start.offset === headerStart + quote.length)
    if (table?.position) return { text, start: table.position.start.offset ?? headerStart, end: table.position.end.offset ?? text.length }
  }
  return null
}

/** A virtual insertion never becomes content: keep it only when the parser pairs its delimiters. */
export function pendingMarkdown(source: string): { text: string; allowElement: AllowElement } {
  const table = pendingTable(source)
  let text = table?.text ?? source
  const inserted: { start: number; end: number }[] = []
  const tableStart = table?.start
  for (let pass = 0; pass < 32 && table === null; pass++) {
    const tree = parseMarkdown(text)
    const nodes = descendants(tree)
    const leaf = nodes.filter(node => node.type === 'paragraph' || node.type === 'heading').at(-1)
    if (!leaf?.position || (leaf.position.end.offset ?? 0) < text.trimEnd().length) break
    const texts = descendants(leaf).filter(node => node.type === 'text')
    const at = text.trimEnd().length
    const candidates = texts.flatMap(node => {
      const start = node.position?.start.offset ?? 0
      const end = node.position?.end.offset ?? start
      return [...text.slice(start, end).matchAll(/`+|\*+|_+|~{2,}|\[/g)].map(match => ({
        start: start + (match.index ?? 0), marker: match[0]
      }))
    }).filter(candidate => {
      let slash = candidate.start
      while (slash > 0 && text[slash - 1] === '\\') slash--
      return (candidate.start - slash) % 2 === 0
    }).reverse()
    let paired = false
    for (const candidate of candidates) {
      const closers = candidate.marker === '[' ? [')', '))', ']()'] : [candidate.marker]
      for (const closer of closers) {
        const trial = text.slice(0, at) + closer + text.slice(at)
        const trialNodes = descendants(parseMarkdown(trial))
        const node = trialNodes.find(node => inlineTypes.has(node.type)
          && node.position?.start.offset === candidate.start && node.position.end.offset === at + closer.length)
        if (node === undefined) continue
        // Re-pairing must not turn any earlier virtual closer into literal text or code content.
        const ranges = [...inserted, { start: at, end: at + closer.length }]
        if (trialNodes.some(node => {
          if (node.type !== 'text' && node.type !== 'inlineCode') return false
          const start = node.position?.start.offset ?? 0
          const end = node.position?.end.offset ?? start
          const fence = node.type === 'inlineCode' ? /^`+/.exec(trial.slice(start))?.[0].length ?? 0 : 0
          return ranges.some(range => range.start < end - fence && range.end > start + fence)
        })) continue
        inserted.push({ start: at, end: at + closer.length })
        text = trial
        paired = true
        break
      }
      if (paired) break
    }
    if (!paired) break
  }
  const allowElement: AllowElement = element => {
    const start = element.position?.start.offset
    const end = element.position?.end.offset
    if (start === undefined || end === undefined) return true
    if (tableStart !== undefined && start >= tableStart && end <= (table?.end ?? 0)
      && ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'em', 'strong', 'del', 'code', 'a'].includes(element.tagName)) return false
    return !['em', 'strong', 'del', 'code', 'a'].includes(element.tagName)
      || !inserted.some(range => start < range.start && end >= range.end)
  }
  return { text, allowElement }
}

const FrozenMarkdown = memo(function FrozenMarkdown({ text, onOpenMarkdownPath }: {
  text: string; onOpenMarkdownPath?: (path: string) => void
}): JSX.Element {
  return <AssistantMarkdown text={text} onOpenMarkdownPath={onOpenMarkdownPath} />
})

export function StreamingAssistantMarkdown({ text, onOpenMarkdownPath }: {
  text: string; onOpenMarkdownPath?: (path: string) => void
}): JSX.Element {
  const [held, setHeld] = useState(() => partitionMarkdown(text))
  const partition = held.source === text ? held : partitionMarkdown(text, held)
  if (partition !== held) setHeld(partition)
  const pending = pendingMarkdown(text.slice(partition.offset))
  return <>
    {partition.frozen.map(unit => <FrozenMarkdown key={unit.offset} text={unit.text} onOpenMarkdownPath={onOpenMarkdownPath} />)}
    <AssistantMarkdown text={pending.text} allowElement={pending.allowElement} onOpenMarkdownPath={onOpenMarkdownPath} />
  </>
}
