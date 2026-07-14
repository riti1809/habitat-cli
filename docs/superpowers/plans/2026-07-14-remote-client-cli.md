# Remote Client CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the laptop `habitat` CLI act as a remote client that talks to the OpenClaw server for registration, module, inventory, construction, and tick state instead of reading the laptop's SQLite database.

**Architecture:** Keep the server as the source of truth. Extend the server with registration write/delete endpoints and a bulk module replace route, then switch the CLI's stateful commands to call those HTTP endpoints through `HABITAT_API_BASE_URL`. The local SQLite file stays on the server only.

**Tech Stack:** TypeScript, Bun, Hono, Commander, node:test

## Global Constraints

- Prefer TypeScript for new JavaScript or TypeScript projects.
- Prefer Bun over npm when the project supports it.
- Keep entrypoint files focused on orchestration, not implementation details.
- Prefer small, named functions over large inline handlers.
- Do not read or write the laptop's SQLite database from the CLI once the remote client flow is in place.

---

### Task 1: Add server-side registration and bulk module routes

**Files:**
- Modify: `src/server.ts`
- Test: `tests/server-registration.test.ts`
- Test: `tests/backend-state.test.ts`

**Interfaces:**
- Consumes: `StoredRegistration`, `HabitatModule`, `hydrateModulesFromStarterModules`, `writeRegistration`, `deleteRegistration`, `deleteModules`, `writeModules`
- Produces: `POST /registration`, `DELETE /registration`, and `PUT /modules` on the Hono app

- [ ] **Step 1: Write the failing tests**

```ts
test("POST /registration stores a registration and hydrates starter modules", async () => {
  // ...
});

test("DELETE /registration clears stored registration and modules", async () => {
  // ...
});

test("PUT /modules replaces the full module list", async () => {
  // ...
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/server-registration.test.ts tests/backend-state.test.ts`

Expected: the new tests fail because the routes do not exist yet.

- [ ] **Step 3: Implement the server routes**

```ts
app.post("/registration", async (c) => {
  // parse { displayName }
  // call Kepler register
  // persist registration and starter modules
  // return the stored registration envelope
});

app.delete("/registration", async (c) => {
  // delete registration from Kepler
  // clear local registration and modules
  // return 204
});

app.put("/modules", async (c) => {
  // replace the full module array
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/server-registration.test.ts tests/backend-state.test.ts`

Expected: all tests pass.

### Task 2: Switch CLI stateful commands to the server API

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/local-api.ts`
- Test: `tests/local-api.test.ts`

**Interfaces:**
- Consumes: `requestJson`, `listModules`, `getModule`, `createModule`, `updateModule`, `deleteModule`, `getInventory`, `setInventory`
- Produces: remote-first registration, module, inventory, construction, and tick behavior through `HABITAT_API_BASE_URL`

- [ ] **Step 1: Write the failing tests**

```ts
test("remote state helpers call the server instead of reading SQLite", async () => {
  // ...
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/local-api.test.ts`

Expected: the new coverage fails because the CLI still reads local SQLite.

- [ ] **Step 3: Implement the CLI and client changes**

```ts
// CLI registration/status/unregister use server endpoints.
// Module, inventory, construction, and tick commands load modules from the server,
// apply the existing local simulation logic, and write the updated modules back
// through the server API.
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/local-api.test.ts`

Expected: the remote client coverage passes.

### Task 3: Update help text and verify the remote workflow end to end

**Files:**
- Modify: `src/cli.ts`
- Test: manual shell verification

**Interfaces:**
- Produces: help text and status output that describe remote server-backed state instead of laptop SQLite

- [ ] **Step 1: Refresh help copy**

```ts
// Update descriptions to talk about remote/server-backed state.
```

- [ ] **Step 2: Verify the remote workflow manually**

Run:
```bash
cd ~/habitat-cli
set -a
source .env
set +a
habitat status
```

Expected: the output reports the Habitat running on the OpenClaw server.

- [ ] **Step 3: Commit the finished change**

```bash
git add src/server.ts src/cli.ts src/local-api.ts tests/server-registration.test.ts tests/backend-state.test.ts tests/local-api.test.ts docs/superpowers/plans/2026-07-14-remote-client-cli.md
git commit -m "feat: make habitat CLI remote-first"
```
