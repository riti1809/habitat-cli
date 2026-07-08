import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import type { HabitatModule } from "../src/habitat-store.ts";
import {
  formatModulePowerStatusTable,
  runPowerTicks,
} from "../src/power-tick.ts";

function createModule(overrides: Partial<HabitatModule>): HabitatModule {
  return {
    id: "module-1",
    alias: "module-1",
    blueprintId: "test-module",
    moduleType: "test-module",
    displayName: "Test Module",
    connectedTo: [],
    runtimeAttributes: {},
    capabilities: [],
    constructionStatus: "built",
    source: "local",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

const tsxLoaderPath = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url);
const cliEntryPath = new URL("../src/cli.ts", import.meta.url);
const isBunRuntime = typeof process.versions.bun === "string";
const cliCommand = isBunRuntime
  ? [process.execPath, cliEntryPath.pathname]
  : [process.execPath, "--import", tsxLoaderPath.pathname, cliEntryPath.pathname];

type MockResponse = {
  status: number;
  body: unknown;
};

async function withMockKepler(
  routes: Record<string, MockResponse>,
  run: (baseUrl: string) => Promise<void> | void,
) {
  const server = createServer((request, response) => {
    const route = routes[request.url ?? ""];

    if (!route) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Route not mocked" } }));
      return;
    }

    response.writeHead(route.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(route.body));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine mock server address.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function runCli(
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
) {
  const child = spawn(cliCommand[0], [...cliCommand.slice(1), ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const status = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });

  return {
    status,
    stdout,
    stderr,
  };
}

function runCliSync(
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
) {
  if (isBunRuntime) {
    const result = Bun.spawnSync({
      cmd: [...cliCommand, ...args],
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
    });

    return {
      status: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  return spawnSync(cliCommand[0], [...cliCommand.slice(1), ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
  });
}

test("runPowerTicks drains battery energy from powered modules across multiple ticks", () => {
  const battery = createModule({
    id: "battery-1",
    alias: "battery-1",
    blueprintId: "basic-battery",
    moduleType: "basic-battery",
    displayName: "Battery",
    runtimeAttributes: {
      status: "offline",
      currentEnergyKwh: 500,
      powerDrawKw: {
        offline: 0,
      },
    },
  });

  const commandModule = createModule({
    id: "command-1",
    alias: "command-1",
    blueprintId: "command-module",
    moduleType: "command-module",
    displayName: "Command Module",
    runtimeAttributes: {
      status: "active",
      powerDrawKw: {
        active: 2,
      },
    },
  });

  const suitport = createModule({
    id: "suitport-1",
    alias: "suitport-1",
    blueprintId: "basic-suitport",
    moduleType: "basic-suitport",
    displayName: "Suitport",
    runtimeAttributes: {
      status: "online",
      powerDrawKw: {
        online: 0.5,
      },
    },
  });

  const result = runPowerTicks([battery, commandModule, suitport], 60, {
    now: "2026-07-08T00:01:00.000Z",
  });

  assert.equal(result.ticksExecuted, 60);
  assert.equal(result.totalPowerDemandKw, 2.5);
  assert.equal(result.energyConsumedKwh, 2.5 / 60);
  assert.equal(result.batteryEnergyBeforeKwh, 500);
  assert.equal(result.batteryEnergyAfterKwh, 500 - (2.5 / 60));
  assert.equal(result.updatedBatteryCount, 1);
  assert.equal(
    result.modules[0]?.runtimeAttributes.currentEnergyKwh,
    500 - (2.5 / 60),
  );
  assert.equal(result.modules[0]?.updatedAt, "2026-07-08T00:01:00.000Z");
  assert.equal(result.modules[1]?.updatedAt, commandModule.updatedAt);
});

test("runPowerTicks treats missing power draw values as zero demand", () => {
  const battery = createModule({
    id: "battery-1",
    alias: "battery-1",
    blueprintId: "basic-battery",
    moduleType: "basic-battery",
    runtimeAttributes: {
      status: "offline",
      currentEnergyKwh: 10,
    },
  });

  const module = createModule({
    id: "module-2",
    alias: "module-2",
    runtimeAttributes: {
      status: "active",
    },
  });

  const result = runPowerTicks([battery, module], 5, {
    now: "2026-07-08T00:00:05.000Z",
  });

  assert.equal(result.totalPowerDemandKw, 0);
  assert.equal(result.energyConsumedKwh, 0);
  assert.equal(result.batteryEnergyAfterKwh, 10);
});

test("runPowerTicks rejects ticks when battery energy is insufficient", () => {
  const battery = createModule({
    id: "battery-1",
    alias: "battery-1",
    blueprintId: "basic-battery",
    moduleType: "basic-battery",
    runtimeAttributes: {
      status: "offline",
      currentEnergyKwh: 1,
    },
  });

  const module = createModule({
    id: "module-2",
    alias: "module-2",
    runtimeAttributes: {
      status: "active",
      powerDrawKw: {
        active: 7200,
      },
    },
  });

  assert.throws(
    () =>
      runPowerTicks([battery, module], 1, {
        now: "2026-07-08T00:00:01.000Z",
      }),
    /Insufficient battery energy/,
  );
});

test("habitat tick drains battery energy and persists the updated modules file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-tick-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  const modules = [
    createModule({
      id: "battery-1",
      alias: "battery-1",
      blueprintId: "basic-battery",
      moduleType: "basic-battery",
      displayName: "Battery",
      runtimeAttributes: {
        status: "offline",
        currentEnergyKwh: 500,
        powerDrawKw: {
          offline: 0,
        },
      },
    }),
    createModule({
      id: "command-1",
      alias: "command-1",
      blueprintId: "command-module",
      moduleType: "command-module",
      displayName: "Command Module",
      runtimeAttributes: {
        status: "active",
        powerDrawKw: {
          active: 2,
        },
      },
    }),
  ];

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify(modules, null, 2)}\n`,
    "utf8",
  );

  const result = runCliSync(["tick", "--ticks", "60"], { cwd: tempDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Executed 60 ticks\./);
  assert.match(result.stdout, /Power demand: 2 kW/);
  assert.match(result.stdout, /Energy consumed: 0\.033333 kWh/);
  assert.match(result.stdout, /Battery energy: 500 -> 499\.966667 kWh/);
  assert.match(result.stdout, /Updated 1 battery module\./);

  const updatedModules = JSON.parse(
    readFileSync(join(habitatDir, "modules.json"), "utf8"),
  ) as HabitatModule[];

  assert.equal(updatedModules[0]?.runtimeAttributes.currentEnergyKwh, 499.96666666666664);
});

test("habitat tick rejects invalid tick counts", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-tick-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });
  writeFileSync(join(habitatDir, "modules.json"), "[]\n", "utf8");

  const result = runCliSync(["tick", "--ticks", "0"], { cwd: tempDir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ticks must be a positive integer\./);
});

test("formatModulePowerStatusTable shows module state, current draw, and summary", () => {
  const modules = [
    createModule({
      id: "battery-1",
      alias: "battery-1",
      blueprintId: "basic-battery",
      moduleType: "basic-battery",
      displayName: "Battery",
      runtimeAttributes: {
        status: "offline",
        currentEnergyKwh: 500,
        powerDrawKw: {
          offline: 0,
        },
      },
    }),
    createModule({
      id: "command-1",
      alias: "command-1",
      blueprintId: "command-module",
      moduleType: "command-module",
      displayName: "Command Module",
      runtimeAttributes: {
        status: "active",
        powerDrawKw: {
          active: 2,
        },
      },
    }),
    createModule({
      id: "fabricator-1",
      alias: "fabricator-1",
      blueprintId: "workshop-fabricator",
      moduleType: "workshop-fabricator",
      displayName: "Workshop Fabricator",
      runtimeAttributes: {
        status: "online",
        powerDrawKw: {
          online: 1,
          active: 8,
        },
      },
    }),
  ];

  const output = formatModulePowerStatusTable(modules);

  assert.match(output, /Module\s+State\s+Power Draw \(kW\)/);
  assert.match(output, /Battery\s+offline\s+0/);
  assert.match(output, /Command Module\s+active\s+2/);
  assert.match(output, /Workshop Fabricator\s+online\s+1/);
  assert.match(output, /Total power draw: 3 kW/);
  assert.match(output, /One tick energy cost: 0\.000833 kWh/);
});

test("habitat module status prints the power status table", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-status-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  const modules = [
    createModule({
      id: "battery-1",
      alias: "battery-1",
      blueprintId: "basic-battery",
      moduleType: "basic-battery",
      displayName: "Battery",
      runtimeAttributes: {
        status: "offline",
        currentEnergyKwh: 500,
        powerDrawKw: {
          offline: 0,
        },
      },
    }),
    createModule({
      id: "life-support-1",
      alias: "life-support-1",
      blueprintId: "life-support",
      moduleType: "life-support",
      displayName: "Life Support",
      runtimeAttributes: {
        status: "active",
        powerDrawKw: {
          active: 5,
        },
      },
    }),
  ];

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify(modules, null, 2)}\n`,
    "utf8",
  );

  const result = runCliSync(["module", "status"], { cwd: tempDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Module\s+State\s+Power Draw \(kW\)/);
  assert.match(result.stdout, /Battery\s+offline\s+0/);
  assert.match(result.stdout, /Life Support\s+active\s+5/);
  assert.match(result.stdout, /Total power draw: 5 kW/);
  assert.match(result.stdout, /One tick energy cost: 0\.001389 kWh/);
});

test("habitat module set-status updates only runtimeAttributes.status and reports current draw", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-set-status-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  const modules = [
    createModule({
      id: "fabricator-1",
      alias: "fabricator-1",
      blueprintId: "workshop-fabricator",
      moduleType: "workshop-fabricator",
      displayName: "Workshop Fabricator",
      runtimeAttributes: {
        status: "online",
        health: 100,
        rawMaterialBufferKg: 1500,
        powerDrawKw: {
          online: 1,
          active: 8,
          damaged: 1,
        },
      },
    }),
  ];

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify(modules, null, 2)}\n`,
    "utf8",
  );

  const result = runCliSync(["module", "set-status", "fabricator-1", "active"], {
    cwd: tempDir,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Updated module "fabricator-1" to status "active" \(power draw: 8 kW\)\./,
  );

  const updatedModules = JSON.parse(
    readFileSync(join(habitatDir, "modules.json"), "utf8"),
  ) as HabitatModule[];

  assert.equal(updatedModules[0]?.runtimeAttributes.status, "active");
  assert.equal(updatedModules[0]?.runtimeAttributes.health, 100);
  assert.equal(updatedModules[0]?.runtimeAttributes.rawMaterialBufferKg, 1500);
  assert.deepEqual(updatedModules[0]?.runtimeAttributes.powerDrawKw, {
    online: 1,
    active: 8,
    damaged: 1,
  });
});

test("habitat module set-status rejects invalid statuses", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-set-status-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify([
      createModule({
        id: "module-1",
        alias: "module-1",
        runtimeAttributes: {
          status: "offline",
          powerDrawKw: {
            offline: 0,
          },
        },
      }),
    ], null, 2)}\n`,
    "utf8",
  );

  const result = runCliSync(["module", "set-status", "module-1", "broken"], {
    cwd: tempDir,
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Status must be one of: offline, idle, online, active, damaged\./,
  );
});

