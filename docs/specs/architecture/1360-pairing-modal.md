# In-app pairing modal

## Context and scope

Pairing currently unmounts its invoking screen, losing the composer draft. Keep
that screen mounted while presenting the existing two-step controller in Modal.
One deliverable; estimate 700 written lines including this plan and tests, four
production files, one new exported component at most, two mount sites, five ACs,
and no new domain error branches. No remote feature branch overlaps the planned
files after fetching origin. Codegraph is unavailable (index not initialized);
source reads and caller searches supplied the map instead.

## Files read

- `src/renderer/src/screens/pairing/PairingScreen.tsx`: PairingView, EntryPage,
  ReviewCard, PairingScreen — presentation and controller boundaries.
- `src/renderer/src/screens/pairing/pairingState.ts`: pairingReducer, runSubmit,
  runConfirm — retained retry, confirmation and label normalization contracts.
- `src/renderer/src/PairedShell.tsx`: PairedShellView, PairedShell — origin,
  recovery identity, generation and conversation subtree ownership.
- `src/renderer/src/pairedRoute.ts`: nextPairedRoute — unchanged exit transitions.
- `src/renderer/src/components/Modal.tsx` and `modal.css`: Modal — panel chrome,
  constrained dimensions and scrolling; existing consumers need no changes.
- `src/renderer/src/screens/channels/EditHostDialog.tsx`: EditHostDialogView —
  existing Modal use. `screens/channels/channels.css`: field token patterns.
- `src/renderer/src/theme/tokens.css`: existing colors and type scales.
- `src/main/pairingHandler.ts`: registerPairingHandler — pending-record ownership.
- `src/main/pairingConfirmation.ts`: PairingConfirmation — fingerprint/save split.
- `docs/knowledge/features/pairing-input-screen.md`: secret hygiene and retry.
- `docs/knowledge/features/paired-shell-routing.md`: keyed conversation lifetime.
- `docs/knowledge/features/development-verification.md`: interaction and capture proof.
- Existing PairingScreen, PairedShell and pairingRecovery unit tests and
  sidebar-pair-new-host, paired-shell-navigation and pairing-recovery e2e specs.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2498
and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2559
(shared panel: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942).
Both references show a 640px dark panel with Pair title, close icon, divider and
centered Cancel/Pair footer. Entry has two filled fields with labels above;
verification has a surface-variant highlight, display-small text and centered
explanation. Reuse Modal and its close asset; express layout with existing tokens.

## Design and state + concurrency model

Add optional modal presentation and recovery context to PairingScreen/PairingView.
Onboarding defaults to the current full-page view. Modal entry uses exactly
Pairing code and Host name; retain the shared length bound and input hygiene.
Verification renders the entire fingerprint as one escaped text value, wrapping
without changing characters. Keep pairingReducer and both effect runners intact.

PairedShellView renders the captured origin beneath the modal whenever route is
pairServer. Preserve the background component's position and key across opening
and cancellation. Recovery context remains inside the modal. Existing asynchronous
navigation may supersede pairing; the shell generation guard still rejects its
late navigation callback and saved-host refresh still runs for an authorized save.

Use a native modal dialog wrapper around Modal for top-layer placement and browser
background inertness. The wrapper owns showModal/close, initial field focus,
Tab containment, Escape interception and focus restoration. Remove listeners on
unmount. Busy submit/confirm reject duplicate calls synchronously and disable
cancellation through every path. Ignore late submit results after unmount; retain
the shell's generation-checked save completion. Reopening mounts a fresh reducer.

## Error handling

Reuse typed results and fixed ERROR_COPY. Validation errors stay in entry; storage
failure retains both fields and requires fresh submission and verification. Never
save on first Pair or cancellation. Keep existing content-free diagnostics and
add only static lifecycle/result codes through the existing diagnostic bridge.

## Testing strategy

RED static assertions for modal labels, full fingerprint, disabled actions, error
announcement and retained background. GREEN focused unit tests plus build. Adapt
existing fake-transport specs for modal entry/cancel, draft preservation, repair,
busy guards and late navigation via an asynchronous event rather than blocked
background clicks. Add validation/storage retry and keyboard/focus checks. Capture
both modal states with synthetic content at 800px and a short viewport, inspect
against Figma, and record artifact paths. Onboarding assertions remain unchanged.

## Open questions

None. Native dialog supplies background inertness; caller-owned keyboard handling
must still prevent underlying document Escape listeners from navigating.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/pairing-input-screen.md`
and paired-shell documentation, especially `docs/knowledge/features/paired-shell-routing.md`,
to distinguish full-page onboarding from in-app modal pairing, including manual
repair, cancellation to the invoking view and the unchanged success/retry flow.

## Security review

**Verdict:** PASS

- Trust boundaries: PairingScreen passes opaque input only to runSubmit; existing
  registerPairingHandler validation and PairingConfirmation remain authoritative.
- Tokens: no input names, IDs or form ancestor; autocomplete and spellcheck off.
  No new persistence or logs of input, host label or fingerprint. Cancel/unmount
  drops local fields; a new submit supersedes the old main-process pending record.
- Storage: existing confirmation uses the encrypted store; keychain failure stays
  a typed failure. No new paths, file operations or renderer web storage.
- Electron: no new IPC, navigation capability, remote assets or webPreferences
  changes. Transport and cryptography remain in main.
- Cryptography/network: no changes to fingerprint derivation, Noise, relay URL
  validation, connections or authentication; protocol hardening is outside this
  presentation ticket and remains owned by the existing transport implementation.
- Errors/logs: fixed category copy only; lifecycle diagnostics use static codes.
- Concurrency: synchronous busy guard prevents duplicate confirmation; captured
  generation protects newer views. Dialog listener cleanup and native inertness
  prevent background interaction; busy dismissal never advances confirmation.
- Threat alignment: hostile content renders as escaped text, full fingerprint
  remains available for comparison. Disk theft and compromised relay protections
  continue through the existing safeStorage and Noise boundaries.
