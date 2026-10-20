import { expect } from '@playwright/test'

// Kept separate from the full protected reader so tests can model expensive read admission.
export async function readCertifiedCheckpoint(
  acknowledged: () => Promise<boolean | symbol>,
  read: () => Promise<number | null>
): Promise<number | null> {
  await expect.poll(acknowledged).toBe(true)
  return read()
}
