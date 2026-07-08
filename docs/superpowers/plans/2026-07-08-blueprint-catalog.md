# Blueprint Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add beginner-friendly, read-only `habitat blueprint list` and `habitat blueprint show <blueprint-id>` commands backed by the documented Kepler blueprint catalog endpoints.

**Architecture:** Keep `src/cli.ts` responsible for command wiring and console output while moving Kepler HTTP access and response validation into a focused client module. Format list output as a compact table and show output as labeled sections, with friendly 404 handling and no writes to local habitat state.

**Tech Stack:** TypeScript, Bun runtime, Commander, Node test runner, `tsx`, built-in `fetch`

## Global Constraints

- Use the documented Kepler blueprint catalog endpoints.
- Use the existing CLI environment pattern: `KEPLER_PLANET_TOKEN` and `KEPLER_BASE_URL`.
- Do not change registration state, module state, tick state, battery state, or inventory state.
- `habitat blueprint list` prints a concise table of available blueprints.
- `habitat blueprint show <blueprint-id>` prints readable details for one blueprint.
- Missing blueprints produce a friendly error instead of a raw API failure.
- The implementation includes tests with mocked Kepler responses.

---

### Task 1: Add failing CLI tests for blueprint catalog behavior

**Files:**
- Modify: `tests/power-tick.test.ts`

**Interfaces:**
- Consumes: existing CLI entrypoint `src/cli.ts`
- Produces: failing tests for `habitat blueprint list` and `habitat blueprint show <blueprint-id>`

- [ ] **Step 1: Write the failing test**

```ts
test("habitat blueprint list prints a concise blueprint table", () => {
  // Start a temporary mock HTTP server that returns a blueprint catalog payload.
  // Run `habitat blueprint list` with KEPLER_BASE_URL and KEPLER_PLANET_TOKEN.
  // Assert status 0 and table content for blueprint id, display name, ticks, and repeatable.
});

test("habitat blueprint show prints readable details for one blueprint", () => {
  // Start a temporary mock HTTP server that returns one blueprint payload.
  // Run `habitat blueprint show survey-rover`.
  // Assert status 0 and labeled sections for description, inputs, outputs, and unlocks.
});

test("habitat blueprint show prints a friendly error for a missing blueprint", () => {
  // Start a temporary mock HTTP server that returns HTTP 404.
  // Run `habitat blueprint show missing-blueprint`.
  // Assert exit status 1 and stderr contains `Blueprint "missing-blueprint" was not found.`
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/power-tick.test.ts`

Expected: FAIL because the `blueprint` command surface does not exist yet.

- [ ] **Step 3: Extend the tests to verify read-only behavior**

```ts
assert.equal(existsSync(join(habitatDir, "registration.json")), false);
assert.equal(existsSync(join(habitatDir, "modules.json")), false);
```

- [ ] **Step 4: Run test to verify it still fails for the expected reason**

Run: `node --import tsx --test tests/power-tick.test.ts`

Expected: FAIL on missing `blueprint` behavior, not because the test harness is broken.

- [ ] **Step 5: Commit**

```bash
git add tests/power-tick.test.ts
git commit -m "test: add failing blueprint catalog cli coverage"
```

### Task 2: Implement Kepler blueprint catalog client

**Files:**
- Create: `src/kepler-blueprints.ts`

**Interfaces:**
- Consumes: `KEPLER_PLANET_TOKEN`, `KEPLER_BASE_URL`
- Produces:
  - `type BlueprintSummary`
  - `type BlueprintDetail`
  - `async function listBlueprints(baseUrl?: string): Promise<BlueprintSummary[]>`
  - `async function getBlueprint(blueprintId: string, baseUrl?: string): Promise<BlueprintDetail>`

- [ ] **Step 1: Write the minimal type and fetch wrappers needed by the failing tests**

```ts
export type BlueprintSummary = {
  blueprintId: string;
  displayName: string;
  buildTicks?: number;
  repeatable?: boolean;
};

export type BlueprintDetail = BlueprintSummary & {
  description?: string;
  inputs?: Record<string, unknown>;
  output?: Record<string, unknown>;
  requiredFacility?: Record<string, unknown>;
  prerequisites?: string[];
  unlocks?: string[];
  capabilities?: string[];
};
```

