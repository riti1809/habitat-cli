import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeModules, type HabitatModule } from "../src/habitat-store.ts";
import { createBackendApp } from "../src/server.ts";

function moduleRecord(overrides: Partial<HabitatModule>): HabitatModule {
  return {
    id: "load-1", alias: "load-1", blueprintId: "load", moduleType: "load", displayName: "Load",
    connectedTo: [], runtimeAttributes: { status: "online", powerDrawKw: { online: 2 } },
    capabilities: [], constructionStatus: "built", source: "local",
    createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z", ...overrides,
  };
}

test("dashboard power and tick routes return server-owned simulation state", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "habitat-dashboard-"));
  mkdirSync(join(cwd, ".habitat"), { recursive: true });
  writeModules([
    moduleRecord({
      id: "battery-1", alias: "battery-1", moduleType: "basic-battery", displayName: "Battery",
      runtimeAttributes: { status: "online", currentEnergyKwh: 10, capacityKwh: 100 },
    }),
    moduleRecord({}),
  ], cwd);

  const kepler = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ solarIrradiance: { wPerM2: 700, condition: "clear" } }));
  });
  await new Promise<void>((resolve) => kepler.listen(0, "127.0.0.1", resolve));
  const address = kepler.address();
  if (!address || typeof address === "string") throw new Error("Mock server did not start.");

  try {
    const app = createBackendApp({ cwd, apiToken: "test-token", keplerBaseUrl: `http://127.0.0.1:${address.port}` });
    const power = await app.request("http://localhost/power");
    assert.equal(power.status, 200);
    assert.deepEqual((await power.json()).powerConsumptionKw, 2);

    const tick = await app.request("http://localhost/tick", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticks: 60 }),
    });
    assert.equal(tick.status, 200);
    const body = await tick.json() as { ticksExecuted: number; power: { batteryEnergyKwh: number } };
    assert.equal(body.ticksExecuted, 60);
    assert.equal(body.power.batteryEnergyKwh, 9.966666666666666);
  } finally {
    await new Promise<void>((resolve, reject) => kepler.close((error) => error ? reject(error) : resolve()));
  }
});
