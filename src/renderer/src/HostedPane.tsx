import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { HostedPaneState } from '@shared/ipc/hostedPane'

export const hostedPaneStore = createStore<{ state: HostedPaneState }>(() => ({ state: { type: 'closed', generation: 0 } }))
const copy = { loading: 'Loading app…', ready: 'Connected', disconnected: 'Disconnected',
  unsupported: 'Hosted apps are unsupported', unavailable: 'App unavailable' }
export function HostedPane(): JSX.Element | null {
  const state = useStore(hostedPaneStore, s => s.state)
  const surface = useRef<HTMLDivElement>(null)
  const generation = state.generation
  useEffect(() => {
    const element = surface.current
    if (!element) return
    let previous = ''
    const measure = (): void => {
      const r = element.getBoundingClientRect(), x = Math.max(0, Math.ceil(r.x)), y = Math.max(0, Math.ceil(r.y))
      const bounds = { x, y, width: Math.max(0, Math.floor(Math.min(r.right, innerWidth)) - x),
        height: Math.max(0, Math.floor(Math.min(r.bottom, innerHeight)) - y) }
      const visible = document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]') === null
      const command = { type: 'layout' as const, generation, visible, bounds }, key = JSON.stringify(command)
      if (previous !== key) { previous = key; void window.pyry.hostedPane(command) } // Typed refusals are inert.
    }
    const resize = new ResizeObserver(measure), mutations = new MutationObserver(measure)
    resize.observe(element); mutations.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['open', 'role', 'aria-modal'] })
    window.addEventListener('resize', measure); measure()
    return () => { resize.disconnect(); mutations.disconnect(); window.removeEventListener('resize', measure) }
  }, [generation])
  if (state.type === 'closed') return null
  return <section className="hosted-pane">
    <header className="hosted-pane__chrome">
      <div className="hosted-pane__identity"><span>{state.hostLabel}</span><strong>{state.appLabel}</strong></div>
      <span role="status">{copy[state.type]}</span>
      {state.type !== 'ready' && state.type !== 'loading' && <button type="button"
        onClick={() => { void window.pyry.hostedPane({ type: 'reopen', generation }) }}>Reopen app</button>}
      <button type="button" onClick={() => { void window.pyry.hostedPane({ type: 'close', generation }) }}>Close app</button>
    </header>
    <div ref={surface} className="hosted-pane__surface" />
  </section>
}
