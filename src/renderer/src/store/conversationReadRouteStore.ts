import { createStore } from 'zustand/vanilla'

/** Explicit supplied route selection; production capability wiring belongs to #1908. */
export const conversationReadRouteStore = createStore<{
  hosts: ReadonlyMap<string, ReadonlyMap<string, string>>
  epochFor: (host: string | null | undefined, id: string) => string | undefined
  select: (host: string, id: string, epoch: string | null) => void
}>((set, get) => ({
  hosts: new Map(),
  epochFor: (host, id) => typeof host === 'string' ? get().hosts.get(host)?.get(id) : undefined,
  select(host, id, epoch) {
    const hosts = new Map(get().hosts), chats = new Map(hosts.get(host))
    if (epoch === null) chats.delete(id); else chats.set(id, epoch)
    if (chats.size) hosts.set(host, chats); else hosts.delete(host)
    set({ hosts })
  }
}))
