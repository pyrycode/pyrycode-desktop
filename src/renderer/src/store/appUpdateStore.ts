import { createStore } from 'zustand/vanilla'
import type { AppUpdateState } from '@shared/ipc/appUpdate'
export const appUpdateStore = createStore<AppUpdateState>(() => ({ type: 'idle' }))