- [ ] **Step 2: Implement shared auth and JSON handling**

```ts
function getPlanetToken(): string {
  const token = process.env.KEPLER_PLANET_TOKEN;
  if (!token) {
    throw new Error("KEPLER_PLANET_TOKEN is required.");
  }
  return token;
}
```

- [ ] **Step 3: Implement list and show requests against the documented endpoints**

```ts
await fetch(`${baseUrl}/catalog/blueprints`, { headers: { Authorization: `Bearer ${token}` } });
await fetch(`${baseUrl}/catalog/blueprints/${encodeURIComponent(blueprintId)}`, { headers: { Authorization: `Bearer ${token}` } });
```

- [ ] **Step 4: Map 404 to a friendly not-found error**

```ts
if (response.status === 404) {
  throw new Error(`Blueprint "${blueprintId}" was not found.`);
}
```

- [ ] **Step 5: Run test to verify progress**

Run: `node --import tsx --test tests/power-tick.test.ts`

Expected: FAIL because CLI wiring and output formatting are still missing, but failures should now be farther along.

- [ ] **Step 6: Commit**

```bash
git add src/kepler-blueprints.ts
git commit -m "feat: add kepler blueprint catalog client"
```

### Task 3: Wire blueprint commands and beginner-friendly output

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes:
  - `listBlueprints(baseUrl?: string): Promise<BlueprintSummary[]>`
  - `getBlueprint(blueprintId: string, baseUrl?: string): Promise<BlueprintDetail>`
- Produces:
  - `habitat blueprint list`
  - `habitat blueprint show <blueprint-id>`

- [ ] **Step 1: Add a `blueprint` command group beside the existing command groups**

```ts
const blueprintCommand = program
  .command("blueprint")
  .description("Inspect official Kepler blueprint catalog entries.");
```

- [ ] **Step 2: Add `blueprint list`**

```ts
blueprintCommand
  .command("list")
  .description("List official Kepler blueprints.")
  .action(async () => {
    const blueprints = await listBlueprints();
    console.log(formatBlueprintTable(blueprints));
  });
```

- [ ] **Step 3: Add `blueprint show <blueprint-id>`**

```ts
blueprintCommand
  .command("show")
  .description("Show one official Kepler blueprint.")
  .argument("<blueprint-id>", "Blueprint ID")
  .action(async (blueprintId: string) => {
    const blueprint = await getBlueprint(blueprintId);
    console.log(formatBlueprintDetail(blueprint));
  });
```

- [ ] **Step 4: Add focused formatting helpers in `src/cli.ts`**

```ts
function formatBlueprintTable(blueprints: BlueprintSummary[]): string { /* compact columns */ }
function formatBlueprintDetail(blueprint: BlueprintDetail): string { /* labeled sections */ }
```

- [ ] **Step 5: Ensure command errors flow through existing CLI-friendly error handling**

```ts
.action(async () => {
  try {
    // command body
  } catch (error) {
    printError(error);
    process.exit(1);
  }
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --import tsx --test tests/power-tick.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/power-tick.test.ts
git commit -m "feat: add read-only blueprint catalog commands"
```

### Task 4: Run broader verification

**Files:**
- No code changes required unless verification exposes a defect

**Interfaces:**
- Consumes: completed CLI and tests
- Produces: verified read-only blueprint catalog behavior

- [ ] **Step 1: Run the full test suite**

Run: `node --import tsx --test tests/**/*.test.ts`

Expected: PASS

- [ ] **Step 2: Run type-checking**

Run: `bun run check`

Expected: PASS

- [ ] **Step 3: Manually inspect help text for discoverability**

Run: `bun run src/cli.ts --help`

Expected: output includes the new `blueprint` command group without regressing existing command descriptions.

- [ ] **Step 4: Commit any verification-driven fixes**

```bash
git add src/cli.ts src/kepler-blueprints.ts tests/power-tick.test.ts
git commit -m "chore: verify blueprint catalog cli behavior"
```
