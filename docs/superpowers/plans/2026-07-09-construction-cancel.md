# Construction Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `habitat construction cancel <fabricator-id-or-alias>` and a terminal-readable `habitat inventory list` that show and clear active construction jobs without refunding spent materials.

**Architecture:** Keep cancellation focused on the fabricator record in `.habitat/modules.json`. Add a small construction helper that clears a job and returns a user-facing cancellation summary, while the CLI stays responsible for parsing arguments and printing readable status. Inventory listing should read the supply cache inventory and render it as a concise table so users can confirm materials remain spent after cancellation.

**Tech Stack:** TypeScript, Bun, Commander, node:test, local `.habitat/modules.json` persistence.

## Global Constraints

- Prefer TypeScript for new JavaScript or TypeScript projects.
- Prefer Bun over npm when the project supports it.
- Keep entrypoint files focused on orchestration, not implementation details.
- Put command wiring, route setup, or app bootstrapping in the entrypoint.
- Move domain logic into focused modules with clear names.
- Move file, database, or persistence logic into dedicated storage or state modules.
- Keep shared types in explicit type files when they are used across modules.
- Use the project’s existing TypeScript patterns, test style, and package manager.

---

### Task 1: Red tests for cancellation and inventory listing

**Files:**
- Modify: `tests/power-tick.test.ts`

**Interfaces:**
- Consumes: `runCli`, `runCliSync`, local `.habitat/modules.json`
- Produces: failing tests that describe cancel behavior and inventory listing output

- [ ] **Step 1: Write the failing tests**

```ts
test("habitat construction cancel clears the job without refunding inventory", () => {
  // setup: active fabricator job, supply cache inventory, registration
  // run: habitat construction cancel workshop-fabricator-1
  // assert: fabricator has no constructionJob, status is online, inventory stays reduced, no output module exists
});

test("habitat inventory list prints the supply cache inventory", () => {
  // setup: supply cache inventory in modules.json
  // run: habitat inventory list
  // assert: terminal-readable table includes resource names and quantities
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `node --import tsx --test tests/power-tick.test.ts -t "habitat construction cancel|habitat inventory list"`
Expected: fail because the commands do not exist yet.

### Task 2: Cancellation helper and inventory table

**Files:**
- Modify: `src/construction.ts`
- Modify: `src/habitat-inventory.ts`

**Interfaces:**
- Consumes: `HabitatModule`, `readHydratedModules`, `writeModules`, supply-cache inventory helpers
- Produces: `cancelConstructionJob(modules, moduleId)` and `formatInventoryTable(modules)`

- [ ] **Step 1: Implement cancel behavior**

```ts
type ConstructionCancelResult = {
  modules: HabitatModule[];
  cancelledBlueprintId: string;
  fabricatorAlias: string;
};

function cancelConstructionJob(modules: HabitatModule[], moduleId: string): ConstructionCancelResult;
```

- [ ] **Step 2: Implement inventory listing**

```ts
function formatInventoryTable(modules: HabitatModule[]): string;
```

The output should be readable from the terminal and should show the supply cache’s stored resource quantities.

- [ ] **Step 3: Run the targeted tests again**

Run: `node --import tsx --test tests/power-tick.test.ts -t "habitat construction cancel|habitat inventory list"`
Expected: PASS.

### Task 3: Wire CLI commands

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `cancelConstructionJob`, `formatInventoryTable`, `readHydratedModules`, `writeModules`
- Produces: `habitat construction cancel <fabricator-id-or-alias>` and `habitat inventory list`

- [ ] **Step 1: Add the command handlers**

```ts
constructionCommand.command("cancel").argument("<fabricator-id-or-alias>").action(...)
inventoryCommand.command("list").action(...)
```

- [ ] **Step 2: Print clear messages**

Cancellation should report which fabricator was cleared and that materials were not refunded.

- [ ] **Step 3: Run the full test file**

Run: `node --import tsx --test tests/power-tick.test.ts`
Expected: PASS.

### Task 4: Verify the requested terminal flow

**Files:**
- None beyond the CLI wiring above

**Interfaces:**
- Consumes: `habitat construct`, `habitat construction status`, `habitat construction cancel`, `habitat inventory list`, `habitat module list`
- Produces: the requested readable terminal flow

- [ ] **Step 1: Run the exact scenario**

Run:

```bash
habitat construct small-solar-array
habitat construction status
habitat construction cancel workshop-fabricator-1
habitat construction status
habitat inventory list
habitat module list
```

- [ ] **Step 2: Run typecheck**

Run: `npm run check`
Expected: PASS.