test("habitat blueprint list prints a concise blueprint table", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints": {
        status: 200,
        body: {
          catalogVersion: "kepler-test-v1",
          blueprints: [
            {
              id: "bp-1",
              blueprintId: "survey-rover",
              displayName: "Survey Rover",
              description: "Scouts nearby terrain.",
              output: { itemType: "agent", agentType: "rover" },
              inputs: { steel: 20, electronics: 8 },
              buildTicks: 120,
              repeatable: true,
            },
            {
              id: "bp-2",
              blueprintId: "greenhouse",
              displayName: "Greenhouse",
              output: { itemType: "module", moduleType: "greenhouse" },
              inputs: { steel: 30, glass: 15 },
              buildTicks: 240,
              repeatable: false,
            },
          ],
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-blueprint-list-"));

      const result = await runCli(["blueprint", "list"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Blueprint\s+Name\s+Ticks\s+Repeatable/);
      assert.match(result.stdout, /survey-rover\s+Survey Rover\s+120\s+yes/);
      assert.match(result.stdout, /greenhouse\s+Greenhouse\s+240\s+no/);
      assert.equal(existsSync(join(tempDir, ".habitat", "registration.json")), false);
      assert.equal(existsSync(join(tempDir, ".habitat", "modules.json")), false);
    },
  );
});

