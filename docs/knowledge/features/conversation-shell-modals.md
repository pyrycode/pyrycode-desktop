# Conversation shell — modals

The two overlays that act on one conversation as a whole rather than one turn, and take over the screen (or
the composer's slot) to ask the operator something. Split out of [Conversation shell — conversation surfaces
and modals](conversation-shell-conversation-and-modals.md) on 2026-09-02, then split again the same day into
the two documents below, to keep each under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge
cases and its links.

- [Permission modal](conversation-shell-permission-modal.md) — the trust/permission dialog (#224, answerable
  since #237), its client-side second-confirm gate (#226) and its rejection surface (#249).
- [Question panel](conversation-shell-question-panel.md) — the batched-question overlay in the composer's
  slot (#906), its option rows (#907, live since #912), its header tabs (#915) and its Previous/Next step
  controls (#916).
