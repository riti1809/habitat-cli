import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBackendApp } from "../src/server.ts";
import { readExplorationState, writeExplorationState } from "../src/exploration.ts";
import { readModules, readRegistration, writeModules, writeRegistration, type HabitatModule, type StoredRegistration } from "../src/habitat-store.ts";

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
  const supplyCache: HabitatModule = {
    id: "supply-1", alias: "supply-1", blueprintId: "supply-cache", moduleType: "supply-cache",
    displayName: "Supply Cache", connectedTo: [], runtimeAttributes: { inventory: {} }, capabilities: [],
    constructionStatus: "built", source: "local", createdAt: registration.registeredAt, updatedAt: registration.registeredAt,
  };
  writeRegistration(registration, cwd);
  writeModules([suitport, supplyCache], cwd);
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
  writeExplorationState({
    ...readExplorationState(cwd), carriedResources: { ferrite: 3 },
  }, cwd);
  const dock = await app.request("http://localhost/exploration/dock", { method: "POST" });
  assert.equal(dock.status, 200);
  assert.equal(readExplorationState(cwd).deployedHumanId, null);
  assert.equal(readRegistration(cwd)?.starterHumans?.[0]?.locationModuleId, "suitport-1");
  assert.deepEqual(readModules(cwd).find((module) => module.moduleType === "supply-cache")?.runtimeAttributes.inventory, { ferrite: 3 });
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

test("collection sends saved position and persists material only after Kepler success", async () => {
  const { cwd } = setup();
  const requests: Array<{ body: string; authorization: string | null }> = [];
  writeExplorationState({
    deployedHumanId: "human-1", x: 4, y: -2, carriedResources: {}, maxCarryingCapacityKg: 20,
  }, cwd);

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ body, authorization: request.headers.authorization ?? null });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ collection: {
        x: 4, y: -2, resourceType: "ferrite", unit: "kg", collectedKg: 5, remainingKg: 175,
      } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const app = createBackendApp({ cwd, apiToken: "test-token", keplerBaseUrl: `http://127.0.0.1:${address.port}` });
    const response = await app.request("http://localhost/collection", {
      method: "POST", body: JSON.stringify({ quantityKg: 5 }), headers: { "Content-Type": "application/json" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(requests[0].body), { habitatId: "habitat-1", x: 4, y: -2, quantityKg: 5 });
    assert.equal(requests[0].authorization, "Bearer test-token");
    assert.deepEqual(readExplorationState(cwd).carriedResources, { ferrite: 5 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("collection validation and Kepler rejection preserve local carried resources", async () => {
  const { cwd } = setup();
  writeExplorationState({
    deployedHumanId: "human-1", x: 0, y: 0, carriedResources: { ferrite: 19 }, maxCarryingCapacityKg: 20,
  }, cwd);
  let keplerCalls = 0;
  const server = createServer((_request, response) => {
    keplerCalls += 1;
    response.writeHead(409, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Tile does not have enough remaining material." } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const app = createBackendApp({ cwd, apiToken: "test-token", keplerBaseUrl: `http://127.0.0.1:${address.port}` });
    const tooMuch = await app.request("http://localhost/collection", {
      method: "POST", body: JSON.stringify({ quantityKg: 2 }), headers: { "Content-Type": "application/json" },
    });
    assert.equal(tooMuch.status, 409);
    assert.equal(keplerCalls, 0);
    assert.deepEqual(readExplorationState(cwd).carriedResources, { ferrite: 19 });

    const rejected = await app.request("http://localhost/collection", {
      method: "POST", body: JSON.stringify({ quantityKg: 1 }), headers: { "Content-Type": "application/json" },
    });
    assert.equal(rejected.status, 409);
    assert.equal(keplerCalls, 1);
    assert.deepEqual(readExplorationState(cwd).carriedResources, { ferrite: 19 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
