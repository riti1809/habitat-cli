# Blueprint Catalog Read-Only CLI Design

## Goal

Add beginner-friendly, read-only Kepler blueprint catalog commands to the `habitat` CLI:

- `habitat blueprint list`
- `habitat blueprint show <blueprint-id>`

The feature must use the documented Kepler blueprint catalog endpoints and the existing CLI environment pattern:

- `KEPLER_PLANET_TOKEN`
- `KEPLER_BASE_URL`

The feature must not change:

- registration state
- module state
- tick state
- battery state
- inventory state

## User Experience

### `habitat blueprint list`

Print a concise table of available blueprints.

The output should be beginner-friendly and easy to scan. The table should prioritize a small number of columns that help a new user understand what exists without dumping raw JSON.

Recommended columns:

- `Blueprint`
- `Name`
- `Ticks`
- `Repeatable`

If a field is missing, print a readable fallback such as `-`.

### `habitat blueprint show <blueprint-id>`

Print readable details for one blueprint.

The output should be structured as labeled lines and short sections rather than raw JSON. The detail view should include:

- blueprint id
- display name
- description
- build ticks
- repeatable
- inputs
- output
- required facility
- prerequisites
- unlocks
- capabilities

Only print sections that exist in the returned blueprint payload.

### Friendly errors

If a requested blueprint does not exist, the CLI should print a friendly error like:

`Blueprint "<blueprint-id>" was not found.`

This should replace a raw API failure body or an unhelpful fetch error.

Other API or auth failures should still be readable and concise.

## API Integration

Use the documented Kepler endpoints:

- `GET /catalog/blueprints`
- `GET /catalog/blueprints/{blueprintId}`

Use the existing Kepler base URL and bearer token pattern already used by the CLI.

The implementation should:

- send `Authorization: Bearer <token>`
- default to the configured default base URL when `KEPLER_BASE_URL` is unset
- parse JSON responses into focused TypeScript types
- map HTTP status codes into CLI-friendly errors

## Code Structure

Follow the repo instruction to keep the CLI entrypoint focused on orchestration.

Recommended structure:

- `src/cli.ts`
  - command wiring
  - calling the blueprint client
  - formatting output or delegating to small formatting helpers
- new Kepler client module
  - HTTP requests
  - response validation
  - friendly error mapping

If formatting grows beyond a few helpers, extract it into a small display module.

## Read-Only Guarantees

The blueprint commands must not:

- write `.habitat/registration.json`
- write `.habitat/modules.json`
- hydrate starter modules
- run ticks
- update runtime attributes
- modify any local inventory representation

The commands are strictly remote read operations plus console output.

## Testing

Add tests with mocked Kepler responses.

Required coverage:

- `blueprint list` prints a concise table for a successful catalog response
- `blueprint show <blueprint-id>` prints readable detail output for a successful single-blueprint response
- `blueprint show <blueprint-id>` prints a friendly not-found error for a `404` response
- blueprint commands do not create or modify local habitat state files during execution

The tests should follow the repo's existing CLI test style and invoke the CLI with a mocked HTTP server or equivalent request interception.

## Non-Goals

This work does not add:

- blueprint caching
- local blueprint persistence
- blueprint editing
- module construction from blueprints
- resource or inventory simulation
- support for other catalog surfaces like modules, resources, or site types
