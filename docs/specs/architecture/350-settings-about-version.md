# Spec — #350 Settings About section: app version readout

**Size:** S (confirmed; near XS — 4 production files, < 100 LOC, no fan-out, no new exported types).
**Security-sensitive:** No — build-time constant, no untrusted input, no IPC, no daemon round-trip.
**Split from:** #151. Siblings: #351 (archived count), #352 (Defaults), #353 (Push).

## Files to read first

- `src/renderer/src/screens/settings/SettingsScreen.tsx` (whole, 68 lines) — the composition point you extend. The About `<section>` inserts into `settings__body` **after** the existing Connection `<section>`. Reuse the `SETTINGS_COPY` module-const idiom (extend it with `about`) and the `settings__section` / `settings__section-header` markup already present.
- `src/renderer/src/screens/settings/settings.css:86-119` — `settings__section` (86-90), `settings__section-header` (95-103), `settings__section-body` (106-109), `settings__server-row` (114-119). The About header reuses `settings__section-header` verbatim; the version row **mirrors** `settings__server-row` padding. These are the only tokens you touch — no new ones.
- `src/renderer/src/screens/settings/ServerRow.tsx:7-13,32` — the client-owned copy idiom (module-const, apostrophe-free — `renderToStaticMarkup` escapes `'`) and the `body-large` label markup (`<p className="settings__server-row-label">`) to mirror for the version line.
- `src/renderer/src/screens/settings/SettingsScreen.test.tsx` (whole, 41 lines) — the `renderToStaticMarkup(<SettingsScreen onBack={noop} />)` test idiom. Add the two new assertions here.
- `electron.vite.config.ts` (whole, 21 lines) — the `define` goes inside the **`renderer`** block (alongside `resolve` / `plugins`). Already imports `resolve` from `path`.
- `vitest.config.ts` (whole, 24 lines) — the **second** `define` goes at the **top level** of `defineConfig` (alongside `plugins` / `resolve` / `test`). Load-bearing — see Design §2. Already imports `resolve` from `path`.
- `src/renderer/src/env.d.ts` (2 lines) — the ambient-`.d.ts` sibling location. The new `version.d.ts` goes right next to it; both are swept up by `tsconfig.web.json`'s `src/renderer/src/**/*` glob.
- `tsconfig.node.json` (whole) — confirms `electron.vite.config.ts` **is** typechecked, and `resolveJsonModule` is set nowhere. This is why the version is read via `readFileSync`, **not** `import pkg from './package.json'` (see Design §2, the gotcha).
- `package.json` line 2 — `"version": "0.1.0"`. The single source of truth the `define` feeds from.
- `src/renderer/src/theme/tokens.css:22,24,62,77,90-91` — `--color-on-surface` (22), `--color-primary` (24), `--text-body-large-*` (62…), `--text-label-large-*` (77…), `--space-3`/`--space-4` (90-91). All already exist; the spec adds no token.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-106

A left-aligned column: an "About" section header (node 17-104/17-105 — `pt-16 pb-4 px-16`, label-large **primary**, identical treatment to the existing "Connection" header) directly above a single row (node 17-106 — `px-16 py-10`, a 2px-gap text column) whose one visible line reads "Version 0.1.0" in body-large on-surface (17-108). The design's second sub-line "build a8f3c2d" (body-small on-surface-variant, 17-109) is the build-hash readout and is **out of scope** here (no wired build-metadata source on desktop — follow-up ticket). Render only the single "Version X.Y.Z" line.

## Context

