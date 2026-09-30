# Channel List — host and section folds

The [host row](channel-list-host-row.md) is a disclosure even when its paired daemon workspace has no conversations. Each host starts open, and its Channels and Chats sections start open independently. All three chevrons point down when open and right when closed; `aria-expanded` is the state signal for the matching CSS rotation. The first expanded host in the Figma frame uses closed chevron art, so the actual fold state takes precedence over that variant.

`CollapsibleHostGroup` is keyed by the saved server id and owns the host's local `useState`. Each `HostSection` owns its own local `useState`, keyed by its fixed section position within that host. This keeps fold state scoped to the thing the user clicked, without a store, IPC message or disk persistence. A host collapse hides both sections through `.channel-list__host-content[hidden]` but **keeps them mounted**. Conditional unmounting reset a closed section to open when the host reopened; the browser fold test now exercises that sequence. An open host uses `display: contents` on the wrapper to preserve row layout.

A failed host still shows its repair control and its sections, even if its host fold was closed before failure. Its row has no disclosure while failed, so hiding those sections would strand them without a way to reopen. The host's held fold boolean survives the failure and applies again on recovery. Offline and reconnecting hosts keep their held rows and disclosure without connection dots. Folding does not select a new conversation, send a command or change the composer draft.

The host label and glyph stay inside the disclosure on a non-failed host; Edit host is a sibling, avoiding nested buttons. Failed hosts retain separate Edit and Repair controls without a disclosure. The host glyph remains positioned against `.channel-list__host`, while the disclosure owns its chevron and keyboard focus. Inserting a focusable disclosure ahead of existing row controls changes tab order, so browser checks should target the named control and verify focus sequence instead of assuming a fixed Tab count.

Static `renderToStaticMarkup` tests can inspect open and closed initial shapes, but cannot click or evaluate CSS. [The browser fold spec](../../../e2e/host-collapse.spec.ts) verifies independent folds, state retention across host collapse, promotion, draft preservation and failure recovery. [The geometry spec](../../../e2e/sidebar-tree-geometry.spec.ts) verifies the layout and retained scrolling behavior.

## Related

- [Channel List home screen](channel-list.md) — host-first row attribution and create flow.
- [Host row and its controls](channel-list-host-row.md) — identity, failure treatment, edit and repair controls.
- [Tree inset](channel-list-tree-inset.md) — host, section and conversation row geometry.
- [Host-first architecture](../../specs/architecture/1683-host-first-sidebar.md) — design and the fold-state rework.
