import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBackendApp } from "../src/server.ts";
import { readExplorationState } from "../src/exploration.ts";
import { writeModules, writeRegistration, type HabitatModule, type StoredRegistration } from "../src/habitat-store.ts";

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "habitat-exploration-"));
  mkdirSync(join(cwd, ".habitat"), { recursive: true });
  const registration: StoredRegistration = {
    habitatUuid: "uuid-1", habitatId: "habitat-1", displayName: "Test",
    baseUrl: "https://planet.turingguild.com", registeredAt: "2026-07-15T00:00:00.000Z",
    starterModules: [], blueprints: [], starterHumans: [
      { id: "human-1", displayName: "Abigail", locationModuleId: "suitport-1" },
    ],
  };
  const suitport: HabitatModule = {
    id: "suitport-1", alias: "suitport-1", blueprintId: "basic-suitport", moduleType: "basic-suitport",
    displayName: "Basic Suitport", connectedTo: [], runtimeAttributes: { status: "online" },
    capabilities: ["limited-eva", "suitport-access"], constructionStatus: "built", source: "local",
    createdAt: registration.registeredAt, updatedAt: registration.registeredAt,
  };
  writeRegistration(registration, cwd);
  writeModules([suitport], cwd);
  return { cwd, app: createBackendApp({ cwd, apiToken: "test-token" }) };
}

test("EVA deploy, move, and dock persist local exploration state", async () => {
  const { cwd, app } = setup();
  const deploy = await app.request("http://localhost/exploration/deploy", {
    method: "POST", body: JSON.stringify({ humanId: "human-1" }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(deploy.status, 200);

  const move = await app.request("http://localhost/exploration/move", {
    method: "POST", body: JSON.stringify({ x: 1, y: 0 }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(move.status, 200);
  assert.deepEqual(readExplorationState(cwd), {
    deployedHumanId: "human-1", x: 1, y: 0, carriedResources: {}, maxCarryingCapacityKg: 20,
  });

  const diagonal = await app.request("http://localhost/exploration/move", {
    method: "POST", body: JSON.stringify({ x: 2, y: 1 }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(diagonal.status, 400);

  const dockAway = await app.request("http://localhost/exploration/dock", { method: "POST" });
  assert.equal(dockAway.status, 400);

  const back = await app.request("http://localhost/exploration/move", {
    method: "POST", body: JSON.stringify({ x: 0, y: 0 }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(back.status, 200);
  const dock = await app.request("http://localhost/exploration/dock", { method: "POST" });
  assert.equal(dock.status, 200);
  assert.equal(readExplorationState(cwd).deployedHumanId, null);
});

test("EVA deployment requires the human to be in the suitport and allows only one explorer", async () => {
  const { cwd, app } = setup();
  const registration = JSON.parse(JSON.stringify({
    ...readExplorationState(cwd),
  }));
  assert.equal(registration.deployedHumanId, null);

  const missing = await app.request("http://localhost/exploration/deploy", {
    method: "POST", body: JSON.stringify({ humanId: "missing" }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(missing.status, 404);

  const deploy = await app.request("http://localhost/exploration/deploy", {
    method: "POST", body: JSON.stringify({ humanId: "human-1" }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(deploy.status, 200);
  const second = await app.request("http://localhost/exploration/deploy", {
    method: "POST", body: JSON.stringify({ humanId: "human-1" }), headers: { "Content-Type": "application/json" },
  });
  assert.equal(second.status, 409);
});
