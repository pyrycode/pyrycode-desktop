import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ContextUsageMCPTool } from '@shared/wire/types'
import type { ReportedContextReading } from '../../store/reportedContextStore'
import { shortenPath } from './shortenPath'

// #1254: the context reading's breakdown — what fills the window, by category, MCP tool and memory
// file. A read-only panel over the one held `ReportedContextReading`, in the footer options panel's
// style (Figma 121:3879) with nothing selectable. There is no dedicated drawing.
//
// SECURITY — this is the DOM sink the reportedContextStore header leaves to this ticket. The model, every
// category name, tool name, server name and path are untrusted claude- or workspace-authored text, and
// each reaches exactly one place: a JSX text child, where React escapes it. None reaches an attribute, a
// `key`, a URL or a log; `memoryFiles[].type` is not read at all. The only number that reaches an
// attribute is a bar width clamped to [0, 100]. The three dropped counts are shown as figures and never
// sized, iterated or allocated from. Nothing on this path is logged, per the store header.

/** The panel's accessible name — client-owned, never a daemon string. */
export const CONTEXT_BREAKDOWN_LABEL = 'Context breakdown'

/** The panel's whole content while the conversation has no reading held. Client-owned. */
export const CONTEXT_BREAKDOWN_PENDING = 'A context reading arrives after the next turn.'

