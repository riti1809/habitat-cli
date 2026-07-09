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
    /No usable battery energy is available|Insufficient battery energy/,
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

test("habitat tick explains when there is no usable battery energy", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-tick-no-battery-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  const modules = [
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

  const result = runCliSync(["tick", "1"], { cwd: tempDir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No usable battery energy is available/);
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

  assert.match(output, /Module\s+Declared\s+Effective\s+Power Draw \(kW\)/);
  assert.match(output, /Battery\s+offline\s+offline\s+0/);
  assert.match(output, /Command Module\s+active\s+active\s+2/);
  assert.match(output, /Workshop Fabricator\s+online\s+online\s+1/);
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
  assert.match(result.stdout, /Module\s+Declared\s+Effective\s+Power Draw \(kW\)/);
  assert.match(result.stdout, /Battery\s+offline\s+offline\s+0/);
  assert.match(result.stdout, /Life Support\s+active\s+active\s+5/);
  assert.match(result.stdout, /Total power draw: 5 kW/);
  assert.match(result.stdout, /One tick energy cost: 0\.001389 kWh/);
});

test("habitat module show prints detailed module information", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-module-show-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  const modules = [
    createModule({
      id: "fabricator-1",
      alias: "workshop-fabricator-1",
      blueprintId: "workshop-fabricator",
      moduleType: "workshop-fabricator",
      displayName: "Workshop Fabricator",
      runtimeAttributes: {
        status: "active",
        crewCapacity: 1,
        physicalVolumeM3: 20,
        rawMaterialBufferKg: 1500,
        inProcessStorageM3: 3,
        powerDrawKw: {
          online: 1,
          active: 8,
          damaged: 1,
        },
      },
      capabilities: ["basic-fabrication"],
      constructionJob: {
        blueprintId: "small-solar-array",
        outputModuleId: "small-solar-array-1",
        outputModuleType: "small-solar-array",
        buildTicks: 180,
        remainingTicks: 179,
        requiredResources: {
          ferrite: 90,
          "silicate-glass": 45,
          "conductive-ore": 18,
        },
        futureRuntimeAttributes: {
          status: "online",
          powerGenerationKw: 12,
          degradedStormGenerationKw: 3,
          maintenanceHoursPer100Ticks: 4,
          surfaceAreaM2: 28,
        },
        futureCapabilities: ["solar-generation"],
        startedAt: "2026-07-09T00:00:00.000Z",
      },
    }),
    createModule({
      id: "battery-1",
      alias: "basic-battery-1",
      blueprintId: "basic-battery",
      moduleType: "basic-battery",
      displayName: "Basic Battery",
      runtimeAttributes: {
        status: "offline",
        currentEnergyKwh: 42.5,
        capacityKwh: 100,
        reserveKwh: 5,
        maxOutputKw: 6,
        powerDrawKw: {
          offline: 0,
        },
      },
    }),
    createModule({
      id: "small-solar-array-1",
      alias: "small-solar-array-1",
      blueprintId: "small-solar-array",
      moduleType: "small-solar-array",
      displayName: "Small Solar Array",
      runtimeAttributes: {
        status: "online",
        health: 100,
        powerGenerationKw: 12,
        degradedStormGenerationKw: 3,
        maintenanceHoursPer100Ticks: 4,
        surfaceAreaM2: 28,
        powerDrawKw: {
          online: 0,
        },
      },
      capabilities: ["solar-generation"],
    }),
  ];

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify(modules, null, 2)}\n`,
    "utf8",
  );

  const fabricator = runCliSync(["module", "show", "workshop-fabricator-1"], {
    cwd: tempDir,
  });
  assert.equal(fabricator.status, 0, String(fabricator.stderr));
  assert.match(fabricator.stdout, /Module ID: fabricator-1/);
  assert.match(fabricator.stdout, /Alias: workshop-fabricator-1/);
  assert.match(fabricator.stdout, /Effective state: constructing/);
  assert.match(fabricator.stdout, /Construction Job:/);
  assert.match(fabricator.stdout, /Output module: small-solar-array-1/);
  assert.match(fabricator.stdout, /Remaining ticks: 179/);

  const battery = runCliSync(["module", "show", "basic-battery-1"], {
    cwd: tempDir,
  });
  assert.equal(battery.status, 0, String(battery.stderr));
  assert.match(battery.stdout, /Battery:/);
  assert.match(battery.stdout, /Current energy: 42\.5 kWh/);
  assert.match(battery.stdout, /Capacity: 100 kWh/);
  assert.match(battery.stdout, /Reserve: 5 kWh/);
  assert.match(battery.stdout, /Max output: 6 kW/);

  const solar = runCliSync(["module", "show", "small-solar-array-1"], {
    cwd: tempDir,
  });
  assert.equal(solar.status, 0, String(solar.stderr));
  assert.match(solar.stdout, /Declared state: online/);
  assert.match(solar.stdout, /Effective state: online/);
  assert.match(solar.stdout, /Power draw:/);
  assert.match(solar.stdout, /powerGenerationKw: 12/);
  assert.match(solar.stdout, /degradedStormGenerationKw: 3/);
  assert.match(solar.stdout, /maintenanceHoursPer100Ticks: 4/);
  assert.match(solar.stdout, /surfaceAreaM2: 28/);
  assert.match(solar.stdout, /Capabilities: solar-generation/);
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

test("habitat inventory add increments supply cache inventory and persists it", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-inventory-add-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify(
      [
        createModule({
          id: "supply-1",
          alias: "supply-1",
          blueprintId: "supply-cache",
          moduleType: "supply-cache",
          displayName: "Supply Cache",
          runtimeAttributes: {
            status: "offline",
            physicalVolumeM3: 25,
            storageMassKg: 6000,
            cargoVolumeM3: 18,
            powerDrawKw: {
              offline: 0,
              online: 0,
              active: 0,
              damaged: 0,
            },
          },
          capabilities: ["storage"],
        }),
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );

  const first = runCliSync(["inventory", "add", "ferrite", "90"], {
    cwd: tempDir,
  });
  const second = runCliSync(["inventory", "add", "silicate-glass", "45"], {
    cwd: tempDir,
  });
  const third = runCliSync(["inventory", "add", "conductive-ore", "18"], {
    cwd: tempDir,
  });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(third.status, 0, third.stderr);
  assert.match(first.stdout, /Supply cache inventory updated: ferrite = 90/);
  assert.match(second.stdout, /Supply cache inventory updated: silicate-glass = 45/);
  assert.match(third.stdout, /Supply cache inventory updated: conductive-ore = 18/);

  const updatedModules = JSON.parse(
    readFileSync(join(habitatDir, "modules.json"), "utf8"),
  ) as HabitatModule[];
  const supplyCache = updatedModules[0];

  assert.deepEqual(supplyCache?.runtimeAttributes.inventory, {
    ferrite: 90,
    "silicate-glass": 45,
    "conductive-ore": 18,
  });
});

test("habitat construct spends inventory and attaches a construction job to the fabricator", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints/small-solar-array": {
        status: 200,
        body: {
          blueprint: {
            id: "blueprint_kepler-442b-v1_small-solar-array",
            blueprintId: "small-solar-array",
            displayName: "Small Solar Array Blueprint",
            description: "Generates starter solar power during clear daylight, with reduced output during dust accumulation and storm conditions.",
            output: {
              itemType: "module",
              moduleType: "small-solar-array",
              quantity: 1,
            },
            inputs: {
              ferrite: 90,
              "silicate-glass": 45,
              "conductive-ore": 18,
            },
            requiredFacility: {
              moduleType: "workshop-fabricator",
              minimumLevel: 1,
            },
            buildTicks: 180,
            repeatable: true,
            runtimeAttributes: {
              health: 100,
              status: "online",
              crewCapacity: 0,
              powerDrawKw: {
                offline: 0,
                online: 0,
                active: 0,
                damaged: 0,
              },
              powerGenerationKw: 12,
              degradedStormGenerationKw: 3,
              maintenanceHoursPer100Ticks: 4,
              surfaceAreaM2: 28,
            },
            capabilities: ["solar-generation"],
          },
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-construct-"));
      const habitatDir = join(tempDir, ".habitat");
      mkdirSync(habitatDir, { recursive: true });

      writeFileSync(
        join(habitatDir, "registration.json"),
        `${JSON.stringify(
          {
            habitatUuid: "dea23d87-6938-4338-a868-f351f633dc62",
            habitatId: "habitat_dea23d87_6938_4338_a868_f351f633dc62",
            displayName: "Kepler Frontier",
            baseUrl,
            registeredAt: "2026-07-07T18:35:56.464Z",
            starterModules: [],
            blueprints: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      writeFileSync(
        join(habitatDir, "modules.json"),
        `${JSON.stringify(
          [
            createModule({
              id: "fabricator-1",
              alias: "fabricator-1",
              blueprintId: "workshop-fabricator",
              moduleType: "workshop-fabricator",
              displayName: "Workshop Fabricator",
              runtimeAttributes: {
                health: 100,
                status: "online",
                crewCapacity: 1,
                physicalVolumeM3: 20,
                rawMaterialBufferKg: 1500,
                inProcessStorageM3: 3,
                powerDrawKw: {
                  online: 1,
                  active: 8,
                  damaged: 1,
                },
              },
              capabilities: ["basic-fabrication"],
            }),
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
              capabilities: ["power-storage"],
            }),
            createModule({
              id: "supply-1",
              alias: "supply-1",
              blueprintId: "supply-cache",
              moduleType: "supply-cache",
              displayName: "Supply Cache",
              runtimeAttributes: {
                status: "offline",
                physicalVolumeM3: 25,
                storageMassKg: 6000,
                cargoVolumeM3: 18,
                inventory: {
                  ferrite: 120,
                  "silicate-glass": 60,
                  "conductive-ore": 30,
                },
                powerDrawKw: {
                  offline: 0,
                  online: 0,
                  active: 0,
                  damaged: 0,
                },
              },
              capabilities: ["storage"],
            }),
          ],
          null,
          2,
        )}\n`,
        "utf8",
      );

      const result = await runCli(["construct", "small-solar-array"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Started construction of "small-solar-array"\./);
      assert.match(result.stdout, /Fabricator: fabricator-1/);
      assert.match(result.stdout, /Build ticks: 180/);
      assert.match(result.stdout, /Remaining ticks: 180/);

      const updatedModules = JSON.parse(
        readFileSync(join(habitatDir, "modules.json"), "utf8"),
      ) as HabitatModule[];
      const updatedFabricator = updatedModules[0];
      const updatedBattery = updatedModules[1];
      const updatedSupplyCache = updatedModules[2];

      assert.equal(updatedModules.length, 3);
      assert.equal(updatedFabricator?.runtimeAttributes.status, "active");
      assert.equal(updatedFabricator?.constructionJob?.blueprintId, "small-solar-array");
      assert.equal(updatedFabricator?.constructionJob?.outputModuleType, "small-solar-array");
      assert.equal(updatedFabricator?.constructionJob?.buildTicks, 180);
      assert.equal(updatedFabricator?.constructionJob?.remainingTicks, 180);
      assert.match(
        String(updatedFabricator?.constructionJob?.outputModuleId),
        /^[a-z0-9-]+$/,
      );
      assert.deepEqual(updatedFabricator?.constructionJob?.futureCapabilities, [
        "solar-generation",
      ]);
      assert.equal(updatedFabricator?.constructionJob?.futureRuntimeAttributes?.powerGenerationKw, 12);
      assert.deepEqual(updatedSupplyCache?.runtimeAttributes.inventory, {
        ferrite: 30,
        "silicate-glass": 15,
        "conductive-ore": 12,
      });
      assert.equal(updatedBattery?.runtimeAttributes.currentEnergyKwh, 500);
    },
  );
});

test("habitat construct rejects when local inventory is insufficient", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints/small-solar-array": {
        status: 200,
        body: {
          blueprint: {
            id: "blueprint_kepler-442b-v1_small-solar-array",
            blueprintId: "small-solar-array",
            displayName: "Small Solar Array Blueprint",
            output: {
              itemType: "module",
              moduleType: "small-solar-array",
              quantity: 1,
            },
            inputs: {
              ferrite: 90,
              "silicate-glass": 45,
              "conductive-ore": 18,
            },
            requiredFacility: {
              moduleType: "workshop-fabricator",
              minimumLevel: 1,
            },
            buildTicks: 180,
            runtimeAttributes: {
              health: 100,
              status: "online",
              crewCapacity: 0,
              powerDrawKw: {
                offline: 0,
                online: 0,
                active: 0,
                damaged: 0,
              },
              powerGenerationKw: 12,
              degradedStormGenerationKw: 3,
              maintenanceHoursPer100Ticks: 4,
              surfaceAreaM2: 28,
            },
            capabilities: ["solar-generation"],
          },
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-construct-insufficient-"));
      const habitatDir = join(tempDir, ".habitat");
      mkdirSync(habitatDir, { recursive: true });

      writeFileSync(
        join(habitatDir, "registration.json"),
        `${JSON.stringify(
          {
            habitatUuid: "dea23d87-6938-4338-a868-f351f633dc62",
            habitatId: "habitat_dea23d87_6938_4338_a868_f351f633dc62",
            displayName: "Kepler Frontier",
            baseUrl,
            registeredAt: "2026-07-07T18:35:56.464Z",
            starterModules: [],
            blueprints: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      writeFileSync(
        join(habitatDir, "modules.json"),
        `${JSON.stringify(
          [
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
              capabilities: ["basic-fabrication"],
            }),
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
              capabilities: ["power-storage"],
            }),
            createModule({
              id: "supply-1",
              alias: "supply-1",
              blueprintId: "supply-cache",
              moduleType: "supply-cache",
              displayName: "Supply Cache",
              runtimeAttributes: {
                status: "offline",
                physicalVolumeM3: 25,
                storageMassKg: 6000,
                cargoVolumeM3: 18,
                inventory: {
                  ferrite: 10,
                  "silicate-glass": 5,
                  "conductive-ore": 3,
                },
                powerDrawKw: {
                  offline: 0,
                  online: 0,
                  active: 0,
                  damaged: 0,
                },
              },
              capabilities: ["storage"],
            }),
          ],
          null,
          2,
        )}\n`,
        "utf8",
      );

      const result = await runCli(["construct", "small-solar-array"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Insufficient local inventory for "small-solar-array"\./);

      const updatedModules = JSON.parse(
        readFileSync(join(habitatDir, "modules.json"), "utf8"),
      ) as HabitatModule[];
      assert.equal(updatedModules[0]?.runtimeAttributes.status, "online");
      assert.deepEqual(updatedModules[2]?.runtimeAttributes.inventory, {
        ferrite: 10,
        "silicate-glass": 5,
        "conductive-ore": 3,
      });
    },
  );
});

test("habitat construction status prints active jobs and remaining build time", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-construction-status-"));
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
        status: "active",
        powerDrawKw: {
          online: 1,
          active: 8,
        },
      },
      capabilities: ["basic-fabrication"],
      constructionJob: {
        blueprintId: "small-solar-array",
        outputModuleId: "small-solar-array-1234",
        outputModuleType: "small-solar-array",
        buildTicks: 180,
        remainingTicks: 144,
        requiredResources: {
          ferrite: 90,
          "silicate-glass": 45,
          "conductive-ore": 18,
        },
        futureRuntimeAttributes: {
          powerGenerationKw: 12,
          status: "online",
        },
        futureCapabilities: ["solar-generation"],
        startedAt: "2026-07-09T00:00:00.000Z",
      },
    }),
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
  ];

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify(modules, null, 2)}\n`,
    "utf8",
  );

  const result = runCliSync(["construction", "status"], { cwd: tempDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Active construction jobs: 1/);
  assert.match(result.stdout, /Fabricator\s+Blueprint\s+Output Module\s+Remaining Ticks\s+Build Ticks/);
  assert.match(result.stdout, /fabricator-1\s+small-solar-array\s+small-solar-array-1234\s+144\s+180/);
});

