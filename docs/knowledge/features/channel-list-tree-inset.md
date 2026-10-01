# Channel List — host-first tree geometry

The 400px sidebar card keeps 20px side padding. The toolbar and its rule stay outside the scrollport; the tree's 24px top padding scrolls with the content. Its negative 20px right margin and matching padding preserve the right content inset while allowing native scrolling with a hidden scrollbar. See [the sidebar CSS](channel-list.md#css-channelscss).

Inside that content box, a host row is 28px high. Host containers are separated by 16px. Each host owns a 28px Channels row and a 28px Chats row. The section rows begin 4px inside the content edge; their labels are fixed client copy. A conversation row begins 12px inside that edge, has a 24px box and follows a 28px vertical pitch. Existing row title, status dot, hover fill and trailing controls retain their own [row geometry](channel-list-desktop-row-geometry.md). The folder glyph switches between open and closed variants, while each chevron follows its own `aria-expanded` state.

There are no workspace rows, global Channels/Chats trees or divider in the active sidebar. Apps rows and actions are absent. Old workspace inset and divider rules may still exist in `channels.css` with the unreachable legacy renderer; they are not active layout contracts. This is why geometry checks should measure the rendered host, section and conversation rows rather than infer position from those selectors.

[`e2e/sidebar-tree-geometry.spec.ts`](../../../e2e/sidebar-tree-geometry.spec.ts) measures host and section heights, the 16px host gap, the 4px and 12px insets, and the 24px row on a 28px pitch. It also keeps the fixed toolbar and tall-list scrolling checks. Static renderer tests have no layout engine and cannot establish these positions. A name pill at a scroller clip edge needs a reachable scroll setup: the old workspace-layer setup left a target row 35px below the edge after this hierarchy changed, even though its pill behavior was intact.

## Related

- [Channel List home screen](channel-list.md) — hierarchy and scrollport behavior.
- [Host and section folds](channel-list-host-fold.md) — the state behind the folder and chevron variants.
- [Row geometry](channel-list-desktop-row-geometry.md) — conversation row styling.
