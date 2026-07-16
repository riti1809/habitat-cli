# Kepler Stream Registration Integration Design

## Goal

Update Habitat registration to consume Kepler's current stream registration contract while preserving existing local Habitat modules. Persist the returned stream credentials and metadata, support the one-time upgrade path for legacy registrations, and expose the stream state through `habitat status`.

## Contract

`POST /habitats/register` receives the habitat display name and UUID and returns:

- `habitatId`
- `streamUrl`
- write-only `apiToken` for the Habitat event stream
- `stream.protocolVersion`
- `stream.subscriptions`
- `stream.currentTick`
- `stream.tickIntervalMs`
- `stream.ticksPerPulse`
- `stream.status`
- existing contracts, starter modules, starter humans, and blueprints

For a pre-Phase-1 registration whose legacy stream token is empty or absent, repeating the original registration request with the stored display name and UUID upgrades the remote record in place. Other duplicate registrations remain errors.

## Storage and migration

Extend `StoredRegistration` and the SQLite `registration` table with the stream URL, stream API token, and stream metadata. The schema migration adds nullable columns to existing databases; readers treat missing values as a legacy registration with no stream token. New writes persist all current stream fields.

The registration row is updated independently during a legacy upgrade. The existing `modules` rows are not deleted, replaced, or rehydrated. New registration continues using the existing atomic registration-plus-starter-module write path.

## Registration flow

The backend's `POST /registration` route will:

1. Validate the requested display name.
2. Read local registration state.
3. If no local registration exists, register normally and persist the complete response while hydrating starter modules.
4. If local registration exists without a stored stream token, call Kepler with the stored display name and UUID, persist the returned registration data in place, and leave modules unchanged.
5. Otherwise return the existing duplicate-registration error.

The returned stream API token is stored as registration state and returned through the local API only for the CLI's status/registration display. `KEPLER_PLANET_TOKEN` remains an environment credential used for Kepler requests; it is never copied into the stream token field and never printed.

## Status output

`habitat status` will continue to fetch and print the remote Habitat status, then print the locally persisted stream values:

- Stream URL
- Stream API token
- Subscriptions
- Registration clock tick (`currentTick`)
- Registration stream status
- Ticks per pulse

The existing Habitat status fields and module count remain available.

## Testing

Regression coverage will verify:

- current-contract registration persists stream fields;
- a legacy registration is upgraded using its stored display name and UUID;
- legacy upgrade preserves pre-existing modules exactly;
- existing SQLite databases migrate without losing registration or module data;
- status output includes all requested stream fields;
- the environment Kepler token is not displayed or substituted for the returned stream token.

