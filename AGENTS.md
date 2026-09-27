# Repository guidelines

## Project layout

- `src/` is the React and TypeScript frontend.
- `src/api/` is the typed boundary for Tauri commands. UI code should use these modules instead
  of calling `invoke` directly.
- `src/features/` contains feature-specific domain and rendering code; reusable UI belongs in
  `src/components/`.
- `src-tauri/` is the conventional Tauri Rust application. Keep this name because the Tauri CLI,
  configuration, and ecosystem tooling expect it.
- `src-tauri/src/commands/` owns IPC handlers. Treat every command argument as untrusted input and
  validate it before reading or writing data.
- `docs/` contains durable project documentation. Generated output belongs outside version control.

## Development workflow

Install exact JavaScript dependencies with `npm ci`, then run the desktop application with
`npm run dev`. Use `npm run dev:web` only for frontend work that does not require persistence or
Tauri commands.

Before committing, run:

```bash
npm run check
npm run build
git diff --check
```

`npm run check` performs TypeScript checking, ESLint, Clippy, Prettier and rustfmt verification, and
Rust tests. Use `npm run format` to apply supported formatters.

## Engineering conventions

- Keep TypeScript strict and avoid `any`. Use PascalCase for React component files, camelCase for
  TypeScript modules and values, and snake_case for Rust modules and functions.
- Keep components focused on presentation and orchestration. Put command payload and response types
  in `src/api/`, shared client state in `src/state/`, and pure feature logic near its feature.
- Preserve the frontend/backend trust boundary. Enforce size limits, ownership, identifiers, and
  data shape in Rust even when the frontend already validates them.
- Use transactions for multi-record writes. Maintain world scoping and foreign-key behavior for all
  persisted data.
- Add or update Rust unit tests for backend validation, migrations, and persistence behavior. Add
  frontend tests when a frontend test harness is introduced; do not replace behavior checks with
  snapshots alone.
- Keep changes narrowly scoped. Do not commit `dist/`, `node_modules/`, `src-tauri/target/`, Tauri
  schema output, editor state, logs, local databases, or secrets.
- Update `README.md`, relevant files under `docs/`, and `AGENTS.md` when commands, architecture, or
  contributor expectations change.

## Git practices

Write imperative, focused commit subjects. Keep generated dependency-lock changes with the manifest
change that produced them. Do not rewrite shared history or bypass checks to make a commit pass.
