import type { ElectronApplication, Page } from '@playwright/test'

// Test-runner lifecycle only. The normal app never imports this module.
export const clientAppLifecycle: {
  opened?: (app: ElectronApplication, page: Page) => Promise<void>
  closing?: (app: ElectronApplication, completed: boolean) => Promise<void>
} = {}
