# Pyrycode Desktop knowledge

Read the root project instructions first. Then read the topic
that owns the ticket. Search [the catalog](CATALOG.md) when the owner is unclear.
Do not load the whole catalog into every run.

- [Development verification](features/development-verification.md): test boundaries, meaningful evidence, and source checks.
- [Live test runbook](features/live-e2e-runbook.md): real daemon and Claude test requirements.
- [Conversation shell](features/conversation-shell.md): the conversation screen.
- [Channel list](features/channel-list.md): sidebar rows and their state.
- [Modal state and bridge](features/modal-store-bridge.md): permission and question delivery.
- [Assistant Markdown](features/assistant-markdown-renderer.md): supported response formatting.
- [Architecture decisions](CATALOG.md#decisions): why the app uses its current design.

The documentation stage owns this map and the catalog. Add catalog entries for
new documents. Change this map only when startup topics change.
The per-ticket codebase directory is frozen history. Claude local memory is
disabled. Put lessons in PRs or issue comments for the documentation stage.
