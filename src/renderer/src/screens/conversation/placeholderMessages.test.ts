import { describe, it, expect } from 'vitest'
import { placeholderMessages } from './placeholderMessages'

describe('placeholderMessages', () => {
  it('holds enough messages to overflow a normal window height', () => {
    expect(placeholderMessages.length).toBeGreaterThanOrEqual(6)
  })

  it('covers both the user and daemon roles', () => {
    expect(placeholderMessages.some((m) => m.type === 'user')).toBe(true)
    expect(placeholderMessages.some((m) => m.type === 'daemon')).toBe(true)
  })

  it('gives every message a unique id', () => {
    const ids = placeholderMessages.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
