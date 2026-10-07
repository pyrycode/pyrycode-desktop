import { mkdir } from 'node:fs/promises'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { configureComposerWindow } from './fixtures/composerWindowSetup'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ModelListPayload, SessionSettingsPayload } from '../src/shared/wire/types'

const model = {
  value: 'hover-model', display_name: 'Hover model', resolved_model: 'hover-model',
  effort_levels: ['low'], supports_auto_mode: true, truncated_fields: null
}

for (const width of [1280, 800]) {
  test(`footer hover layers preserve geometry and keyboard focus at ${width}`, async ({ launchPairedApp }) => {
    const { page, app, daemon } = await launchPairedApp({
      buildReplyFrames: inbound => {
        const request = decodeEnvelope(inbound)
        if (request.type === 'list_conversations') return [seedConversationsFrame()]
        if (request.type !== 'request_session_settings') return []
        return [encodeEnvelope({
          id: 1, type: 'session_settings', ts: '2026-10-07T12:00:00.000Z', in_reply_to: request.id,
          payload: {
            session_id: 'hover-session', model: model.value, effort: 'low', effective_effort: 'low',
            yolo: false, permission_mode: 'default', used_tokens: 50_000, window_tokens: 200_000
          } satisfies SessionSettingsPayload
        })]
      }
    })
    daemon.pushFrame(encodeEnvelope({
      id: 2, type: 'model_list', ts: '2026-10-07T12:00:00.000Z',
      payload: { conversation_id: SEEDED_ROW.id, models: [model], dropped_models: 0 } satisfies ModelListPayload
    }))
    const footer = page.locator('.composer__footer')
    const buttons = footer.locator('button.composer__footer-button')
    await expect(buttons).toHaveCount(5)
    await configureComposerWindow(app, { width, height: width === 800 ? 600 : 800 }, 1)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    await mkdir('/tmp/builder-1863', { recursive: true })

    const geometry = () => footer.evaluate(el => [el, ...el.querySelectorAll('*')].map(node => {
      const rect = node.getBoundingClientRect()
      return [rect.x, rect.y, rect.width, rect.height]
    }))
    const hoverColour = await footer.evaluate(el => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--color-state-hover)'
      el.append(probe)
      const colour = getComputedStyle(probe).backgroundColor
      probe.remove()
      return colour
    })
    for (let index = 0; index < 5; index++) {
      const button = buttons.nth(index)
      const layerOwner = index === 4 ? button : button.locator('..')
      const layer = () => layerOwner.evaluate(el => {
        const style = getComputedStyle(el, '::before')
        return {
          content: style.content, colour: style.backgroundColor, radius: style.borderRadius,
          insets: [style.top, style.right, style.bottom, style.left], pointerEvents: style.pointerEvents,
          position: style.position, zIndex: style.zIndex
        }
      })
      await page.mouse.move(0, 0)
      const before = await geometry()
      await button.hover()
      expect(await layer()).toEqual({
        content: '""', colour: hoverColour, radius: '6px',
        insets: index === 4 ? ['-4px', '-4px', '-4px', '-4px'] : ['-4px', '-6px', '-4px', '-6px'],
        pointerEvents: 'none', position: 'absolute', zIndex: '-1'
      })
      expect(await layerOwner.evaluate(el => getComputedStyle(el).isolation)).toBe('isolate')
      expect(await geometry()).toEqual(before)
      if (index < 4) expect(await button.evaluate(el => getComputedStyle(el).overflow)).toBe('hidden')
      await page.screenshot({ path: `/tmp/builder-1863/hover-${width}-${index}.png` })
      await page.mouse.move(0, 0)
      expect((await layer()).content).toBe('none')

      // Establish keyboard modality, then compare its outline before/during/after hover.
      await button.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(button).toBeFocused()
      const focus = () => button.evaluate(el => {
        const style = getComputedStyle(el)
        return { visible: el.matches(':focus-visible'), outline: style.outline, offset: style.outlineOffset }
      })
      const keyboard = await focus()
      expect(keyboard.visible).toBe(true)
      expect(keyboard.outline).not.toContain('none')
      await button.hover()
      expect(await focus()).toEqual(keyboard)
      await page.mouse.move(0, 0)
      expect(await focus()).toEqual(keyboard)
      expect((await layer()).content).toBe('none')
      await page.screenshot({ path: `/tmp/builder-1863/focus-${width}-${index}.png` })
    }
    // A missing model list makes model/effort inert spans, with no clickable hover treatment.
    daemon.pushFrame(encodeEnvelope({
      id: 3, type: 'model_list', ts: '2026-10-07T12:00:00.000Z',
      payload: { conversation_id: SEEDED_ROW.id, models: [], dropped_models: 0 } satisfies ModelListPayload
    }))
    await expect(buttons).toHaveCount(3)
    for (const label of await footer.locator('span.composer__footer-button').all()) {
      await label.hover()
      expect(await label.evaluate(el => getComputedStyle(el.parentElement!, '::before').content)).toBe('none')
    }
  })
}
