# RPG Manager

RPG Manager is an offline, desktop-first campaign and worldbuilding workspace. It combines campaign metadata, template-driven character sheets, a searchable world codex, long-form lore books, and procedural world/city map editors in one local application.

## Stack

- React 19, TypeScript, Vite, and Tailwind CSS
- Tauri 2 for the desktop shell and typed command bridge
- Rust and SQLite for local persistence

There is no server, account, telemetry, cloud sync, or multiplayer layer. A `World` is the ownership boundary for all campaign data.

## Product areas

- **Worlds:** atomic world/template creation, metadata editing, world listing, and confirmed cascading deletion.
- **Characters:** a world roster with editable notes and values rendered from the saved character-sheet template.
- **Index:** SQLite-backed searchable codex entries with categories, tags, full text, editing, deletion, and non-destructive migration from the former browser-storage format.
- **Lore:** editable books and chapters with selection guards and confirmed deletion.
- **World maps:** deterministic terrain generation, environmental layers, brush tools, grid/isometric views, cities, roads, safe source saves, and compiled presentation previews.
- **City maps:** procedural settlement layouts, districts, roads, buildings, named occupants, editable geometry, and world-road approaches.

## Architecture

```text
React route/component
  -> typed module in src/api
    -> Tauri invoke command
      -> validated Rust handler
        -> SQLite row or bounded JSON document
```

Relational tables store ownership and queryable records. Flexible template and map documents are serialized as JSON in SQLite. Backend commands validate identifiers, text sizes, JSON structure, map dimensions, coordinates, collection sizes, and ownership before writing.

## Development

Prerequisites:

- Node.js `^20.19.0` or `>=22.12.0`
- A current stable Rust toolchain
- The platform prerequisites required by Tauri 2

Install and run:

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run check
npm run build
cd src-tauri
cargo test
cargo check
```

`npm run dev:web` starts only Vite. Persistence calls require the Tauri runtime, so use `npm run dev` for functional application testing.

## Local data and security

The database is named `ttrpg-manager.db` and is created in the operating system's Tauri application-data directory. SQLite foreign keys, WAL journaling, a busy timeout, explicit schema versioning, and transactional multi-record operations protect data integrity.

The production webview uses a restrictive content security policy. The application does not request shell, file-system, network, or URL-opener capabilities. Compiled map images are locally generated PNG data URLs and are size-bounded before storage.

Back up the database file before installing experimental builds or making large campaign changes. User-facing export/restore is not implemented yet.

## Audit notes

See [AUDIT.md](./AUDIT.md) for the production-hardening summary, verification record, and known residual risks.
