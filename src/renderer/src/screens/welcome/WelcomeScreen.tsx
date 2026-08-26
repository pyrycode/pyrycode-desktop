import { PyryMark } from '../../theme/PyryMark'
import './welcome.css'

// The desktop welcome screen (Figma node 103-744): what the app is, plus a clear next step, so a
// first run does not open straight onto a paste-your-pairing-code form with no context. Unlike every
// other screen so far this is desktop's OWN frame (1280x1024, a horizontal hero) rather than the
// mobile frame stretched to the window; mobile's vertical counterpart is WelcomeScreen.kt, and the
// copy, the mark, and the two CTAs are inherited from it.
//
// The screen shipped DORMANT in #657 — nothing mounted it. #662 made it the unpaired app root, so the
// pair CTA now navigates; the prop stays optional (the PairingScreen.tsx:163 seam posture) because
// WelcomeView's dormant-state test renders it without one, and AppView supplies it at the mount site.
//
// WelcomeView is pure (props in, markup out — what the tests render); WelcomeScreen is the thin
// container, a passthrough today, so #662 had a container to mount and the split is already in place
// when a container concern arrives. It deliberately touches no bridge and no store — unlike
// PairingScreen (`bridge ?? window.pyry`, :175) it never dereferences `window`, which is what makes
// rendering it with no Electron bridge present trivially safe rather than stub-dependent.

/**
 * Client-owned copy — module-level constants (the ARCHIVE_COPY / SETTINGS_COPY idiom). No daemon
 * string, no store value, and no interpolation reaches this screen: every value rendered here is one
 * of these constants, which is the structural reason the screen has no escaping or injection surface
 * at all (the sibling ArchiveScreen.tsx:12-16 has to argue the opposite case).
 *
 * `subtitle` DIVERGES FROM THE FRAME ON PURPOSE. Figma node 103-754 reads "Control Claude multiple
 * Claude server instances." — a repeated word, re-verified 2026-08-21. The de-duplicated line below is
 * what the ticket specifies; a later "match the frame" pass should read this as intentional, not drift.
 * The footer separator is U+00B7 MIDDLE DOT, not a hyphen or a bullet.
 */
const WELCOME_COPY = {
  title: 'Pyrycode',
  subtitle: 'Control multiple Claude server instances.',
  body: 'Pyrycode runs Claude on your computer or home server. Channels and conversation history live on your machine, accessible from any device.',
  pairCta: 'I already have pyrycode',
  setupCta: 'Set up pyrycode first',
  footer: 'Open source · github.com/pyrycode/pyrycode-desktop'
} as const

/**
 * The setup landing page, mobile's `private const val SetupUrl`. A non-interpolated module constant —
 * never a prop, never a template literal — so the value handed to the window-open path is fixed at
 * compile time. The scheme allowlist at the sink (src/main/index.ts:63) is the independent second
 * layer, and it denies the in-app window on every path. The URL currently redirects to the repo
 * README; a real landing page is a future, unticketed change, so that is expected, not a defect.
 */
const SETUP_URL = 'https://pyryco.de/setup'

export interface WelcomeViewProps {
  onPair?: () => void // the navigation seam — PairingScreen.tsx:163's posture (#662 supplies it)
}

/** Pure presentational component — no hooks, no state, no effects, no async work. */
export function WelcomeView({ onPair }: WelcomeViewProps = {}): JSX.Element {
  return (
    <div className="welcome">
      <div className="welcome__hero-area">
        <div className="welcome__hero">
          <PyryMark className="welcome__mark" width={184} height={208} />
          <div className="welcome__copy">
            <div className="welcome__title-group">
              <h1 className="welcome__title">{WELCOME_COPY.title}</h1>
              <p className="welcome__subtitle">{WELCOME_COPY.subtitle}</p>
            </div>
            <p className="welcome__body">{WELCOME_COPY.body}</p>
          </div>
        </div>
      </div>
      <div className="welcome__ctas">
        <button type="button" className="welcome__pair" onClick={() => onPair?.()}>
          <QrFrameIcon />
          <span className="welcome__pair-label">{WELCOME_COPY.pairCta}</span>
        </button>
        {/*
          An anchor with target="_blank", NOT a button calling an opener. `target="_blank"` IS THE CLICK
          MECHANISM (the AssistantMarkdown.tsx:163-171 path this app already ships): it makes the click a
          window-open request, which setWindowOpenHandler (src/main/index.ts:56) answers by handing the
          URL to shell.openExternal and returning `deny` on every path — so "never in the app window" is
          guaranteed by the sink rather than by this screen's care. A plain anchor would instead be a
          same-document navigation that will-navigate (:79) cancels, so the link would look right and do
          nothing. `rel="noreferrer"` makes the anchor correct in isolation: the handler never constructs
          the child window, so there is no opener relationship to sever, and it is belt to that suspender.
        */}
        <a className="welcome__setup" href={SETUP_URL} target="_blank" rel="noreferrer">
          {WELCOME_COPY.setupCta}
        </a>
        {/* A <p>, never an <a> — mobile renders this as a plain Text with no uriHandler and the Figma
            node is a plain paragraph at reduced opacity. A link here would be a second, unspecified
            external-open surface. */}
        <p className="welcome__footer">{WELCOME_COPY.footer}</p>
      </div>
    </div>
  )
}

/**
 * The QR-frame icon on the primary CTA (Figma 103:758) — four corner brackets and a centre scan line.
 * Inherited from mobile, where that CTA opens a camera scanner; desktop pairing is a paste-a-code form,
 * but the ticket pins the icon as drawn. Stroked, not filled, so `stroke="currentColor"` tracks the
 * label beside it via .welcome__pair-icon's colour. aria-hidden — the label carries the meaning.
 */
const QR_FRAME_PATHS: readonly string[] = [
  'M2.5 5.83333V4.16667C2.5 3.72464 2.67559 3.30072 2.98816 2.98816C3.30072 2.67559 3.72464 2.5 4.16667 2.5H5.83333',
  'M17.5 5.83333V4.16667C17.5 3.72464 17.3244 3.30072 17.0118 2.98816C16.6993 2.67559 16.2754 2.5 15.8333 2.5H14.1667',
  'M2.5 14.1667V15.8333C2.5 16.2754 2.67559 16.6993 2.98816 17.0118C3.30072 17.3244 3.72464 17.5 4.16667 17.5H5.83333',
  'M17.5 14.1667V15.8333C17.5 16.2754 17.3244 16.6993 17.0118 17.0118C16.6993 17.3244 16.2754 17.5 15.8333 17.5H14.1667',
  'M6.66667 10H13.3333'
]

function QrFrameIcon(): JSX.Element {
  return (
    <svg
      className="welcome__pair-icon"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      aria-hidden="true"
    >
      {QR_FRAME_PATHS.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeWidth="1.66667"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

/**
 * Thin container — a passthrough today. It exists so #662 had a container to mount and so the
 * view/container split is already in place when a container concern arrives. No hooks, no store read,
 * no `window.pyry` dereference: keeping it bridge-free is what makes rendering it with no Electron
 * bridge present impossible to fail.
 */
export function WelcomeScreen({ onPair }: WelcomeViewProps = {}): JSX.Element {
  return <WelcomeView onPair={onPair} />
}
