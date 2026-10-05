// #1604: the conversation's Top overlay (Figma 132:4171, frame "Top overlay"; the pill is 347:6617) — a
// right-aligned stack of pills pinned to the top of the message area while the timeline scrolls beneath
// it. Shared with mobile. Occupants: usage, permission resolution, then pairing-error Re-pair.
//
// A PURE VIEW: the markup is a function of the reading, the instant, the dismissed triple, resolution
// kind and repair flag, which is what lets every arm be a static render in this repo's node-environment specs. The
// store-bound container is `TopOverlayControl` in ConversationScreen.tsx.
//
// NO DAEMON-AUTHORED STRING REACHES THIS DOM. The usage text is `usageLimitNotice`'s, composed from
// client-owned constants; the pill's class is picked by an EXPLICIT two-way conditional over its
// client-owned `variant` (never a template — the `ComposerUsageLimitNotice` ruling this view inherits);
// the X's accessible name and the Re-pair copy are client constants.
//
// NO LIVE REGION, on the status-row chip's ruling: #279's banner already announces connection changes,
// and the usage reading is not a place to queue announcements.
import type { ModalResolution } from '../../store/modalPrompts'
import type { UsageLimitReading } from '../../store/usageLimitStore'
import { isUsageReadingDismissed, usageLimitNotice } from './usageLimitNotice'
import { COMPOSER_REPAIR_BUTTON_COPY } from './composerSend'

/** The X's accessible name — client-owned, since the glyph itself says nothing to a screen reader. */
export const USAGE_PILL_DISMISS_LABEL = 'Dismiss usage notice'

export function TopOverlay({
  reading,
  nowSeconds,
  dismissed,
  repair,
  onDismissUsage,
  onRepair,
  resolution,
  onDismissResolution,
  sessionError
}: {
  sessionError?: string
  resolution: ModalResolution['kind'] | null
  onDismissResolution: () => void
  reading: UsageLimitReading | null
  nowSeconds: number
  dismissed: UsageLimitReading | null
  repair: boolean
  onDismissUsage: (reading: UsageLimitReading) => void
  onRepair: () => void
}): JSX.Element | null {
  const usage = reading === null || isUsageReadingDismissed(reading, dismissed) ? null : reading
  // No pills, no element: the overlay takes no space and leaves nothing in the tree.
  if (usage === null && resolution === null && sessionError === undefined && !repair) return null
  const notice = usage === null ? null : usageLimitNotice(usage, nowSeconds)
  return (
    <div className="conversation__top-overlay">
      {usage !== null && notice !== null && (
        <div
          className={
            notice.variant === 'default'
              ? 'top-overlay-pill top-overlay-pill--default'
              : 'top-overlay-pill top-overlay-pill--error'
          }
        >
          <span className="top-overlay-pill__text">{notice.text}</span>
          {notice.variant === 'default' && (
            <button
              type="button"
              className="top-overlay-pill__dismiss"
              aria-label={USAGE_PILL_DISMISS_LABEL}
              onClick={() => onDismissUsage(usage)}
            >
              {/* The Figma X (8x8), inked by `currentColor` so the pill's token colour carries it. */}
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M.294.294a1 1 0 0 1 1.413 0L4 2.587 6.293.294a1 1 0 1 1 1.413 1.413L5.413 4l2.293 2.293a1 1 0 1 1-1.413 1.413L4 5.413 1.707 7.706A1 1 0 0 1 .294 6.293L2.587 4 .294 1.707a1 1 0 0 1 0-1.413Z"
                />
              </svg>
            </button>
          )}
        </div>
      )}
      {resolution !== null && (
        <div className="top-overlay-pill top-overlay-pill--default">
          <span className="top-overlay-pill__text">
            {resolution === 'remote' ? 'Resolved on another device' : 'Request timed out'}
          </span>
          <button
            type="button"
            className="top-overlay-pill__dismiss"
            aria-label="Dismiss permission resolution notice"
            onClick={onDismissResolution}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M.294.294a1 1 0 0 1 1.413 0L4 2.587 6.293.294a1 1 0 1 1 1.413 1.413L5.413 4l2.293 2.293a1 1 0 1 1-1.413 1.413L4 5.413 1.707 7.706A1 1 0 0 1 .294 6.293L2.587 4 .294 1.707a1 1 0 0 1 0-1.413Z"
              />
            </svg>
          </button>
        </div>
      )}
      {sessionError !== undefined && (
        <div className="top-overlay-pill top-overlay-pill--error">
          <span className="top-overlay-pill__text">
            {sessionError === 'session.blocked'
              ? 'Claude did not pick up your last message. It was not delivered.'
              : sessionError === 'session.child_crashing'
                ? 'Claude keeps failing to start. Your message is waiting.'
                : 'Claude stopped responding.'}
          </span>
        </div>
      )}
      {repair && (
        <button type="button" className="top-overlay-pill top-overlay-pill--error" onClick={onRepair}>
          {COMPOSER_REPAIR_BUTTON_COPY}
        </button>
      )}
    </div>
  )
}
