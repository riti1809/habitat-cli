# Construction Advancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advance construction jobs during `habitat tick`, complete output modules when jobs finish, and keep construction stalled when the fabricator is effectively unpowered.

**Architecture:** Keep `tick` as the single driver of elapsed time, but teach the construction workflow to inspect and mutate fabricator jobs after a successful tick. Add small focused helpers in `src/construction.ts` for progressing jobs, finalizing finished jobs into real modules, and deciding whether a fabricator can advance while unpowered. Keep `src/cli.ts` thin: it should trigger ticking and print a completion message when construction finishes.

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

### Task 1: Red tests for construction progression

**Files:**
- Modify: `tests/power-tick.test.ts`

**Interfaces:**
- Consumes: `runCliSync`, `runCli`, local `.habitat/modules.json`, local `.habitat/registration.json`
- Produces: failing tests that describe tick-driven construction completion, status reporting, and power-gated stalling

- [ ] **Step 1: Write the failing tests**

```ts
test("habitat tick completes construction and creates the output module", () => {
  // setup: registration, fabricator with a constructionJob, supply cache inventory
  // run: habitat tick 1, habitat construction status, habitat tick 179, habitat module list, habitat module show small-solar-array-1
  // assert: first tick reports completion, construction status is empty, module list includes the new module, module show returns the built module
});

test("habitat tick does not advance construction when the fabricator is unpowered", () => {
  // setup: fabricator status offline with a constructionJob remainingTicks > 0
  // run: habitat tick 1
  // assert: remainingTicks unchanged and no completion message is printed
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `node --import tsx --test tests/power-tick.test.ts -t "habitat tick completes construction|habitat tick does not advance construction"`
Expected: fail with missing construction advancement behavior, not syntax errors.

- [ ] **Step 3: Keep the tests aligned with the current CLI surface**

If the existing `construction status` command output needs a minor adjustment to support the new assertions, update the test text only, not production code.

### Task 2: Construction tick progression and finalization

**Files:**
- Modify: `src/construction.ts`
- Modify: `src/habitat-store.ts`

**Interfaces:**
- Consumes: `HabitatModule`, `ConstructionJob`, `readModules`, `writeModules`
- Produces: `advanceConstructionJobs(modules, ticks)` and `finalizeConstructionJob(...)` helpers that can be called from tick processing

- [ ] **Step 1: Add failing unit-level behavior through the existing tests**

Write the minimal helpers inside `src/construction.ts` only after the tests above fail for the right reason. The new helpers should:

```ts
type ConstructionAdvanceResult = {
  modules: HabitatModule[];
  completedBlueprintIds: string[];
};

function canAdvanceConstruction(module: HabitatModule): boolean;
function advanceConstructionJobs(modules: HabitatModule[], ticks: number): ConstructionAdvanceResult;
function finalizeConstructionJob(fabricator: HabitatModule): HabitatModule[];
```

- [ ] **Step 2: Implement power-sensitive advancement**

Advance `remainingTicks` only when the fabricator is effectively powered. Use the fabricator’s current runtime status and current power draw logic already established in the repo. When a job reaches zero, create the output module immediately, remove the job from the fabricator, and leave the fabricator available again.

- [ ] **Step 3: Materialize the finished module**

Create the output module from the stored future job data using the same module record shape used for hydrated starter modules:

```ts
const completedModule: HabitatModule = {
  id: job.outputModuleId,
  alias: job.outputModuleType,
  blueprintId: job.blueprintId,
  moduleType: job.outputModuleType,
  displayName: blueprint.displayName,
  connectedTo: [],
  runtimeAttributes: job.futureRuntimeAttributes,
  capabilities: job.futureCapabilities,
  constructionStatus: "built",
  source: "local",
  createdAt: completedAt,
  updatedAt: completedAt,
};
```

- [ ] **Step 4: Run the targeted tests again**

Run: `node --import tsx --test tests/power-tick.test.ts -t "habitat tick completes construction|habitat tick does not advance construction"`
Expected: PASS.

### Task 3: Wire construction advancement into `tick`

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/construction.ts`

**Interfaces:**
- Consumes: `runPowerTicks`, `readHydratedModules`, `writeModules`, `advanceConstructionJobs`
- Produces: `tick` that advances construction after power ticks complete and prints a completion summary line

- [ ] **Step 1: Update the tick workflow**

In `src/cli.ts`, after `runPowerTicks(...)` succeeds, call the construction advancement helper on the resulting modules and persist the returned module list.

```ts
const powerResult = runPowerTicks(modules, ticks);
const constructionResult = advanceConstructionJobs(powerResult.modules, ticks);
writeModules(constructionResult.modules);
```

- [ ] **Step 2: Print a completion message**

If any construction jobs completed on that tick, print a short line such as:

```ts
console.log(`Completed construction: ${completedBlueprintIds.join(", ")}`);
```

- [ ] **Step 3: Keep the command output readable**

Do not add JSON output. Keep the tick command’s terminal summary concise and human-readable.

- [ ] **Step 4: Run the full targeted test file**

Run: `node --import tsx --test tests/power-tick.test.ts`
Expected: PASS.

### Task 4: Verify the full path and help surface

**Files:**
- Modify: `src/cli.ts` only if help text needs a small adjustment

**Interfaces:**
- Consumes: `habitat tick`, `habitat construction status`, `habitat module list`, `habitat module show`
- Produces: stable terminal workflow for the user’s requested sequence

- [ ] **Step 1: Verify the requested scenario end to end**

Run:

```bash
habitat tick 1
habitat construction status
habitat tick 179
habitat module list
habitat module show small-solar-array-1
```

If `habitat` is not on PATH in the current shell, use `node --import tsx src/cli.ts ...` with the same arguments.

- [ ] **Step 2: Run typecheck**

Run: `npm run check`
Expected: PASS.

