# Production hardening audit

Date: 2026-07-22

This pass evaluated the application against the intended GM outcomes described in the project brief. It covered the React/Tauri boundary, database ownership and migrations, every route-level workflow, both map editors, accessibility, failure states, and desktop packaging configuration.

## Major changes

### Data integrity and security

- Consolidated the real Tauri application setup into the library entrypoint so desktop and mobile/library builds cannot silently expose different command sets.
- Added transactional schema initialization with an explicit SQLite schema version, foreign keys, WAL journaling, a busy timeout, and supporting indexes.
- Added bounded backend validation for IDs, names, text, JSON objects, template types, categories, map/city dimensions, coordinates, layers, collections, and compiled PNG data URLs.
- Made world plus template creation atomic. A template failure can no longer leave a partially created campaign.
- Added existence and affected-row checks so update/delete commands report missing records instead of silently succeeding.
- Enforced world-scoped city-plan ownership end to end. Schema v3 backfills uniquely attributable legacy plans, quarantines ambiguous/orphaned source rows for manual recovery, requires non-null ownership, and rejects cross-world city-ID collisions.
- Removed the unused URL-opener plugin and permission, and introduced production/development content security policies.

### Completed product workflows

- Added confirmed cascading world deletion.
- Rebuilt character management into editable, template-driven sheets with persisted attributes, notes, validation, dirty-state protection, and deletion.
- Moved the world Index from browser-only storage to SQLite CRUD. Existing valid local notes can be imported non-destructively with duplicate protection.
- Completed Lore CRUD for books and entries, including edit/cancel states, selection guards, retry/error handling, and confirmed cascading deletion.
- Added route defaults, desktop-safe hash routing, not-found/error recovery, invalid-world handling, and live campaign-title synchronization.

### Map and city reliability

- Hardened saved-map normalization and legacy defaults against malformed dimensions, layers, coordinates, IDs, and oversized data.
- Corrected grid/isometric coordinate and rendering defects, deterministic math edge cases, road routing, water placement, and city/road removal behavior.
- Added dirty-state feedback, internal-navigation plus native-window close guards, compiled-preview invalidation, revision-aware saves, and recoverable preview-generation failures.
- Bounded canvas pixel allocation and corrected compiled isometric rendering instead of storing a rotated top-down image.
- Improved city-map placement, geometry editing, road/building removal, regeneration preservation, responsive layout, and save/error feedback.

### UI, accessibility, and maintainability

- Standardized page hierarchy, panels, controls, success/warning/error states, empty states, loading feedback, and destructive affordances.
- Added semantic labels and landmarks, keyboard focus states, modal semantics/focus containment, route-level headings, live regions, and reduced-motion support.
- Removed the runtime Google Fonts dependency so the offline interface is visually stable.
- Improved responsive behavior for narrow desktop windows and made the campaign dock keyboard- and overflow-safe.
- Removed starter branding/code and added accurate application metadata and documentation.

## Verification

The final integrated tree passed the following release checks:

```text
npm run check                                      passed
npm run build                                      passed (71 modules; 486.88 kB JS / 145.00 kB gzip)
npm run tauri -- build --debug --no-bundle         passed (desktop executable built)
npm audit --json                                   passed (0 vulnerabilities)
cargo fmt -- --check                               passed
cargo check --all-targets --locked                 passed
cargo clippy --all-targets --locked -- -D warnings passed
cargo test --all-targets --locked                  passed (24 tests)
git diff --check                                   passed
```

The production build reported only stale Browserslist/Baseline metadata notices; it produced the release assets successfully.

## Remaining risks

- **No user-facing backup/restore or export.** The SQLite file can be backed up manually, but recovery is not yet a guided product flow.
- **Templates are read-only after world creation.** They are visible in the Index and drive character sheets, but safely evolving a live template (including field-ID migrations) still needs a dedicated workflow.
- **No automated frontend interaction suite.** Type checking and production builds catch structural regressions; route, modal, native-close, persistence, and canvas interactions still need repeatable WebDriver/Tauri integration tests and a packaged-app smoke pass on each target OS.
- **Large rendering work remains on the UI thread.** Canvas memory is bounded, but compiling a dense map can briefly reduce responsiveness. A worker-based renderer would further isolate it.
- **JSON recovery is validation-first.** Corrupt map/template documents produce actionable errors instead of crashes. Ambiguous legacy city plans are preserved in `quarantined_city_maps`, but there is no visual repair/import tool for quarantined, hand-edited, or externally damaged content.
- **Road routing has a permissive fallback.** If constrained A* cannot find a world-road path, the editor falls back to a direct segment; unusually hostile terrain can therefore produce a less natural route that needs manual adjustment.
- **Single-device by design.** There is no sync, collaboration, authentication, or conflict resolution. Adding any of those would require a separate threat model and storage architecture.
