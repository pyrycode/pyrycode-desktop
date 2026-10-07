# Pairing input screen

The user pastes the payload printed by `pyry pair --print`, reviews the server-key
fingerprint derived by main, and explicitly confirms before saving. Onboarding keeps
the full-page `EntryPage` and existing `ReviewCard`. Inside the paired app, added-host
pairing and manual repair use a two-step **Pair** modal over the invoking view.
Both presentations share the same reducer and confirmation/storage path; see
[paired-shell routing](paired-shell-routing.md#the-pure-view--container-pairedshelltsx).

Introduced in [#55](../codebase/55.md); the paste phase restyled onto its own frame in [#665](../codebase/665.md). Lives entirely under `src/renderer/src/screens/pairing/` — it never touches the token, server key, socket, or Noise handshake; those stay in the background process (ADR [0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "keep the transport out of the window"). It drives the existing [pairing IPC channel](pairing-ipc-channel.md) (#54) and holds the paste string, the optional host label (#825, below), and the fingerprint/reason it gets back.

## What it does

Gives a fresh-install user a terminal-free way to pair the app with their daemon:

1. **Paste** the `pyry pair --print` payload into the field.
2. **Submit** — the pasted payload crosses the bridge to main, which parses it, validates the relay against the allowlist, and derives the server-key fingerprint; the screen displays the **fingerprint** for review.
3. **Review** — the user compares the displayed fingerprint byte-for-byte against what `pyry pair` printed / what the phone shows.
4. **Confirm** — explicit confirmation persists the pairing in main via `safeStorage`. Cancel before saving discards the paste.
5. **Verify connection** — wait up to 30 seconds for fresh authentication of the saved host. Only authentication completes pairing; post-save Cancel retains the saved host.

A typed validation error (malformed payload, disallowed relay, malformed key, expired pending, or persist failure) is surfaced **inline** and nothing is stored. The screen never receives or renders the `token` or `server_static_pubkey` — only the fingerprint (a hash), main-retained saved `serverId` and value-free error categories cross back over the bridge.

**Where the screen mounts:** `App` uses the default page presentation for onboarding;
Cancel returns to [Welcome](welcome-screen.md), and success enters the paired shell.
`PairedShell` passes `presentation="modal"` for sidebar **Pair new host**, Settings
**Pair another server**, and explicit host-row/composer repair. Cancellation before saving or during post-save verification
returns to the invoking view with its selected conversation, draft and held history
preserved. Saving refreshes saved hosts; authenticated completion returns to the host list. Connection
failure alone never opens pairing.

## How it works

The screen decomposes into a **pure, React-free core** (`pairingState.ts`) and a **thin React container + pure view** (`PairingScreen.tsx`) — the tested-choke-point / untested-wiring split the codebase uses for [session store](session-store.md) vs [daemon-event bridge](daemon-event-bridge.md).

### Module structure

```
src/renderer/src/screens/pairing/
├── pairingState.ts        # phase machine + effect-runners + formatter (pure, React-free)
├── pairingState.test.ts   # reducer + runners + formatter tests (node env, no DOM)
├── PairingScreen.tsx       # PairingView (pure) + EntryPage/ReviewCard + PairingScreen (container)
├── PairingScreen.test.tsx  # renderToStaticMarkup per-phase render tests
└── pairing.css             # card + field + buttons + fingerprint, all token-based
```

### Phase machine (`pairingState.ts`)

State and events are discriminated unions on a discriminant field (`phase` / `type`), per CLAUDE.md's sealed-shape convention.

```ts
type PairingState =
  | { phase: 'editing';    paste: string; label?: string; error: PairingErrorReason | null }
  | { phase: 'submitting'; paste: string; label?: string }
  | { phase: 'reviewing';  paste: string; label?: string; fingerprint: string }
  | { phase: 'confirming'; paste: string; label?: string; fingerprint: string }
  | { phase: 'verifying'; serverId: string }
  | { phase: 'verification-failed'; serverId: string; reason: VerificationFailure }
  | { phase: 'paired' }
```

`paste` is threaded through `editing → submitting → reviewing → confirming` so a confirm failure can return to `editing` with the paste intact for fresh submission and verification. It embeds the token, so it is the **only** field that transitively holds a secret — it never leaves this module except via the single `submitPairingPaste` call. `error` lives only on `editing`; post-save failure uses a separate classified `reason`; `fingerprint` only on `reviewing`/`confirming`. `verifying` and `verification-failed` discard the paste, label and fingerprint, holding only the saved identity and, on failure, its category. `paired` is terminal and carries **nothing** — no secret, no record.

`label` (#825) rides the same four phases as `paste`, for the same structural reason: it is typed on the paste phase but sent two phases later, on confirm, so it can't live in a component-local `useState` without splitting AC4 ("cancel discards the label with the paste") across two mechanisms. It is **optional**, not `label: string` defaulting to `''` — it mirrors `PairingRequest`'s own `label?: string` exactly, so state and the wire contract agree that "no label" is an absent key. This keeps the change zero-cascade (every existing `PairingState` literal in both test files still typechecks, and `toEqual` ignores an absent property), and it is safe because exactly one place — `hostLabelToSend`, below — decides whether a label exists at all. `label` is **not** a secret — it is the operator's display name for the host, bound for the [host-label store](host-label-store.md) — but like `paste` it survives `submit-failed`/`confirm-failed` so a retry doesn't make the operator retype it, and dies with the paste on `cancel` via `initialPairingState`.

`pairingReducer(state, event)` is a pure `switch (event.type)` with an `assertNever` exhaustiveness guard (same shape as `reduceSession`). Each arm guards on the current `phase` and returns `state` unchanged for an out-of-phase event (a stray event is a safe no-op).

| Current phase | Event | → Next state |
|---|---|---|
| `editing` | `paste-changed{paste}` | `editing{paste, label, error: null}` (typing the code clears the prior error; label carried forward) |
| `editing` | `label-changed{label}` | `editing{paste, label, error}` (label set verbatim — **not** trimmed here, and **not** clearing `error`; see below) |
| `editing` | `submit` | `submitting{paste, label}` |
| `submitting` | `submit-succeeded{fingerprint}` | `reviewing{paste, label, fingerprint}` |
| `submitting` | `submit-failed{reason}` | `editing{paste, label, error: reason}` (paste and label preserved) |
| `reviewing` | `confirm` | `confirming{paste, label, fingerprint}` |
| `confirming` | `confirm-succeeded{serverId}` | `verifying{serverId}` |
| `verifying` | `authenticated` | `paired` |
| `verifying` | `verification-failed{reason}` | `verification-failed{serverId, reason}` |
| `verification-failed` with `timeout` / `daemon-absent` | `retry` | `verifying{serverId}` |
| `confirming` | `confirm-failed{reason}` | `editing{paste, label, error: reason}` (paste and label preserved) |
| any | `cancel` | `initialPairingState` (paste **and label discarded**) |
| any other (phase, event) | — | `state` unchanged |

**`label-changed` is handled only in `editing`** (a stray event elsewhere, e.g. mid-submit, is a no-op) **and deliberately does not clear `error`**, unlike `paste-changed`: editing the pairing code invalidates the complaint about that code, but typing a host name says nothing about it, and wiping the operator's only feedback on an unrelated keystroke would be a regression. The stored value is the raw typed text, never trimmed on the way in — trimming per keystroke would fight the controlled input, since the trimmed value round-trips straight back into `value` and a trailing space could never be typed. Normalisation happens once, at the confirm boundary, below.

**Why `confirm-failed → editing`, not `→ reviewing`:** the main handler consumes its pending record *before* awaiting the persist (#54, consume-before-await). After any confirm failure the pending record is already gone, so a retry must be a **fresh submit** (which re-prepares a new pending record on main). Returning to `editing` with the paste preserved makes that a single Pair click; routing to `reviewing` would offer a Confirm structurally guaranteed to fail with `no-pending-pairing`.

### Host name field (#825)

The onboarding paste phase (`EntryPage`) draws a second M3 filled field below the pairing-code field's
supporting-text slot — the operator's display name for the host they are pairing with, so they are
not hunting for a settings screen afterwards to name the machine. It reuses the same
`.pairing-field*` CSS block the code field uses (two new declarations in `pairing.css`: a
`margin-top` separating the two field groups, and a `padding-right` this field needs but the code
field doesn't, since the code field's right inset comes from its 48px clear-button slot). It writes
through the [pairing IPC channel](pairing-ipc-channel.md)'s existing `confirm` request
(`PairingRequest`'s optional `label`, shipped by #823) to the [host-label store](host-label-store.md)
(#822); #824 shipped the read path back. This ticket is the one place left in that chain the
operator can actually type into — renderer-only, no `src/main/` or `src/preload/` change.

**The Figma frame (`103-2901`) draws no such field** — it has exactly one text-field instance,
re-verified against the file on 2026-08-27. The treatment here is provisional, derived from the code
field above (the only in-repo reference for a field on this screen) until an updated frame ships;
the label copy, field order, and the `(optional)` affordance are the three things most likely to
move when it does.

Two structural omissions from the code field, both intentional:

- **No clear control.** A few hundred base64url characters aren't select-and-delete-able but a short
  name is; a second control here would also mean a second accessible name to keep clear of the
  `exact: true` matchers on `Pair`/`Clear pairing code`.
- **No supporting-text line of its own.** The M3 supporting slot in this hero belongs to the code
  field and its two keyed branches are untouched; `(optional)` baked into the field's name is the
  field's only affordance that it may be skipped. The Pair button's enabled condition
  (`busy || paste.trim() === ''`) stays exactly as it was — the label never gates pairing.

**Onboarding attributes, all load-bearing:** `type="text"` (never `password` — the name isn't a secret);
`aria-label="Host name (optional)"`, matching the visible `aria-hidden` span text (label-in-name),
chosen to contain neither the substring `aria-label="Pairing code"` nor the exact names `Pair` /
`Clear pairing code`, so it joins none of the six outside consumers' match sets that
[#664](../codebase/664.md) swept onto the raw `aria-label` attribute; `maxLength={MAX_HOST_LABEL_LENGTH}`,
**imported** from `@shared/ipc/pairing` and never restated as a literal, since a field bound
disagreeing with the IPC guard's write bound would let a value pass one boundary and fail the
other; `autoComplete="off"` and `spellCheck={false}`, matching the code field's secret-hygiene
posture even though this field carries no secret, because the exposure this ticket introduces is
structural, not content-based (see below); and — like the code field — **no `name`, no `id`, no
`<form>` ancestor**. The onboarding inputs stay siblings under the hero div; the modal uses separate field wrappers.

**Secret hygiene, restated for a second field.** `PairingScreen.tsx`'s header names the risk placing
a second input beside a bearer-token field creates: a `<form>` ancestor, or a `name`/`id` on either
input, can make a password manager read the pair as a credential form and capture the pairing code.
Neither input carries any of the three; `PairingScreen.test.tsx` pins this with a regex over the
rendered `<input` tags (a bare `' name="'` substring match would have been a trap, since the
accessible name itself contains the word "name"). A mis-paste of the pairing payload into this field
instead is accepted as a residual risk, not defended against: `maxLength` truncates it, it is only
ever sent alongside a *successful* confirm (which requires the real payload in the code field too —
a double mistake), and the sink is AEAD-encrypted at rest and log-free by construction. See the
architecture spec's security review for the full ruling.

### Normalisation at the confirm boundary

`hostLabelToSend(label: string | undefined): string | undefined` is a **module-private** helper in
`pairingState.ts` (not exported — `runConfirm` is the tested seam): returns the label trimmed of
surrounding whitespace, or `undefined` when it is absent or trims to empty. Trimming can only
shorten a value, so one that already passed the field's `maxLength` cannot exceed the IPC guard's
bound. The empty-string collapse is load-bearing, not cosmetic: the preload omits the `label` key
entirely for `undefined` and includes it for everything else, and main saves whatever is present
verbatim (`''` included) — so without this collapse, clearing the field would store an empty name
rather than no name at all.

### Effect-runners + injected bridge

```ts
interface PairingBridge {
  submitPairingPaste(paste: string): Promise<PairingSubmitResponse>
  confirmPairing(label?: string): Promise<PairingConfirmResponse>
}

runSubmit(bridge, paste):        Promise<PairingEvent>   // ok → submit-succeeded{fingerprint}; !ok → submit-failed{reason}
runConfirm(bridge, label?):      Promise<PairingEvent>   // ok → confirm-succeeded{serverId};   !ok → confirm-failed{reason}
```

`confirmPairing` and `runConfirm` both widened by one optional argument in #825, backward-compatibly:
a zero-argument call site still typechecks, so no pre-#825 fake or call needed an edit. `runConfirm`
calls `bridge.confirmPairing(hostLabelToSend(label))` — passing an explicit `undefined` is
indistinguishable from passing nothing at the preload, which branches on `label === undefined` and
omits the key entirely (#823). Everything else about the total-function contract below is unchanged.

The two IPC calls are wrapped in pure async functions that map a typed response to the reducer event it produces — the tested seam that proves "submit invokes the IPC" and "confirm triggers persist" without a DOM. `PairingBridge` is the injected seam; **`window.pyry` is structurally assignable** to it (it has these two methods plus extras from #54), so the container defaults `bridge = window.pyry` and tests pass a `{ submitPairingPaste: vi.fn(), confirmPairing: vi.fn() }` fake. The preload methods resolve to a typed response for *every* domain outcome (they don't reject on a domain error) — that part maps outside any `try`.

**Both runners are total functions ([#513](../codebase/513.md)): they never reject.** A `try` wraps only the bridge call itself (not the response mapping), and a bare `catch {}` — binding nothing — coerces an infrastructure-level rejection (handler absent or already unregistered on `will-quit`, an invoke racing registration, a non-serializable reply) or a synchronous throw into the phase's failure event with reason `malformed-request`, the same reason the handler's own guard produces. This mirrors `runUnpair` (`unpairAction.ts:53-59`). The mapping (`response.ok ? … : …`) stays outside the `try`, so a malformed response object is still a thrown contract violation, not a swallowed "try again". Before #513 a rejected invoke dispatched nothing and the reducer wedged in `submitting`/`confirming` — recoverable only by restart, since `busy` disables Cancel too (see State + concurrency model below).

### Authentication observation

`createPairingVerification` subscribes to the session and relay stores **before**
`runConfirm` invokes the bridge, capturing the session status map as its baseline.
On the successful response, `saved(serverId)` starts a 30-second wait and immediately
inspects the current status. A connected status object must differ from that host's
baseline entry. This depends on the [session store](session-store.md)'s immutable
per-host status updates and main-stamped identity; `ack.server_id`, relay reachability,
another connected host and a pre-confirmation connected status cannot complete pairing.
Authentication already present when the save response is processed is therefore observed.
Saving identical credentials may leave a healthy connection unchanged; it still needs
fresh authentication. The observer adds no reconnect command.

The deadline starts when successful confirmation is received, or when Retry starts.
Every observation checks the absolute deadline before accepting authentication, as well
as scheduling a timeout: an overdue timer callback alone can let a late event win.
Disconnects and ordinary transport loss keep waiting within that bound.

| Outcome | Feedback and actions |
| --- | --- |
| `daemon-absent` or `timeout` | Temporary unavailability; Retry or Cancel |
| `pairing-rejected` | Explicit rejection; Cancel, then manually pair with a fresh code |
| `handshake-read-failed`, `malformed-hello-ack`, `transport-decrypt-failed`, or `auth.*` | Authentication failure; Cancel |

Failures remain visible even if the host subsequently connects. Retry observes the same
saved host for another 30 seconds through the existing reconnect loop; it never submits,
saves or generates credentials. It retains the original confirmation baseline, so a
connection established while failure feedback was visible can satisfy Retry immediately.
An already-held daemon-absence value is ignored on Retry until a non-absent link state
is observed, then a new absence can fail the wait; otherwise the deadline still applies.
All feedback and diagnostics use fixed client-owned categories, never daemon error text.

### Fingerprint formatter

The in-app modal bypasses grouping: it renders the complete returned value as one
escaped text node, with `white-space: pre-wrap` and `overflow-wrap: anywhere`.
The formatter below belongs to onboarding only.

`groupFingerprint(fingerprint)` splits the daemon's fixed 23-char form `aa:bb:cc:dd:ee:ff:11:22` (8 colon-separated lowercase-hex byte-pairs) into its 8 **verbatim** groups so the view can render them as spaced monospace segments. Decoration is **spatial only** — characters, case, and order are never altered (`groups.join(':')` equals the input), because the operator compares the string byte-for-byte against pyrybox/the phone. Grouping / decoration for display was handed forward from #53/#54 as this screen's concern.

### View + container (`PairingScreen.tsx`)

- **`PairingView`** — a presentation selector. The default page branch renders markup; `presentation="modal"` delegates to the private `PairingModal`, which owns dialog effects. The root always carries the `.pairing` class — every outside consumer of the screen (`e2e/smoke.spec.ts:81`) binds that one class and expects it present in every phase — plus `.pairing-modal` in-app or a phase-derived page treatment, `.pairing-page` or `.pairing-card`:

  ```ts
  const isPaste = state.phase === 'editing' || state.phase === 'submitting'
  // className={`pairing ${isPaste ? 'pairing-page' : 'pairing-card'}`}
  ```

  In the default page presentation, `editing`/`submitting` render `EntryPage` — the full-window paste page ([#665](../codebase/665.md)) described below. `reviewing`/`confirming` render `ReviewCard` (title, fingerprint block, caption, `[Cancel, Confirm]`) — still the 420px `.pairing-card` dialog inherited from mobile's `19-54`, unchanged since #55. `verifying`/`verification-failed` reuse the card for connection feedback and Cancel, plus Retry for temporary unavailability. `paired` renders a success marker. This is what `renderToStaticMarkup` renders in tests, one call per phase.

  **`EntryPage`** ([#665](../codebase/665.md)) is a full-window page drawn from desktop's own Figma frame `103-2901` — a radial glow over `--color-surface`, the welcome screen's `--space-7`/`--space-8` frame padding, and a bottom-pinned CTA stack. It replaced the `EntryCard` dialog #55 shipped (card `<h1>`, instruction paragraph, controlled `<textarea>`, inline error row) with:

  - an M3 **filled** text field: a persistent (non-floating) `Pairing code` label as an `aria-hidden` `<span>` above a single-line `<input aria-label="Pairing code">`, a 1px bottom active indicator, and a trailing **clear control** — a 40px round button, present only when the paste is non-empty, that writes a constant `''` through `onPasteChange` and returns focus to the input on click. No wrapping `<label>`: HTML forbids interactive content inside one (the clear button couldn't share the row), and a wrapping label would put a second element under the accessible name "Pairing code", which is exactly the ambiguity [#664](../codebase/664.md) had just removed for the six outside consumers that match the raw `aria-label` attribute.
  - a supporting-text slot below the field holding **either** the instruction (`Run pyry pair --print on your server and paste the output here.`) **or** the mapped error, never both — rendered as two `<p>` elements with **distinct `key`s** (`key="instruction"` / `key="error"`), not a single element whose `role` toggles. This is load-bearing, not stylistic: two same-tag JSX branches at the same position with no key reconcile to *one* DOM node in React, so an unkeyed version was mutating a live node's `role` to `alert` in the same commit that changed its text — an insert-vs-mutate distinction screen readers do not reliably announce. See [#665 codebase notes](../codebase/665.md) for the full reconciliation trace.
  - a three-row CTA stack: the `Pair` pill (full-width, disabled while `paste` is empty/whitespace or while `busy`, shows `Pairing…` in flight), a bare `Cancel` text row, and the `Open source · github.com/pyrycode/pyrycode-desktop` footer.

  No heading — the frame draws none, and the renderer has no visually-hidden utility to compensate with; the screen is left navigable by its named fields (since #825, two: the pairing code and the optional host name) and two named buttons.
- **`PairingScreen`** — the thin container: `const [state, dispatch] = useReducer(pairingReducer, initialPairingState)`, plus handlers that dispatch the intent then dispatch the awaited runner result. IPC calls are handler-driven; a lifecycle effect tracks whether the container remains mounted. `onConfirm` fires `onPaired?.()` on `confirm-succeeded`; `onCancel` fires `onCancel?.()`. `handleLabelChange` (#825) dispatches `label-changed`; `handleConfirm` captures `const label = state.label` before its `dispatch({ type: 'confirm' })` — the same before-the-await discipline `handleSubmit` uses for `paste` — and calls `runConfirm(target, label)`.

**Error-reason → inline copy** is a value-free `Record<PairingErrorReason, string>` in the view — the five coarse #54 categories mapped to fixed copy, no interpolation of any inbound value:

| reason | inline message |
|---|---|
| `invalid-paste` | "That doesn't look like a valid pairing code — check you copied the whole thing." |
| `invalid-key` | "The server key in that code is malformed." |
| `malformed-request` | "Something went wrong sending the code. Try again." — also the coerced reason for a rejected/throwing invoke ([#513](../codebase/513.md)); indistinguishable by design from the handler's own domain use of the same reason |
| `no-pending-pairing` | "The pairing expired — paste the code again." |
| `persist-failed` | "Couldn't save the pairing — your system keychain may be unavailable." |

### In-app modal presentation

`PairingModal` wraps the shared `Modal` panel in a native `dialog` opened with
`showModal()`. Modal owns the Pair title, header close control, divider and centered
Cancel/Pair footer. The caller owns the top layer, background inertness and keyboard
handling; Edit host and Edit workspace consumers are unchanged.

Entry has filled fields named exactly **Pairing code** and **Host name**. The name
remains optional despite dropping onboarding's `(optional)` label. Both inputs keep
`autoComplete="off"`, `spellCheck={false}`, no `name` or `id`, and no form ancestor;
the name retains `MAX_HOST_LABEL_LENGTH` and confirmation-time trimming. Blank or
whitespace code disables Pair. The first Pair validates without saving; errors use
fixed copy in a `role="alert"` inside the modal. The second Pair confirms and saves.
Storage failure returns to entry with both fields retained and requires another
submit and fingerprint verification, because main already consumed its pending record.

Verification exposes the full value in the named **Server key fingerprint** group,
in a highlighted area followed by “Verify that the code matches to ensure that you
are connected to the correct host.” Repair context and the target's rejection
explanation remain inside both steps.

Focus starts in the code field, moves to Pair on verification, and returns to the
code field after a storage failure. Post-save Retry stays on connection verification. Tab/Shift+Tab stay within enabled controls. Capture-phase Escape
handling prevents underlying document listeners from navigating. Cancel, header close
and Escape share cancellation before saving and during post-save pending/failure states; none dismiss during submit or confirm.
Cleanup removes the listener, closes the dialog and restores focus to the invoker
if it remains connected. Reopening mounts fresh local state.

The wrapper and panel both specify a preferred 640px width, bounded by viewport
margins; Modal supplies vertical scrolling for short windows. `width: max-content`
on the native wrapper made entry shrink despite the child's preferred width, so
panel geometry needs a browser assertion. The fingerprint uses surface-variant
colors and the display-small scale (36px/44px, emphasized weight 500).

### Styling

`pairing.css` keeps the in-app modal treatment separate from onboarding’s two existing treatments:

- **`.pairing-card`** — the reviewing/confirming/verifying/verification-failed/paired phases: the original Figma `19-54` card (`surface-container-high` background, `--radius-lg` corners, `--space-6` padding, `max-width: 420px`), byte-for-byte what `.pairing` carried before #665 split it out.
- **`.pairing-page`** — the paste phase: desktop's own frame `103-2901`. `height: 100%` (rides the `html`/`body`/`#root` chain both mount sites leave bare), `--space-7`/`--space-8` frame padding, and a radial glow **derived from this frame's own Figma matrix, not copied from `welcome.css`** — the two frames' glows are close but not identical (48%×61% here vs. welcome's 48%×56%, same centre, purely vertical delta). The `.pairing-field*` block is the M3 filled field: a `::before` pseudo carries the 72% translucent fill at `opacity` (never a bare `rgba()`/`color-mix()` literal, per the house rule), and the field's row needs `position: relative` because the absolutely-positioned fill would otherwise paint above its non-positioned siblings.

Both `.pairing` (the shared base — box model, colour, font) and the outside-bound contract described above stay constant across the split. Every color/type/spacing resolves to a `tokens.css` token; the file's header names the remaining bare-literal geometry explicitly (the 56/48/40/24px boxes, the 1px indicator, the glow percentages, the 0.72/0.55/0.38 opacities) — no new tokens were added for #665. The onboarding inline error still reuses `--color-tertiary` (the original choice; the modal uses `--color-error`). The `reuse` of the welcome frame is **token-level and visual only** — this codebase has no shared cross-screen CSS at all, so the page treatment is restated under its own class names rather than importing `welcome.css` or reaching for `.welcome__*`. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

The field's keyboard-focus indicator is an **outset** `box-shadow` on `:focus-within` (doubling the 1px border into a 2px line) rather than a colour change alone — a hue-only flip between `--color-on-surface-variant` and `--color-primary` measured at 1.00:1 luminance contrast, imperceptible in greyscale or under a blue-yellow deficiency ([#665 code review](../codebase/665.md) finding).

## State + concurrency model

- **Single source of screen state:** the `useReducer` state; the view is stateless (reads `state`, calls handler props — no two-way binding). See [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) for why this is `useReducer`, not a store.
- **One-shot IPC:** submit and confirm run from handlers. Effects track mount lifetime
  and, for the modal, install and clean up dialog keyboard/focus handling.
- **In-flight re-entrancy:** a synchronous `busyRef` guards submit, confirm and cancel
  before React renders disabled controls. Phase guards reject out-of-phase actions.
- **Separate persistence and navigation:** successful confirmation calls `loadServerInfo`
  even after unmount, independently of the completion callback. Only a live controller's
  `authenticated` event dispatches `paired` and calls `onPaired` once.
- **Controller lifetime:** Cancel, unmount and replacement dispose both subscriptions and
  the timer. The mounted flag and current-controller identity reject obsolete callbacks;
  the shell's [generation guard](paired-shell-routing.md#host-recovery-and-navigation-lifetime)
  separately fences navigation. Failure stops the active wait; authenticated completion
  disposes it. Late submit results are ignored.
- **Post-save cancellation:** Cancel remains enabled while waiting or showing failure.
  It discards local state without undoing persistence; modal close and Escape use the
  same path. Existing hosts, selected conversation, drafts and history remain intact.

## Security posture

- **No secret can reach the renderer — enforced by construction upstream (#54).** `PairingSubmitResponse` / `PairingConfirmResponse` have no `token` / `server_static_pubkey` / record field, so the screen has no code path that could obtain one. The only inbound values are `fingerprint` (a hash), main-retained `serverId` and `reason` (a value-free category).
- **The paste is the user's own input, handled as sensitive** because it embeds the token: transient reducer state only, single-use via one `submitPairingPaste` call, never logged / persisted / re-routed, cleared on `cancel` and successful persistence, before authentication. The inline error uses only the value-free `reason`.
- **The fingerprint compare is the trust anchor.** Display decoration is spatial only; never change case/order/characters or the human compare against pyrybox/the phone breaks.
- The screen adds **no new IPC channel and no new preload API** (both exist from #54); it calls only the two typed methods, never `ipcRenderer`. Fingerprint and error copy render as escaped React text nodes (no `dangerouslySetInnerHTML`).

## Edge cases and limitations

- **Empty / whitespace-only paste** — Pair is `disabled` (deterministic guard against an empty submit).
- **A failed confirm** cannot retry with Confirm — the main pending record is already consumed, so the screen returns to `editing` for a fresh submit (paste preserved).
- **A rejected or throwing bridge invoke** (handler absent/unregistered, invoke racing registration, non-serializable reply) is coerced to `malformed-request` rather than left to wedge the screen in `submitting`/`confirming` with Cancel disabled ([#513](../codebase/513.md)).
- **`paired` renders a success marker** ("Paired ✓"), but the [app shell](app-shell.md) unmounts this screen the moment `onPaired` fires ([#80](../codebase/80.md)) — `authenticated` both flips the reducer to `paired` and calls `onPaired`, and `App`'s `setRoute('conversation')` swaps the screen out — so the marker is effectively superseded by navigation rather than lingering.
- **Static renderer tests do not execute effects or clicks.** `PairingScreen.test.tsx`
  checks modal names, full fingerprint, disabled actions, alert markup and input hygiene;
  controller tests cover the shared reducer/runners and bounded observation, including an
  overdue timer with a clock jump that does not execute the callback. Merely advancing
  timers normally would miss that race. `e2e/pairing-authentication.spec.ts` holds selected
  authentication delivery after real persistence and Noise handshake, covering onboarding,
  add-host and repair, another connected host, sticky rejection/absence/timeout, Retry
  with one save, cancellation/new interaction, stale same-host status and authentication
  before the save response. Its onboarding read retries only Playwright's exact transient
  “Execution context was destroyed” error within five seconds, via its own local
  `readAuthentication`; mutations still fail. [E2E test harness § Tolerating a transient
  inspection-context loss on reads](e2e-harness-context-recovery.md#tolerating-a-transient-inspection-context-loss-on-reads)
  is now the rule's canonical home — `chat-history-recording.spec.ts`'s confirmed-deletion reads hit
  the identical race through the shared `mainProcessRead.ts` helper (\#1502); `readAuthentication`
  itself was not migrated onto it, out of scope while this spec stays green.
  `e2e/pairing-modal.spec.ts` proves
  focus containment/restoration, inert background, busy guards, retry, fresh reopening,
  late submit handling and reachable footer actions at 800×400. Sidebar/navigation and
  recovery specs cover entry points, draft preservation, save and late-confirm navigation.
- **Dark scheme only.** Onboarding retains its full-window entry page and 420px review
  card. In-app pairing uses the shared modal for both steps.
- **The host name field (#825) has no failure mode of its own.** It is a string that is either sent
  or not; a `hostLabel.save` failure in main is deliberately not reported as a failed pairing
  (`pairingHandler.ts`'s confirm arm), so there is no new `PairingErrorReason` and nothing new for
  the supporting slot to show. Editing the label is #826/settings territory — this field writes
  once, at confirm.
- **Mutually exclusive same-tag JSX siblings need distinct `key`s if either carries insertion-only semantics** (e.g. `role="alert"`). Without a key, React reconciles both branches to one DOM node and mutates it instead of replacing it — see [#665 codebase notes](../codebase/665.md) for the full trace; the fix here is only complete because the reducer forces `error` to `null` between any two errors, so the slot provably alternates and two same-key errors in a row can't occur.

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md), [#662](../codebase/662.md) — the router that mounts this screen on a user-initiated pair request (was: on any unpaired launch) and consumes both its `onPaired` and, since #662, `onCancel` seams.
- [Welcome screen](welcome-screen.md) / [#662](../codebase/662.md) — the screen this one now follows in the app shell's routing; `onCancel` returns there.
- [Pairing IPC channel](pairing-ipc-channel.md) / [#54](../codebase/54.md) — the typed request/response channel + preload methods this screen drives; the held-state model behind `confirm-failed → editing`. [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) added `confirm`'s optional `label`, which #825 (above) is the last leg of.
- [Host-label store](host-label-store.md) / [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) — where the label typed here (#825) ends up, via the confirm write path (#823); [Host-label channel](host-label-channel.md) / [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) is the read path back.
- [Pairing-confirmation](pairing-confirmation.md) / [#53](../codebase/53.md) — where the 23-char fingerprint is derived; the human-verify step this screen presents.
- [Pairing-payload gate](pairing-payload-gate.md) / [#52](../codebase/52.md) — the parse + relay-allowlist stage behind the submit path.
- [Session store](session-store.md) / [Daemon-event bridge](daemon-event-bridge.md) — the pure-reducer / untested-wiring precedent this screen mirrors.
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the sibling renderer screen; the `renderToStaticMarkup` + theme-token discipline reused here.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — `useReducer` for ephemeral screen state · [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the store shape this deliberately does *not* use.
- [#513 codebase notes](../codebase/513.md) — the rejected-invoke recovery fix that made `runSubmit`/`runConfirm` total functions.
- [#664 codebase notes](../codebase/664.md) — swept every outside consumer onto `aria-label="Pairing code"` alone, ahead of #665's element swap.
- [#665 codebase notes](../codebase/665.md) — restyled the paste phase onto desktop's own Figma frame (`103-2901`); the `EntryCard` → `EntryPage` rewrite, the `.pairing-card`/`.pairing-page` split, the clear control, and the keyed-supporting-slot reconciliation fix described above.
- [#55 codebase notes](../codebase/55.md) · Spec: `docs/specs/architecture/55-pairing-input-screen.md` — the original `EntryCard`/`<textarea>` shipment; left as a historical record of what shipped at the time, superseded by #665 above.
