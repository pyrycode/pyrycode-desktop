# Conversation shell — composer options panel

The composer's options panel: its resting appearance, placement, keyboard driving, and the live wiring behind each control. Split across two documents, since together they outgrew the package-overview size cap:

- [Composer options panel — surface, placement, keyboard, clamp](conversation-shell-composer-options-panel.md) — the shared `ComposerOptionsPanel`/`ComposerOptionsMenu` surface (#838), its footer placement and right-edge clamp arithmetic (#839, #847), and its keyboard contract (#840). Four consumers build on this: Actions (#680, landed), permission mode (#682), model and effort (#683), and the slash-command type-ahead below.
- [Slash command type-ahead — decisions and mount](conversation-shell-composer-options-slash-type-ahead.md) — the fifth consumer, split from #694: #939's pure opening/filtering/completion decisions over a published command list, and #940's mount that renders them as a panel anchored to the message box, per #934's product decision (no descriptions, a 10-row cap, a window-relative width bound).

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.
