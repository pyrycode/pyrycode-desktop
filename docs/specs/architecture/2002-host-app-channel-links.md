# Stable host app links from channel replies

## Files read

- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` → `urlTransform`, `webLink`, `AssistantMarkdown`: opt-in buttons and unchanged external/workspace policy.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.tsx` → `FrozenMarkdown`, `StreamingAssistantMarkdown`: forward the callback to frozen units and pending tails.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `Timeline`, `ThreadItemsTimeline`, `TimelineRow`: conversation-only navigation wiring.
- `src/renderer/src/PairedShell.tsx` → `PairedShellView`, `PairedShell`, `openConversation`: pairing origin and explicit hosted-content release.
- `src/main/hostedPane.ts` → `registerHostedPane`: strict attached-main-frame admission, paired registry lookup, synchronous selection, discovery and native generation fences.
- `src/shared/ipc/hostedPane.ts`, `src/preload/index.ts` → `isHostedPaneCommand`, `onHostedPane`: typed selection and event-first observation.
- `src/main/connectionRegistry.ts` → `connectionFor`: named paired connections independently of the active conversation.
- `src/shared/externalLink.ts` → `allowedLinkHref`: hosted links stay excluded.
- `e2e/hosted-content-pane.spec.ts`, `e2e/progressive-markdown.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: local fake replies, processing barriers and native inspection.
- `docs/knowledge/INDEX.md`, `features/paired-shell-routing.md`, `features/daemon-connection-hosted-resource-views.md`, `features/assistant-markdown-renderer.md`, `features/development-verification.md`: current discovery is authority; static rendering cannot prove activation.
- Approved daemon `3120-hosted-app-contract.md` § Scope, versions and identity: exact stable host/app UUIDv4 link, no authority conveyed by links.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4 and node 132-3902. Read both design contexts and screenshots. Reuse the existing inline `markdown-link` button, pairing modal and `HostedPane` chrome within the fixed 400px sidebar/expanding pane layout. Existing theme text, primary, spacing and card tokens remain; no new assets or visual system.

## Context

Make published host app links actionable only in assistant conversation replies. The merged viewer already implements discovery, recovery and native resource security; reuse it. Live creation/publish/daemon acceptance remains #1929, sidebar Apps entry remains #2001. No ADR needed.

One deliverable, four observable criteria; estimate 650–740 written lines including tests/plan, zero new exported types/components/stores, at most ten production forwarding sites and nine rejection categories. No overlapping numeric feature branches. `feature/suggestion-quieter-tab-sends` edits a separate Composer block; keep timeline edits local and additive.

## Design

Add `parseHostedAppLink(value: unknown): { serverId: string; appId: string } | null` in shared code. Match the original string against the entire exact lowercase scheme/authority/path and canonical lowercase UUIDv4 grammar. Do not trim, decode or use URL normalization. The same parser is suitable for untrusted input without granting authority.

Add optional `onOpenHostedApp(serverId, appId)` props through the conversation timeline and both streaming branches. Only that callback enables a validated hosted link to become a `type=button` with existing link styling. Keep IDs in its closure, never an href or other attribute. Other Markdown consumers and clipboard HTML omit it and stay inert. Guard against Markdown destination normalization (entities/backslash escapes) as well as URL normalization; retain normal Markdown labels. Existing external and workspace links use their existing independent paths.

`PairedShell` owns the callback: a currently saved host sends the existing typed `hostedPane(select)` command immediately; an unknown host opens the existing pairing entry point, capturing the origin route. Do not save or queue an app target across pairing. No new IPC is needed: main already independently checks exact attached privileged main frame, strict command fields and `registry.connectionFor(serverId)`. Read selection only from `onHostedPane`, never command-result state. Existing conversation activation closes content and restores the original host/conversation draft.

## State + concurrency model

No new store, pending navigation task or resource owner. Selection commands are synchronous in main; each replaces prior discovery/native subscriptions and advances generation. The shell ignores command snapshots, so delayed results cannot override the state stream. Discovery/native loading, disconnect/unsupported/unavailable/reopen and teardown remain owned by the current pane. Opening a healthy selection does not refresh discovery. Pairing has no retained app intent. Callback identity stays stable across stream deltas.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Streaming pending link, frozen link, settled link, repeated activation | `hosted-app-links.spec.ts`: streaming and settled links preserve conversation drafts |
| Equal app IDs across hosts, switch A to B, delayed A discovery/selection result | `hosted-app-links.spec.ts`: latest host selection survives delayed replies |
| Malformed targets or valid unpaired target; pairing cancel and re-entry | `hosted-app-links.spec.ts`: invalid and unpaired links stay bounded |
| Missing/stopped/failed app; offline/reconnect, unsupported and Reopen | `hosted-app-links.spec.ts`: links reuse discovery recovery |
| Sidebar return to originating conversation releases hosted resources/restores draft | streaming and settled links preserve conversation drafts |
| Untrusted frame/unknown host or malformed selection IPC | focused main boundary unit test and production preload/IPC browser checks |

## Error handling

Invalid links render their visible label without controls. Unknown hosts open manual pairing only. Existing IPC refusal is content-free and changes no selection. Ignore command-state replies; catch rejected invocation with a static diagnostic. Viewer status copy, discovery refresh/reopen rules and no-start behavior remain unchanged. Never log daemon text, links, labels or exception details.

## Testing strategy

Test first: exact parser rejection matrix, inert/default rendering and unchanged external/workspace markup; streaming frozen/pending propagation; attached-main-frame and paired-host admission with fake discovery. Fake-transport Playwright uses the production app/preload/IPC and synthetic replies; assert native identity/resource routing, draft restoration and no OS handoff after positive state/discovery barriers. Capture integrated link/pane at 1280px and 800px. Run changed focused specs, pre-verify/full units and build after final main merge. Reuse existing native-view/Fetch security proof; no live tests changed.

## Open Questions

None. A simpler shape is to reuse the existing select IPC rather than add URL IPC or a general navigation framework; this design uses that shape.

## Security review

**Verdict:** PASS

- [Trust boundaries] Exact raw-string parser narrows daemon destinations to UUID identities. The existing `registerHostedPane` handler independently validates sender/main frame, command shape and named paired registry membership; links never grant running authority.
- [Tokens] No token/key generation, transfer or persistence; existing safeStorage remains unchanged. Unknown links never import credentials.
- [File/storage] No new filesystem paths, caches or storage. Preserve existing host/conversation draft keys; destinations never become file paths.
- [Electron attack surface] Button-only explicit activation; no OS registration, external allowlist or CSP changes. Isolated hosted content receives no client navigation callback/preload. Only attached privileged main frames can select.
- [Cryptography] No new crypto; current Noise and native random origins remain owned by existing transport/viewer.
- [Network/I/O] No direct URL fetch or app-start request. Complete current-generation discovery and native readiness gate resources; existing bounded transfers/deadlines stay authoritative.
- [Errors/logs] Static event/code only. No URL, reply text, label, secret or exception logging.
- [Concurrency] Synchronous replacement and pane generations fence late results/discovery; event stream alone updates renderer state. Pairing retains no deferred app intent; existing unmount cleanup retires content.
- [Threat model] Hostile daemon URLs fail closed; relay delays cannot authorize resources; compromised hosted renderers cannot select clients. Disk-token theft defenses remain safeStorage; live publishing/SQL proof is #1929.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

## Revisions

2026-10-15: The shared launch fixture's host IDs are legacy non-UUID names. The focused spec uses its `skipPairing` entry and existing pairing drivers with spec-local canonical identities; no shared fixture migration. Markdown source validation is a narrowing-only remark plugin over link/definition nodes, preserving reference links while rejecting entity/backslash normalization. Production still reuses the existing selection IPC without changing main or preload policy. Recovery scenarios follow the existing initial-selection automatic-open versus retired-pane Reopen behavior; no viewer state machine changes.

2026-10-15 (verifier finding 1): `remarkHostedLinks` validates the literal destination token independently of the Markdown title, whose syntax is already validated by the Markdown parser. Locate inline destinations after the parsed label so title punctuation cannot move the boundary. Canonical bare/angle destinations with escaped titles remain actionable; entity/backslash-normalized destinations remain inert. Static regressions cover inline/reference links in settled and streaming renderers, including frozen units and pending tails. No IPC, viewer lifecycle or link-attribute policy changes; the security review remains PASS.

2026-10-15 (re-review of `1f77a8c8`, finding 1): `definitionDelimiter` scans the parsed definition's original source, skipping backslash pairs, to locate the unescaped `]:` boundary. Escaped brackets inside a reference label no longer hide canonical destinations. `hostedAppLinks.test.tsx` covers single/repeated escaped closing brackets, odd/even backslash runs, escaped opening brackets, bare/angle destinations and escaped titles in both production renderers, with opt-in and no-render-time-activation checks. Normalized destinations stay inert even with escaped labels and decoy delimiters in titles. Security re-audit: PASS; this bounded linear source scan changes no IPC, native authority, credentials, storage, crypto, I/O, logs, concurrency or threat-model contract. No new exports, state or failure categories; total written work remains below 800 lines. No in-flight numeric feature branches overlap these two source files.

2026-10-15 (re-review of `db9687fb`, finding 1): The `AssistantMarkdown` hosted-link override now requires meaningful rendered label content before creating a button. A local pure child walk checks text, nested formatting and image-alt text; blank labels retain their inert output, and meaningful labels render unchanged. Focused settled/streaming regressions include frozen units and pending tails. Security re-audit: PASS across all nine categories; this narrowing-only render guard adds no attributes, IPC, state, credentials, storage, crypto, I/O, logging or concurrency changes. Existing Figma/capture evidence remains applicable to the unchanged link styling. No overlapping in-flight numeric branches touch the two source files; total written work remains below 800 lines.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/assistant-markdown-renderer.md` — exact canonical app destinations, opt-in conversation navigation, streaming support and inert unrelated readers/clipboard HTML.
- Pending documentation stage: `docs/knowledge/features/paired-shell-routing.md` — named-host link routing, manual pairing without deferred app intent, and conversation/draft restoration.
- Pending documentation stage: `docs/knowledge/features/daemon-connection-hosted-resource-views.md` and `docs/knowledge/features/development-verification.md` — discovery authority/recovery reuse and fake-transport link scenarios.
