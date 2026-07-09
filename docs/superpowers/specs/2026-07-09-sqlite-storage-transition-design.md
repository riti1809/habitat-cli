# SQLite Storage Transition Design

## Goal

Move local `registration` and `modules` persistence from JSON files to Bun SQLite while keeping the CLI behavior and terminal output understandable and stable.

## Approved Scope

- Replace local JSON persistence for registration and modules with SQLite.
- Keep Kepler fetch behavior unchanged.
- Keep the current CLI command surface unchanged.
- Ignore existing `.habitat/registration.json` and `.habitat/modules.json` during normal operation unless the user explicitly asks for migration later.
- Do not add migration commands in this step.
- Do not add a new storage inspection command in this step.

## Non-Goals

- No JSON-to-SQLite migration flow yet.
- No schema normalization for inventory, construction jobs, or module connections yet.
- No changes to blueprint, resource, or solar command behavior.
- No changes to user-facing command names or help text beyond any necessary storage path updates.

## Current Problem

The current local storage layer uses two JSON files:

- `.habitat/registration.json`
- `.habitat/modules.json`

That layout works for simple persistence, but more commands now mutate local state:

- registration
- module CRUD
- inventory updates
- construction jobs
- tick-driven simulation

The project needs a durable database-backed local state layer, but the first transition should stay small and keep terminal behavior easy to follow.

## Chosen Approach

Keep the public storage API centered in `src/habitat-store.ts`, but reimplement it on top of Bun SQLite.

This is the smallest useful cutover because:

- the CLI surface stays stable
- most command orchestration can remain unchanged
- feature modules can keep working with in-memory `HabitatModule[]`
- the migration is real, not partial, because both registration and modules move to SQLite immediately

## Storage Layout

### Database File

- `.habitat/state.sqlite`

### Tables

#### `registration`

Single-row style table for the active local habitat registration.

Columns:

- `habitat_uuid TEXT PRIMARY KEY`
- `habitat_id TEXT NOT NULL`
- `display_name TEXT NOT NULL`
- `base_url TEXT NOT NULL`
- `registered_at TEXT NOT NULL`
- `starter_modules_json TEXT NOT NULL`
- `blueprints_json TEXT NOT NULL`
- `last_status_json TEXT`

Notes:

- This preserves the current `StoredRegistration` shape.
- `starterModules` and `blueprints` remain stored as JSON snapshots for now because the CLI still uses them as registration-time cached data.

#### `modules`

One row per local module.

Columns:

- `id TEXT PRIMARY KEY`
- `alias TEXT NOT NULL UNIQUE`
- `blueprint_id TEXT NOT NULL`
- `module_type TEXT NOT NULL`
- `display_name TEXT NOT NULL`
- `connected_to_json TEXT NOT NULL`
- `runtime_attributes_json TEXT NOT NULL`
- `capabilities_json TEXT NOT NULL`
- `construction_status TEXT NOT NULL`
- `source TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `construction_job_json TEXT`

Notes:

- Inventory remains embedded under `runtime_attributes_json` because the current design stores inventory on the `supply-cache` module.
- Construction jobs remain embedded under `construction_job_json` because the first step is storage cutover, not schema redesign.

## Behavior

### Registration Commands

`habitat register`

- writes one registration row
- replaces existing module rows with hydrated starter modules from Kepler

`habitat status`

- reads registration from SQLite
- fetches live Kepler registration status
- updates cached `last_status_json`

`habitat unregister`

- keeps the current remote unregister behavior
- deletes all local registration state from SQLite
- deletes all local module state from SQLite

### Module Commands

These commands will read and write SQLite-backed modules through `src/habitat-store.ts`:

- `habitat module create`
- `habitat module list`
- `habitat module show`
- `habitat module update`
- `habitat module delete`
- `habitat module status`
- `habitat module set-status`

### Inventory, Construction, and Tick Commands

These commands continue to operate on `HabitatModule[]` in memory, but the source of truth becomes SQLite-backed module rows:

- `habitat inventory list`
- `habitat inventory add`
- `habitat construction status`
- `habitat construction cancel`
- `habitat construct <blueprint-id>`
- `habitat tick <ticks>`

### Read-Only Kepler Commands

These remain remote reads and should not mutate local SQLite state:

- `habitat blueprint list`
- `habitat blueprint show`
- `habitat resource list`
- `habitat solar status`

## Implementation Plan

### 1. Add SQLite helper module

Create a focused module for:

- computing the database path
- ensuring the `.habitat` directory exists
- opening the Bun SQLite database
- running schema creation

This helper should not contain habitat business logic.

### 2. Reimplement `src/habitat-store.ts`

Keep the exported API stable where practical:

- `getRegistrationFilePath`
- `getModulesFilePath`
- `readRegistration`
- `writeRegistration`
- `deleteRegistration`
- `readModules`
- `writeModules`
- `deleteModules`
- `hydrateModulesFromStarterModules`

Adjust the path helpers so they return storage-relevant paths for the new SQLite layout. If needed, add a dedicated database path helper for terminal output and future debugging.

### 3. Centralize serialization

Add explicit mappers between:

- SQLite rows and `StoredRegistration`
- SQLite rows and `HabitatModule`

This protects the rest of the codebase from SQL-specific field names and JSON parsing details.

### 4. Keep feature logic unchanged where possible

Avoid refactoring `src/construction.ts` and `src/habitat-inventory.ts` beyond what is necessary to keep them working with the updated store.

### 5. Warn about ignored legacy JSON

If `.habitat/registration.json` or `.habitat/modules.json` exists while SQLite has no registration or modules yet, print a short warning on storage-backed command execution that legacy JSON files are being ignored.

The warning should be brief and terminal-friendly.

## Error Handling

- Ensure schema creation runs automatically when opening the database.
- Fail fast if stored JSON columns cannot be parsed into valid runtime types.
- Preserve current command-level error behavior where possible.
- Keep "no local registration found" and "module not found" style messages understandable from the terminal.

## Testing

Add or update tests for:

- writing and reading registration from SQLite
- writing and reading modules from SQLite
- unregister cleanup behavior
- hydration behavior after registration
- empty-state reads
- any legacy warning behavior that is easy to verify

Tests should use isolated temporary `.habitat/state.sqlite` files rather than the real workspace database.

## Risks

### Hidden JSON assumptions

Inventory and construction state are nested inside module payloads. A bad serializer/deserializer could silently lose state.

Mitigation:

- central row mappers
- targeted storage tests

### Partial schema or first-run issues

If the database file exists but tables do not, commands could fail in confusing ways.

Mitigation:

- ensure schema on open

### User confusion from ignored JSON

Users may still have `.habitat/*.json` files and expect them to be active.

Mitigation:

- short warning when legacy JSON exists but is no longer authoritative

### Bun availability in this shell

This workspace is Bun-oriented, but Bun is not currently available on this shell PATH.

Mitigation:

- implement against Bun SQLite as requested
- be explicit if local verification must be limited or deferred to a Bun-enabled shell

## Success Criteria

- Local registration state is stored in `.habitat/state.sqlite`, not JSON.
- Local module state is stored in `.habitat/state.sqlite`, not JSON.
- Existing CLI commands continue to behave the same from the terminal.
- Blueprint, resource, and solar commands remain read-only and Kepler-backed.
- The codebase has a cleaner local-state boundary for later normalization or migration work.