The Settings screen (#333 chrome + #334 Server row) currently ends after the Connection section. The mobile design closes with an About section whose first row shows the running app's version. This ticket appends that: an About section header plus one static version readout.

The value is the client's **own** build string — it lives in `package.json`'s `version`, is baked into every build, is non-secret, and has no untrusted-input or async character. It therefore needs **no** main→renderer bridge. This is the deliberate opposite of `serverInfo` (#340/#334), which split precisely *because* it is daemon-sourced, async, nullable, and read from the secure pairing record. Sourcing the version over IPC would cross main+preload+shared+renderer for zero benefit and would itself have to be split under the transport-vs-render rule. A build-time constant avoids the round-trip **and** the split.

## Design

Three moving parts: a build-time `define` in two configs, an ambient type declaration, and an inline About section in the renderer.

### 1. The About section (renderer — `SettingsScreen.tsx`)

Add the section **inline** in `SettingsScreen` — no new component file. Unlike the Server row, the version readout has no store, no loader, no populated/null matrix; it is a static string, so a store-bound container/pure-view split would be over-engineering (and a new component file would trip the 5-file scope line).

- Extend `SETTINGS_COPY` with `about: 'About'`.
- The version line text is the template `` `Version ${__APP_VERSION__}` ``. After the `define` substitution this is `Version 0.1.0` at transform time — a plain string by render time (see §2). Keep it a module-const or compute it inline; either is fine.
- Insert a second `<section className="settings__section">` **after** the Connection section, inside `settings__body`:
  - `<h2 className="settings__section-header">{SETTINGS_COPY.about}</h2>` — same element/class as the Connection header.
  - `<div className="settings__section-body">` wrapping the version row.
  - The row: `<div className="settings__about-row"><p className="settings__about-version">{versionText}</p></div>`.

No new exported symbol; `SettingsScreen` keeps its `{ onBack }` signature. It stays server-renderable (the value is a constant, so none of the #334 zustand-SSR concerns apply).

### 2. The build-time constant (two configs) — load-bearing

Expose `__APP_VERSION__` via Vite `define` in **both** build configs, each fed from `package.json`'s `version`:

- **`electron.vite.config.ts`** — add `define: { __APP_VERSION__: JSON.stringify(appVersion) }` inside the `renderer` block. Drives `npm run dev` / `npm run build`.
- **`vitest.config.ts`** — add the **same** `define` at the top level of `defineConfig`. Drives `npm test`.

**Why both (the first-pass catch):** `vitest.config.ts` is a *separate* Vite config from `electron.vite.config.ts`. A `define` added only to the electron-vite renderer block is invisible to vitest, so the transformed `SettingsScreen` module references an undefined global and the test throws `ReferenceError: __APP_VERSION__ is not defined` at render — not a clean assertion failure. Both configs get the same `define`. This is why the ticket touches two config files, not "one config line."

**How to read the version — `readFileSync`, not a JSON import (the typecheck gotcha):**

```ts
// top of each config, after the existing `import { resolve } from 'path'`
import { readFileSync } from 'fs'
const appVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version
```

- `resolve('package.json')` resolves against `process.cwd()` (repo root for both vite and vitest) — the same CWD-relative idiom the configs already use for their aliases.
- Do **not** use `import pkg from './package.json'`. `electron.vite.config.ts` **is** typechecked by `tsconfig.node.json` (`npm run typecheck` → `tsc -p tsconfig.node.json`), and `resolveJsonModule` is set in no tsconfig — a static JSON import there fails `tsc` with *"Consider using '--resolveJsonModule'"*. `readFileSync` types cleanly (node types are already in scope), needs no tsconfig change, and is **identical** across both files. Keep the two edits symmetric.
- `JSON.stringify(appVersion)` yields the string `"0.1.0"` — the literal JS expression `define` substitutes into the source.

### 3. Ambient type declaration

New file `src/renderer/src/version.d.ts`:

```ts
declare const __APP_VERSION__: string
```

- It must contain **no** `import`/`export` — that keeps it a global (ambient) declaration, so `__APP_VERSION__` is visible to every renderer module without importing it.
- It is picked up automatically by `tsconfig.web.json`'s existing `src/renderer/src/**/*` include glob (the same glob that already covers `env.d.ts`).
- Do **not** fold this into `env.d.ts` — keep that file as the `vite/client` triple-slash reference; a dedicated `version.d.ts` is self-documenting.

### 4. CSS (`settings.css`)

Add two rules referencing only existing tokens — mirror `settings__server-row` (padding) and `settings__server-row-label` (body-large on-surface):

- `.settings__about-row` — `padding: var(--space-3) var(--space-4);` (the same `py-10`→`--space-3`, `px-16`→`--space-4` mapping the Server row already uses).
- `.settings__about-version` — `margin: 0;` + `color: var(--color-on-surface);` + the four `--text-body-large-*` declarations (size / line / tracking / weight), copied from `settings__server-row-label`.

A dedicated class (rather than reusing `settings__server-row*`) keeps the version row semantically decoupled from the Server row while introducing zero new tokens or literals — the same posture the Server row itself takes.

## State + concurrency model

None. The version is a compile-time string constant — no store slice, no async task, no subscription, no teardown, no IPC. `SettingsScreen` remains a stateless props-in/markup-out view.

## Error handling

No runtime failure modes: the value is a build-time literal, so there is nothing to fetch, parse, or reject. The only failure surface is **build/test-config**, not runtime:

- Missing `define` in `vitest.config.ts` → `ReferenceError: __APP_VERSION__ is not defined` when the test renders `SettingsScreen`. Prevented by adding the `define` to both configs (Design §2).
- Missing ambient `version.d.ts` → `tsc` error *"Cannot find name '__APP_VERSION__'"* under `npm run typecheck`. Prevented by Design §3.

## Testing strategy

Extend `SettingsScreen.test.tsx` (vitest, node env, `renderToStaticMarkup`) with two assertions on the rendered string:

- **About header** — `expect(render()).toContain('>About</h2>')` (AC1: the section header renders as an `<h2>`, mirroring the existing `>Connection</h2>` assertion).
- **Version readout** — `expect(render()).toContain('Version 0.1.0')` (AC2/AC5: the version line renders the running build string).

Test-first ordering note: add the `define` to `vitest.config.ts` **before** the `SettingsScreen` references `__APP_VERSION__`, otherwise the first test run red is a `ReferenceError` at transform, not the intended assertion-miss. Sequence: (1) `define` into both configs + `version.d.ts`, (2) write the two failing assertions (red — About/version markup absent), (3) add the About section markup + CSS (green).

The `Version 0.1.0` assertion pins the literal current version. That couples the test to `package.json`'s value — acceptable per AC5 (which names "Version 0.1.0" explicitly); see Open Questions.

`npm run typecheck` covers the ambient declaration (`__APP_VERSION__` typed as `string`) and the config edits. `npm run build` is the salvage/QA gate.

## Open questions

- **Version-literal coupling in the test.** The `Version 0.1.0` assertion breaks on any `package.json` version bump. Deriving the expected version dynamically in the test would need a JSON import in the test module (blocked — `tsconfig.web.json` covers test files and sets no `resolveJsonModule`), so the literal is the clean path and matches AC5's exact wording. When the version bumps, update the assertion. No action needed now.
- **Build-hash sub-line (Figma 17-109, "build a8f3c2d").** Out of scope — no wired build-metadata source on desktop today. A follow-up can add it if a hash becomes available at build time (a second `define`, same mechanism).