test("habitat blueprint show prints readable details for one blueprint", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints/survey-rover": {
        status: 200,
        body: {
          blueprint: {
            id: "bp-1",
            blueprintId: "survey-rover",
            displayName: "Survey Rover",
            description: "Scouts nearby terrain, discovers resource sites, and extends habitat reach.",
            output: { itemType: "agent", agentType: "rover" },
            inputs: { steel: 20, electronics: 8 },
            requiredFacility: { moduleType: "rover-bay" },
            buildTicks: 120,
            prerequisites: ["rover-bay"],
            unlocks: ["nearby-resource-discovery"],
            repeatable: true,
            capabilities: ["terrain-survey"],
          },
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-blueprint-show-"));

      const result = await runCli(["blueprint", "show", "survey-rover"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Blueprint ID: survey-rover/);
      assert.match(result.stdout, /Name: Survey Rover/);
      assert.match(result.stdout, /Build Ticks: 120/);
      assert.match(result.stdout, /Repeatable: yes/);
      assert.match(result.stdout, /Description: Scouts nearby terrain, discovers resource sites, and extends habitat reach\./);
      assert.match(result.stdout, /Inputs:/);
      assert.match(result.stdout, /steel: 20/);
      assert.match(result.stdout, /Output:/);
      assert.match(result.stdout, /agentType: rover/);
      assert.match(result.stdout, /Required Facility:/);
      assert.match(result.stdout, /moduleType: rover-bay/);
      assert.match(result.stdout, /Prerequisites: rover-bay/);
      assert.match(result.stdout, /Unlocks: nearby-resource-discovery/);
      assert.match(result.stdout, /Capabilities: terrain-survey/);
      assert.equal(existsSync(join(tempDir, ".habitat", "registration.json")), false);
      assert.equal(existsSync(join(tempDir, ".habitat", "modules.json")), false);
    },
  );
});

