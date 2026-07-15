import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeModules, writeRegistration, type HabitatModule, type StoredRegistration } from "../src/habitat-store.ts";
import { createBackendApp } from "../src/server.ts";

function tempHabitat() {
  const cwd = mkdtempSync(join(tmpdir(), "habitat-human-move-"));
  mkdirSync(join(cwd, ".habitat"), { recursive: true });
  return cwd;
}

function module(id: string, alias: string, crewCapacity: number): HabitatModule {
  return {
    id,
    alias,
    blueprintId: alias,
    moduleType: alias,
    displayName: alias,
    connectedTo: [],
    runtimeAttributes: { crewCapacity },
    capabilities: [],
    constructionStatus: "built",
    source: "local",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function registration(): StoredRegistration {
  return {
    habitatUuid: "uuid-1",
    habitatId: "habitat-1",
    displayName: "Test Habitat",
    baseUrl: "https://planet.turingguild.com",
    registeredAt: "2026-07-15T00:00:00.000Z",
    starterModules: [],
    starterHumans: [{
      id: "human-1",
      displayName: "Abigail",
      locationModuleId: "module-1",
    }, {
      id: "human-2",
      displayName: "Adam",
      locationModuleId: "module-2",
    }],
    blueprints: [],
  };
}

test("PUT /humans/:humanId moves a human to an existing module with capacity", async () => {
  const cwd = tempHabitat();
  writeRegistration(registration(), cwd);
  writeModules([module("module-1", "source", 1), module("module-2", "destination", 2)], cwd);

  const response = await createBackendApp({ cwd, apiToken: "test-token" }).request(
    "http://localhost/humans/human-1",
    { method: "PUT", body: JSON.stringify({ locationModuleId: "destination" }), headers: { "Content-Type": "application/json" } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { human: {
    id: "human-1",
    displayName: "Abigail",
    locationModuleId: "module-2",
  } });
});

test("PUT /humans/:humanId rejects missing records and full destinations", async () => {
  const cwd = tempHabitat();
  writeRegistration(registration(), cwd);
  writeModules([module("module-1", "source", 1), module("module-2", "full", 1)], cwd);

  const app = createBackendApp({ cwd, apiToken: "test-token" });
  const fullResponse = await app.request("http://localhost/humans/human-1", {
    method: "PUT", body: JSON.stringify({ locationModuleId: "full" }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(fullResponse.status, 409);

  const missingHumanResponse = await app.request("http://localhost/humans/missing", {
    method: "PUT", body: JSON.stringify({ locationModuleId: "source" }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(missingHumanResponse.status, 404);

  const missingModuleResponse = await app.request("http://localhost/humans/human-1", {
    method: "PUT", body: JSON.stringify({ locationModuleId: "missing" }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(missingModuleResponse.status, 404);
});

test("DELETE /modules/:moduleId rejects occupied modules", async () => {
  const cwd = tempHabitat();
  writeRegistration(registration(), cwd);
  writeModules([module("module-1", "source", 1)], cwd);

  const response = await createBackendApp({ cwd, apiToken: "test-token" }).request(
    "http://localhost/modules/source",
    { method: "DELETE" },
  );

  assert.equal(response.status, 409);
});