/** A token figure as `12.4k` — the turn-stats and compaction formatting. `?` for a non-finite value. */
export function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens)) return '?'
  if (tokens < 1000) return String(Math.round(tokens))
  return `${(Math.round(tokens / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
}

/** A row's share of the maximum as a CSS percentage, clamped to [0, 100]. An unusable maximum or a
 *  non-finite result draws an empty bar rather than an invalid or unbounded width. Multiplied before
 *  dividing so an exact share prints exactly (6.2, not 6.200000000000001). */
export function contextBarPercent(tokens: number, maxTokens: number): number {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return 0
  const share = (tokens * 100) / maxTokens
  if (!Number.isFinite(share)) return 0
  return Math.min(100, Math.max(0, share))
}

/** The MCP inventory grouped by `server_name`: groups in first-appearance order, rows in held order, so
 *  the producer's descending-token order survives inside each group. A `Map`, never a plain object — a
 *  server named `__proto__` is an ordinary key by construction. Iterates the row array only. */
export function groupMcpToolsByServer(
  tools: readonly ContextUsageMCPTool[]
): ReadonlyMap<string, readonly ContextUsageMCPTool[]> {
  const groups = new Map<string, ContextUsageMCPTool[]>()
  for (const tool of tools) {
    const group = groups.get(tool.server_name)
    if (group) group.push(tool)
    else groups.set(tool.server_name, [tool])
  }
  return groups
}

// One `name · 12.4k` row. The name ellipsizes; the figure never shrinks. The separator lives in the
// figure's run, which preserves its spaces, so the row's text reads "name · 12.4k".
function BreakdownRow({ name, tokens }: { name: string; tokens: number }): JSX.Element {
  return (
    <span className="context-breakdown__line">
      <span className="context-breakdown__name">{name}</span>
      <span className="context-breakdown__figure">{` · ${formatContextTokens(tokens)}`}</span>
    </span>
  )
}

// A positive dropped count as one line. `> 0` is false for NaN, so only a real count shows.
function MoreLine({ dropped }: { dropped: number }): JSX.Element | null {
  return dropped > 0 ? <li className="context-breakdown__more">+{dropped} more</li> : null
}

function ReadingBreakdown({ reading }: { reading: ReportedContextReading }): JSX.Element {
  const servers = [...groupMcpToolsByServer(reading.mcpTools)]
  const showCategories = reading.categories.length > 0 || reading.droppedCategories > 0
  const showMcp = reading.mcpTools.length > 0 || reading.droppedMcpTools > 0
  const showMemory = reading.memoryFiles.length > 0 || reading.droppedMemoryFiles > 0
  return (
    <>
      <p className="context-breakdown__header">
        <span className="context-breakdown__model">{reading.model}</span>
        <span className="context-breakdown__total">
          {`${formatContextTokens(reading.totalTokens)} of ${formatContextTokens(reading.maxTokens)} tokens`}
        </span>
      </p>
      {showCategories && (
        <ul className="context-breakdown__list">
          {reading.categories.map((category, index) => (
            // Index keys: the list is replaced wholesale per reading, and a name may not be a key.
            <li key={index} className="context-breakdown__row context-breakdown__row--category">
              <BreakdownRow name={category.name} tokens={category.tokens} />
              <span className="context-breakdown__bar" aria-hidden="true">
                <span
                  className="context-breakdown__bar-fill"
                  style={{ width: `${contextBarPercent(category.tokens, reading.maxTokens)}%` }}
                />
              </span>
            </li>
          ))}
          <MoreLine dropped={reading.droppedCategories} />
        </ul>
      )}
      {showMcp && (
        <details className="context-breakdown__group">
          <summary className="context-breakdown__summary">MCP tools</summary>
          <ul className="context-breakdown__list">
            {servers.map(([server, tools], serverIndex) => (
              <li key={serverIndex} className="context-breakdown__server">
                <span className="context-breakdown__server-name">{server}</span>
                <ul className="context-breakdown__list">
                  {tools.map((tool, index) => (
                    <li key={index} className="context-breakdown__row">
                      <BreakdownRow name={tool.name} tokens={tool.tokens} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            <MoreLine dropped={reading.droppedMcpTools} />
          </ul>
        </details>
      )}
      {showMemory && (
        <details className="context-breakdown__group">
          <summary className="context-breakdown__summary">Memory files</summary>
          <ul className="context-breakdown__list">
            {reading.memoryFiles.map((file, index) => (
              <li key={index} className="context-breakdown__row">
                <BreakdownRow name={shortenPath(file.path)} tokens={file.tokens} />
              </li>
            ))}
            <MoreLine dropped={reading.droppedMemoryFiles} />
          </ul>
        </details>
      )}
    </>
  )
}

/**
 * The pure view: the held reading in, markup out. `null` is "no reading held for this conversation" and
 * shows only the pending line. Groups are native `<details>`, closed by default, so collapsing needs no
 * state and renders statically.
 */
export function ContextBreakdownPanel({
  reading
}: {
  reading: ReportedContextReading | null
}): JSX.Element {
  return (
    <div
      className="composer-options context-breakdown"
      role="dialog"
      aria-label={CONTEXT_BREAKDOWN_LABEL}
    >
      {reading === null ? (
        <p className="context-breakdown__pending">{CONTEXT_BREAKDOWN_PENDING}</p>
      ) : (
        <ReadingBreakdown reading={reading} />
      )}
    </div>
  )
}

/**
 * The interaction container: `children` (the footer reading) becomes the trigger. ComposerOptionsMenu's
 * lifecycle, minus rows to rove: every close routes through close(), which returns focus to the trigger.
 * An outside click also closes, and the browser then moves focus to what was clicked — the shared
 * menu's contract, which does not steal focus back from the element the user chose.
 *
 * Its own anchor class rather than `.composer-options-anchor`: that one wears min-width: 0, and the
 * reading is the footer control that never gives width (#1107). No edge clamp: the panel is aligned to
 * the footer row's left edge in CSS (see `.context-breakdown`), so there is nothing to measure.
 */
export function ContextBreakdownPopover({
  reading,
  children
}: {
  reading: ReportedContextReading | null
  children: ReactNode
}): JSX.Element {
  // Component-local, so the popover resets to closed on remount (ADR 0006).
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const toggle = (): void => {
    if (open) close()
    else setOpen(true)
  }

  // Escape from the trigger or from anywhere inside the panel — both are inside the anchor.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    close()
  }

  // Outside click: ComposerOptionsMenu's listener verbatim, attached only while open.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: DocumentEventMap['mousedown']): void => {
      const target = event.target
      if (target instanceof Node && anchorRef.current && !anchorRef.current.contains(target)) {
        close()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open])

  return (
    <div ref={anchorRef} className="context-breakdown-anchor" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="composer__context-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        {children}
      </button>
      {open && <ContextBreakdownPanel reading={reading} />}
    </div>
  )
}
