# RPG Manager

RPG Manager is an offline, desktop-first campaign and worldbuilding workspace. It combines campaign metadata, template-driven character sheets, a searchable world codex, long-form lore books, and procedural world/city map editors in one local application.

## Technology

- React 19, TypeScript, Vite, and Tailwind CSS
- Tauri 2 for the desktop shell and typed command bridge
- Rust and SQLite for local persistence

There is no server, account, telemetry, cloud sync, or multiplayer layer. A `World` is the ownership boundary for all campaign data.

## Features

- **Worlds:** atomic world/template creation, metadata editing, world listing, and confirmed cascading deletion.
- **Characters:** a world roster with editable notes and values rendered from the saved character-sheet template.
- **Index:** SQLite-backed searchable codex entries with categories, tags, full text, editing, deletion, and non-destructive migration from the former browser-storage format.
- **Lore:** editable books and chapters with selection guards and confirmed deletion.
- **World maps:** deterministic triangular terrain, responsive background generation, top-down brush tools, environmental layers, locations, terrain-aware roads, safe source saves, and compiled presentation previews.
- **City maps:** terrain-aware procedural layouts, connected top-down streets, districts, functional civic buildings, editable geometry, and synchronized world-road approaches.

## Architecture

```text
React route/component
  -> typed module in src/api
    -> Tauri invoke command
      -> validated Rust handler
        -> SQLite row or bounded JSON document
```

Relational tables store ownership and queryable records. Flexible template and map documents are serialized as JSON in SQLite. Backend commands validate identifiers, text sizes, JSON structure, map dimensions, coordinates, collection sizes, and ownership before writing.

The repository keeps the standard Tauri project layout:

```text
.
├── src/                  # React and TypeScript frontend
│   ├── api/              # Typed Tauri command boundary
│   ├── components/       # Shared UI components
│   ├── features/         # Feature-specific logic and UI
│   ├── pages/            # Route-level screens
│   └── state/            # Shared client state
├── src-tauri/            # Rust backend and desktop application
│   ├── capabilities/     # Tauri permissions
│   └── src/              # Commands, models, validation, and storage
└── docs/                 # Project documentation
```

`src-tauri` is Tauri's conventional application directory and is intentionally not renamed to a generic `backend` directory.

## World Map Studio workflow

The world editor opens in **Essential** mode. Its guided flow is to generate a terrain base, paint broad biome regions, place important sites, connect them with terrain-aware roads, and save checkpoints from the top bar. **Advanced** mode exposes direct relief, climate, map-size, water-level, road-naturalness, and bridge controls.

World terrain is stored as an alternating triangular lattice. New maps default to a `216 × 72` landscape lattice (approximately `1.74:1`); Advanced tools provide landscape presets and independent column/row controls up to 256 per axis and 32,768 total triangles. Brushes, smoothing, biome sampling, location placement, hit testing, and road routing all use triangle cells and three-edge adjacency. Older square-era maps retain their source layers, locations, and roads when opened; their stale compiled preview is discarded and can be rendered again from the migrated triangular source.

The editor uses a subdued, low-saturation biome palette so terrain categories remain legible without pretending to be finished cartography. Compiled presentation maps use a separate render palette, icon pass, grading, and texture. Procedural terrain uses aspect-correct domain-warped continental noise, ridge fields, ocean shelves, latitude, prevailing moisture, and altitude effects.

Map loading, legacy normalization, and procedural generation run in a web worker so the interface remains responsive. Presentation rendering is pixel-budgeted and displays an operation overlay, but still uses the browser canvas on the UI thread because it composes image assets.

## Development

Prerequisites:

- Node.js `^20.19.0` or `>=22.12.0`
- A current stable Rust toolchain
- The platform prerequisites required by Tauri 2

Install the locked dependencies and run the desktop application:

```bash
npm ci
npm run dev
```

Use `npm run dev:web` only for frontend work that does not require persistence or Tauri commands.

Run the complete local validation suite and production frontend build before committing:

```bash
npm run check
npm run build
git diff --check
```

Useful focused commands:

| Command                | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`    | Check TypeScript without emitting files                                 |
| `npm run lint`         | Run ESLint and Clippy with warnings denied                              |
| `npm run format`       | Format supported frontend, configuration, documentation, and Rust files |
| `npm run format:check` | Verify Prettier and rustfmt formatting                                  |
| `npm test`             | Run the Rust test suite                                                 |

See [AGENTS.md](./AGENTS.md) for repository conventions and contribution guidance. Continuous integration runs the same checks for pushes to `main` and pull requests.

## Local data and security

The database is named `ttrpg-manager.db` and is created in the operating system's Tauri application-data directory. SQLite foreign keys, WAL journaling, a busy timeout, explicit schema versioning, and transactional multi-record operations protect data integrity. City plans are world-scoped and can only be read or saved after their parent city exists in that world's saved map.

The production webview uses a restrictive content security policy. The application does not request shell, file-system, network, or URL-opener capabilities. Compiled map images are locally generated PNG data URLs and are size-bounded before storage.

Back up the database file before installing experimental builds or making large campaign changes. Schema v3 moves legacy city-plan rows that cannot be linked unambiguously into `quarantined_city_maps` for manual recovery instead of exposing or deleting them; user-facing export/restore is not implemented yet.

## Documentation

- [Production hardening audit](./docs/production-audit.md) — historical verification record and known residual risks from the July 2026 audit.
