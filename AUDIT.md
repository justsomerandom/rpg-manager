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
- Added city-map ownership and migration/backfill logic, cascading cleanup, and orphan cleanup when cities leave a world map.
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
- Added dirty-state feedback, internal-navigation and close guards, compiled-preview invalidation, revision-aware saves, and recoverable preview-generation failures.
- Bounded canvas pixel allocation and corrected compiled isometric rendering instead of storing a rotated top-down image.
- Improved city-map placement, geometry editing, road/building removal, regeneration preservation, responsive layout, and save/error feedback.

### UI, accessibility, and maintainability

- Standardized page hierarchy, panels, controls, success/warning/error states, empty states, loading feedback, and destructive affordances.
- Added semantic labels and landmarks, keyboard focus states, modal semantics/focus containment, route-level headings, live regions, and reduced-motion support.
- Removed the runtime Google Fonts dependency so the offline interface is visually stable.
- Improved responsive behavior for narrow desktop windows and made the campaign dock keyboard- and overflow-safe.
- Removed starter branding/code and added accurate application metadata and documentation.

## Verification

The final handoff records the exact commands and outcomes after all parallel changes are integrated. The intended release gate is:

```text
npm run check
npm run build
npm audit
cargo fmt --check
cargo check
cargo test
```

## Remaining risks

- **No user-facing backup/restore or export.** The SQLite file can be backed up manually, but recovery is not yet a guided product flow.
- **Templates are read-only after world creation.** They are visible in the Index and drive character sheets, but safely evolving a live template (including field-ID migrations) still needs a dedicated workflow.
- **No automated frontend interaction suite.** Type checking and production builds catch structural regressions; route, modal, persistence, and canvas interactions still need repeatable WebDriver/Tauri integration tests.
- **Large rendering work remains on the UI thread.** Canvas memory is bounded, but compiling a dense map can briefly reduce responsiveness. A worker-based renderer would further isolate it.
- **JSON recovery is validation-first.** Corrupt map/template documents produce actionable errors instead of crashes, but there is no visual repair/import tool for hand-edited or externally damaged database content.
- **Single-device by design.** There is no sync, collaboration, authentication, or conflict resolution. Adding any of those would require a separate threat model and storage architecture.
