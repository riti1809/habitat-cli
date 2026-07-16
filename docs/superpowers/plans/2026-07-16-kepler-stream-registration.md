# Kepler Stream Registration Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Kepler's current stream credentials and metadata, upgrade legacy registrations in place without changing local modules, and display the stream state in `habitat status`.

**Architecture:** Keep the existing `StoredRegistration` and SQLite registration row as the source of local registration truth. Add nullable stream columns with a schema migration, parse the current Kepler registration response at the backend boundary, and use a registration-only update for legacy upgrades so the `modules` table is untouched. Keep `KEPLER_PLANET_TOKEN` as the outbound Kepler credential only.

**Tech Stack:** TypeScript, Bun SQLite, Hono, Node test runner, Commander CLI.

## Global Constraints

- Use Bun wrappers/scripts for tests and checks; do not use npm commands.
- Persist `streamUrl`, returned `apiToken`, and all returned stream metadata.
- A legacy registration without a stream token is upgraded with its stored display name and UUID.
- Legacy upgrade must not delete, recreate, replace, or rehydrate local Habitat modules.
- `habitat status` must show stream URL, stream API token, subscriptions, current registration clock tick and status, and ticks per pulse.
- Never display or substitute `KEPLER_PLANET_TOKEN`.

---

### Task 1: Add stream types and SQLite persistence migration

**Files:**
- Modify: `src/habitat-store.ts`
- Modify: `src/habitat-state-db.ts`
- Test: `tests/server-registration.test.ts`

**Interfaces:**
- Produce `StreamRegistrationMetadata` and optional `StoredRegistration.streamUrl`, `apiToken`, and `stream` fields for legacy compatibility.
- Produce `writeRegistration` support for updating one registration row without touching `modules`.

- [ ] **Step 1: Write failing persistence tests**

Add a current registration fixture containing `streamUrl`, `apiToken`, and `stream`, assert `writeRegistration`/`readRegistration` round-trips them, and add a legacy fixture/database assertion that an existing registration and module remain present after schema initialization.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
node scripts/run-bun-test.mjs tests/server-registration.test.ts
```

Expected: failures show the new stream fields are not represented/persisted.

- [ ] **Step 3: Implement the minimal storage changes**

Add the stream type and runtime validation, add nullable SQLite columns for `stream_url`, `api_token`, and `stream_json`, migrate existing databases with `ALTER TABLE ... ADD COLUMN`, and update registration row reads/writes. Preserve the existing transaction behavior for new registration and use the existing registration-only write path for upgrades.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
node scripts/run-bun-test.mjs tests/server-registration.test.ts
```

Expected: the new persistence/migration assertions pass.

- [ ] **Step 5: Commit the storage slice**

```bash
git add src/habitat-store.ts src/habitat-state-db.ts tests/server-registration.test.ts
git commit -m "feat: persist Kepler stream registration state"
```

### Task 2: Implement current registration and legacy in-place upgrade

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/server-registration.test.ts`

**Interfaces:**
- Consume `StoredRegistration` stream fields and registration-only persistence from Task 1.
- Produce `POST /registration` behavior that distinguishes new, legacy, and current local registrations.

- [ ] **Step 1: Write failing route tests**

Extend the mocked `POST /habitats/register` response with current stream fields. Assert new registration persists and returns them. Add a legacy registration plus a pre-existing module, post a registration request with any incoming display name, assert Kepler receives the stored display name and UUID, and assert the module list is byte-for-byte/equivalently unchanged.

- [ ] **Step 2: Run the route tests and verify the expected failure**

Run:

```bash
node scripts/run-bun-test.mjs tests/server-registration.test.ts
```

Expected: the new response shape fails validation or the existing-registration conflict is returned instead of the upgrade.

- [ ] **Step 3: Implement minimal route behavior**

Validate `streamUrl`, `apiToken`, `stream`, and the existing registration payload. On a new registration, keep the current atomic `writeRegistrationAndModules` flow. On a stored registration with no non-empty `apiToken`, call `POST /habitats/register` using `existingRegistration.displayName` and `existingRegistration.habitatUuid`, then call only `writeRegistration` with the returned registration data while preserving its original `registeredAt` and existing local modules. Keep the duplicate 409 for registrations that already have a stream token. Do not use `getApiToken` as the persisted stream token.

- [ ] **Step 4: Run the route tests and verify they pass**

Run:

```bash
node scripts/run-bun-test.mjs tests/server-registration.test.ts
```

Expected: new registration and legacy upgrade tests pass, including module preservation and request-body assertions.

- [ ] **Step 5: Commit the registration slice**

```bash
git add src/server.ts tests/server-registration.test.ts
git commit -m "feat: upgrade legacy Kepler registrations in place"
```

### Task 3: Display persisted stream state in status without leaking the environment token

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/local-api.ts`
- Modify: `tests/power-tick.test.ts`

**Interfaces:**
- Consume the persisted stream fields from `StoredRegistration` and the local registration API response.
- Produce status output containing the six requested stream values and no `KEPLER_PLANET_TOKEN` value.

- [ ] **Step 1: Write failing CLI status tests**

Use a mocked registration response and status response to assert `habitat status` prints the stream URL, returned stream API token, subscriptions, current tick, stream status, and ticks per pulse. Set `KEPLER_PLANET_TOKEN` to a different sentinel and assert that sentinel is absent from stdout.

- [ ] **Step 2: Run the status test and verify the expected failure**

Run:

```bash
node scripts/run-bun-test.mjs tests/power-tick.test.ts
```

Expected: the requested stream fields are absent from status output.

- [ ] **Step 3: Implement status formatting and response typing**

Make the local API registration response permit the persisted optional stream fields, print the returned `registration.apiToken` and stream metadata in `printStatus`, and leave Kepler request authentication sourced from the environment. Do not print environment variables directly.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node scripts/run-bun-test.mjs tests/power-tick.test.ts
```

Expected: the status assertions pass and the environment-token sentinel is absent.

- [ ] **Step 5: Commit the status slice**

```bash
git add src/cli.ts src/local-api.ts tests/power-tick.test.ts
git commit -m "feat: show Kepler stream state in habitat status"
```

### Task 4: Full verification and review

**Files:**
- Test: `tests/server-registration.test.ts`
- Test: `tests/power-tick.test.ts`
- Modify: any implementation files only if verification finds a defect.

- [ ] **Step 1: Run type/check verification**

```bash
node scripts/run-bun-command.mjs run check
```

- [ ] **Step 2: Run all tests**

```bash
node scripts/run-bun-test.mjs
```

- [ ] **Step 3: Run the production build**

```bash
node scripts/run-bun-command.mjs run build
```

- [ ] **Step 4: Inspect the final diff and verify requirements line by line**

```bash
git diff HEAD~3..HEAD --check
git status --short
```

Confirm stream fields are persisted, legacy modules are untouched, status prints only the returned stream token, and `KEPLER_PLANET_TOKEN` is not printed or copied.