test("habitat inventory list prints the supply cache inventory", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-inventory-list-"));
  const habitatDir = join(tempDir, ".habitat");
  mkdirSync(habitatDir, { recursive: true });

  const modules = [
    createModule({
      id: "supply-1",
      alias: "supply-1",
      blueprintId: "supply-cache",
      moduleType: "supply-cache",
      displayName: "Supply Cache",
      runtimeAttributes: {
        status: "offline",
        physicalVolumeM3: 25,
        storageMassKg: 6000,
        cargoVolumeM3: 18,
        inventory: {
          ferrite: 90,
          "silicate-glass": 45,
          "conductive-ore": 18,
        },
        powerDrawKw: {
          offline: 0,
          online: 0,
          active: 0,
          damaged: 0,
        },
      },
      capabilities: ["storage"],
    }),
  ];

  writeFileSync(
    join(habitatDir, "modules.json"),
    `${JSON.stringify(modules, null, 2)}\n`,
    "utf8",
  );

  const result = runCliSync(["inventory", "list"], { cwd: tempDir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Resource\s+Quantity/);
  assert.match(result.stdout, /ferrite\s+90/);
  assert.match(result.stdout, /silicate-glass\s+45/);
  assert.match(result.stdout, /conductive-ore\s+18/);
});

test("habitat tick advances construction only after ticks complete", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints/small-solar-array": {
        status: 200,
        body: {
          blueprint: {
            id: "blueprint_kepler-442b-v1_small-solar-array",
            blueprintId: "small-solar-array",
            displayName: "Small Solar Array Blueprint",
            description: "Generates starter solar power during clear daylight, with reduced output during dust accumulation and storm conditions.",
            output: {
              itemType: "module",
              moduleType: "small-solar-array",
              quantity: 1,
            },
            inputs: {
              ferrite: 90,
              "silicate-glass": 45,
              "conductive-ore": 18,
            },
            requiredFacility: {
              moduleType: "workshop-fabricator",
              minimumLevel: 1,
            },
            buildTicks: 180,
            repeatable: true,
            runtimeAttributes: {
              health: 100,
              status: "online",
              crewCapacity: 0,
              powerDrawKw: {
                offline: 0,
                online: 0,
                active: 0,
                damaged: 0,
              },
              powerGenerationKw: 12,
              degradedStormGenerationKw: 3,
              maintenanceHoursPer100Ticks: 4,
              surfaceAreaM2: 28,
            },
            capabilities: ["solar-generation"],
          },
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-construction-advance-"));
      const habitatDir = join(tempDir, ".habitat");
      mkdirSync(habitatDir, { recursive: true });

      writeFileSync(
        join(habitatDir, "registration.json"),
        `${JSON.stringify(
          {
            habitatUuid: "dea23d87-6938-4338-a868-f351f633dc62",
            habitatId: "habitat_dea23d87_6938_4338_a868_f351f633dc62",
            displayName: "Kepler Frontier",
            baseUrl,
            registeredAt: "2026-07-07T18:35:56.464Z",
            starterModules: [],
            blueprints: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      writeFileSync(
        join(habitatDir, "modules.json"),
        `${JSON.stringify(
          [
            createModule({
              id: "fabricator-1",
              alias: "fabricator-1",
              blueprintId: "workshop-fabricator",
              moduleType: "workshop-fabricator",
              displayName: "Workshop Fabricator",
              runtimeAttributes: {
                status: "online",
                crewCapacity: 1,
                physicalVolumeM3: 20,
                rawMaterialBufferKg: 1500,
                inProcessStorageM3: 3,
                powerDrawKw: {
                  online: 1,
                  active: 8,
                  damaged: 1,
                },
              },
              capabilities: ["basic-fabrication"],
            }),
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
              capabilities: ["power-storage"],
            }),
            createModule({
              id: "supply-1",
              alias: "supply-1",
              blueprintId: "supply-cache",
              moduleType: "supply-cache",
              displayName: "Supply Cache",
              runtimeAttributes: {
                status: "offline",
                physicalVolumeM3: 25,
                storageMassKg: 6000,
                cargoVolumeM3: 18,
                inventory: {
                  ferrite: 120,
                  "silicate-glass": 60,
                  "conductive-ore": 30,
                },
                powerDrawKw: {
                  offline: 0,
                  online: 0,
                  active: 0,
                  damaged: 0,
                },
              },
              capabilities: ["storage"],
            }),
          ],
          null,
          2,
        )}\n`,
        "utf8",
      );

      const construct = await runCli(["construct", "small-solar-array"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(construct.status, 0, construct.stderr);

      const firstTick = await runCli(["tick", "1"], { cwd: tempDir });
      assert.equal(firstTick.status, 0, firstTick.stderr);
      assert.match(firstTick.stdout, /Executed 1 ticks\./);
      assert.doesNotMatch(firstTick.stdout, /Completed construction:/);

      const statusAfterOne = await runCli(["construction", "status"], {
        cwd: tempDir,
      });
      assert.equal(statusAfterOne.status, 0, statusAfterOne.stderr);
      assert.match(statusAfterOne.stdout, /Active construction jobs: 1/);
      assert.match(statusAfterOne.stdout, /fabricator-1\s+small-solar-array\s+small-solar-array-1\s+179\s+180/);

      const finalTick = await runCli(["tick", "179"], { cwd: tempDir });
      assert.equal(finalTick.status, 0, finalTick.stderr);
      assert.match(finalTick.stdout, /Completed construction: small-solar-array-1/);

      const moduleList = await runCli(["module", "list"], { cwd: tempDir });
      assert.equal(moduleList.status, 0, moduleList.stderr);
      assert.match(
        moduleList.stdout,
        /small-solar-array-1 \| type: small-solar-array \| name: Small Solar Array \| status: online \| health: 100/,
      );

      const moduleShow = await runCli(["module", "show", "small-solar-array-1"], {
        cwd: tempDir,
      });
      assert.equal(moduleShow.status, 0, moduleShow.stderr);
      assert.match(moduleShow.stdout, /Type: small-solar-array/);
      assert.match(moduleShow.stdout, /Name: Small Solar Array/);
      assert.match(moduleShow.stdout, /Construction status: built/);
    },
  );
});

test("habitat construction cancel clears the job without refunding inventory", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints/small-solar-array": {
        status: 200,
        body: {
          blueprint: {
            id: "blueprint_kepler-442b-v1_small-solar-array",
            blueprintId: "small-solar-array",
            displayName: "Small Solar Array Blueprint",
            output: {
              itemType: "module",
              moduleType: "small-solar-array",
              quantity: 1,
            },
            inputs: {
              ferrite: 90,
              "silicate-glass": 45,
              "conductive-ore": 18,
            },
            requiredFacility: {
              moduleType: "workshop-fabricator",
              minimumLevel: 1,
            },
            buildTicks: 180,
            runtimeAttributes: {
              health: 100,
              status: "online",
              crewCapacity: 0,
              powerDrawKw: {
                offline: 0,
                online: 0,
                active: 0,
                damaged: 0,
              },
              powerGenerationKw: 12,
              degradedStormGenerationKw: 3,
              maintenanceHoursPer100Ticks: 4,
              surfaceAreaM2: 28,
            },
            capabilities: ["solar-generation"],
          },
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-construction-cancel-"));
      const habitatDir = join(tempDir, ".habitat");
      mkdirSync(habitatDir, { recursive: true });

      writeFileSync(
        join(habitatDir, "registration.json"),
        `${JSON.stringify(
          {
            habitatUuid: "dea23d87-6938-4338-a868-f351f633dc62",
            habitatId: "habitat_dea23d87_6938_4338_a868_f351f633dc62",
            displayName: "Kepler Frontier",
            baseUrl,
            registeredAt: "2026-07-07T18:35:56.464Z",
            starterModules: [],
            blueprints: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      writeFileSync(
        join(habitatDir, "modules.json"),
        `${JSON.stringify(
          [
            createModule({
              id: "fabricator-1",
              alias: "workshop-fabricator-1",
              blueprintId: "workshop-fabricator",
              moduleType: "workshop-fabricator",
              displayName: "Workshop Fabricator",
              runtimeAttributes: {
                status: "online",
                crewCapacity: 1,
                physicalVolumeM3: 20,
                rawMaterialBufferKg: 1500,
                inProcessStorageM3: 3,
                powerDrawKw: {
                  online: 1,
                  active: 8,
                  damaged: 1,
                },
              },
              capabilities: ["basic-fabrication"],
            }),
            createModule({
              id: "supply-1",
              alias: "supply-1",
              blueprintId: "supply-cache",
              moduleType: "supply-cache",
              displayName: "Supply Cache",
              runtimeAttributes: {
                status: "offline",
                physicalVolumeM3: 25,
                storageMassKg: 6000,
                cargoVolumeM3: 18,
                inventory: {
                  ferrite: 120,
                  "silicate-glass": 60,
                  "conductive-ore": 30,
                },
                powerDrawKw: {
                  offline: 0,
                  online: 0,
                  active: 0,
                  damaged: 0,
                },
              },
              capabilities: ["storage"],
            }),
          ],
          null,
          2,
        )}\n`,
        "utf8",
      );

      const construct = await runCli(["construct", "small-solar-array"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(construct.status, 0, construct.stderr);

      const cancel = await runCli(["construction", "cancel", "workshop-fabricator-1"], {
        cwd: tempDir,
      });

      assert.equal(cancel.status, 0, cancel.stderr);
      assert.match(cancel.stdout, /Cancelled construction job for workshop-fabricator-1\./);
      assert.match(cancel.stdout, /No materials were refunded\./);

      const status = await runCli(["construction", "status"], { cwd: tempDir });
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /No active construction jobs\./);

      const inventory = await runCli(["inventory", "list"], { cwd: tempDir });
      assert.equal(inventory.status, 0, inventory.stderr);
      assert.match(inventory.stdout, /ferrite\s+30/);
      assert.match(inventory.stdout, /silicate-glass\s+15/);
      assert.match(inventory.stdout, /conductive-ore\s+12/);

      const moduleList = await runCli(["module", "list"], { cwd: tempDir });
      assert.equal(moduleList.status, 0, moduleList.stderr);
      assert.doesNotMatch(moduleList.stdout, /small-solar-array-1/);
    },
  );
});

test("habitat tick does not advance construction when the fabricator is offline", async () => {
  await withMockKepler(
    {
      "/catalog/blueprints/small-solar-array": {
        status: 200,
        body: {
          blueprint: {
            id: "blueprint_kepler-442b-v1_small-solar-array",
            blueprintId: "small-solar-array",
            displayName: "Small Solar Array Blueprint",
            output: {
              itemType: "module",
              moduleType: "small-solar-array",
              quantity: 1,
            },
            inputs: {
              ferrite: 90,
              "silicate-glass": 45,
              "conductive-ore": 18,
            },
            requiredFacility: {
              moduleType: "workshop-fabricator",
              minimumLevel: 1,
            },
            buildTicks: 180,
            runtimeAttributes: {
              health: 100,
              status: "online",
              crewCapacity: 0,
              powerDrawKw: {
                offline: 0,
                online: 0,
                active: 0,
                damaged: 0,
              },
              powerGenerationKw: 12,
              degradedStormGenerationKw: 3,
              maintenanceHoursPer100Ticks: 4,
              surfaceAreaM2: 28,
            },
            capabilities: ["solar-generation"],
          },
        },
      },
    },
    async (baseUrl) => {
      const tempDir = mkdtempSync(join(tmpdir(), "habitat-construction-offline-"));
      const habitatDir = join(tempDir, ".habitat");
      mkdirSync(habitatDir, { recursive: true });

      writeFileSync(
        join(habitatDir, "registration.json"),
        `${JSON.stringify(
          {
            habitatUuid: "dea23d87-6938-4338-a868-f351f633dc62",
            habitatId: "habitat_dea23d87_6938_4338_a868_f351f633dc62",
            displayName: "Kepler Frontier",
            baseUrl,
            registeredAt: "2026-07-07T18:35:56.464Z",
            starterModules: [],
            blueprints: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      writeFileSync(
        join(habitatDir, "modules.json"),
        `${JSON.stringify(
          [
            createModule({
              id: "fabricator-1",
              alias: "fabricator-1",
              blueprintId: "workshop-fabricator",
              moduleType: "workshop-fabricator",
              displayName: "Workshop Fabricator",
              runtimeAttributes: {
                status: "online",
                crewCapacity: 1,
                physicalVolumeM3: 20,
                rawMaterialBufferKg: 1500,
                inProcessStorageM3: 3,
                powerDrawKw: {
                  online: 1,
                  active: 8,
                  damaged: 1,
                },
              },
              capabilities: ["basic-fabrication"],
            }),
            createModule({
              id: "supply-1",
              alias: "supply-1",
              blueprintId: "supply-cache",
              moduleType: "supply-cache",
              displayName: "Supply Cache",
              runtimeAttributes: {
                status: "offline",
                physicalVolumeM3: 25,
                storageMassKg: 6000,
                cargoVolumeM3: 18,
                inventory: {
                  ferrite: 120,
                  "silicate-glass": 60,
                  "conductive-ore": 30,
                },
                powerDrawKw: {
                  offline: 0,
                  online: 0,
                  active: 0,
                  damaged: 0,
                },
              },
              capabilities: ["storage"],
            }),
          ],
          null,
          2,
        )}\n`,
        "utf8",
      );

      const construct = await runCli(["construct", "small-solar-array"], {
        cwd: tempDir,
        env: {
          ...process.env,
          KEPLER_BASE_URL: baseUrl,
          KEPLER_PLANET_TOKEN: "test-token",
        },
      });

      assert.equal(construct.status, 0, construct.stderr);

      const setOffline = await runCli(["module", "set-status", "fabricator-1", "offline"], {
        cwd: tempDir,
      });
      assert.equal(setOffline.status, 0, setOffline.stderr);

      const tick = await runCli(["tick", "1"], { cwd: tempDir });
      assert.equal(tick.status, 0, tick.stderr);
      assert.doesNotMatch(tick.stdout, /Completed construction:/);

      const status = await runCli(["construction", "status"], { cwd: tempDir });
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /Active construction jobs: 1/);
      assert.match(status.stdout, /fabricator-1\s+small-solar-array\s+small-solar-array-1\s+180\s+180/);
    },
  );
});