test("habitat blueprint show prints a friendly error for a missing blueprint", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints/missing-blueprint": {
        status: 404,
        body: {
          error: {
            message: "no matching blueprint",
          },
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-blueprint-missing-"));

      const result = await runCli(["blueprint", "show", "missing-blueprint"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Blueprint "missing-blueprint" was not found\./);
      assert.equal(existsSync(join(tempDir, ".habitat", "registration.json")), false);
      assert.equal(existsSync(join(tempDir, ".habitat", "modules.json")), false);
    },
  );
});

test("habitat resource list prints a concise resource catalog table", async () => {
  await withMockKepler(
    {
      "/catalog/resources": {
        status: 200,
        body: {
          catalogVersion: "kepler-test-v1",
          resources: [
            {
              id: "res-1",
              resourceType: "iron-ore",
              displayName: "Iron Ore",
              kind: "mineral",
              rarity: "common",
              description: "Raw iron-bearing ore.",
              unit: "kg",
            },
            {
              id: "res-2",
              resourceType: "oxygen",
              displayName: "Oxygen",
              kind: "life-support",
              rarity: "essential",
              unit: "kg",
            },
          ],
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-resource-list-"));

      const result = await runCli(["resource", "list"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /Resource catalog entries are possible resource types in the Kepler world, not local inventory\./,
      );
      assert.match(result.stdout, /Resource\s+Name\s+Kind\s+Rarity/);
      assert.match(result.stdout, /iron-ore\s+Iron Ore\s+mineral\s+common/);
      assert.match(result.stdout, /oxygen\s+Oxygen\s+life-support\s+essential/);
      assert.equal(existsSync(join(tempDir, ".habitat", "registration.json")), false);
      assert.equal(existsSync(join(tempDir, ".habitat", "modules.json")), false);
    },
  );
});
