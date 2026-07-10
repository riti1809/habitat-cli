import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeModules, type HabitatModule } from "../src/habitat-store.ts";
import { createBackendApp } from "../src/server.ts";

function createTempHabitatDir() {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-backend-state-"));
  mkdirSync(join(tempDir, ".habitat"), { recursive: true });
  return tempDir;
}

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
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

async function withServer(
  handler: Parameters<typeof createServer>[0],
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(handler);

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

test("backend reads and writes module and inventory state", async () => {
  const tempDir = createTempHabitatDir();
  const supplyCache = createModule({
    id: "supply-cache-1",
    alias: "supply-1",
    moduleType: "supply-cache",
    blueprintId: "supply-cache",
    displayName: "Supply Cache",
    runtimeAttributes: {
      inventory: {
        ferrite: 10,
      },
    },
  });
  const modules = [
    supplyCache,
    createModule({
      id: "command-1",
      alias: "command-1",
      moduleType: "command-module",
      blueprintId: "command-module",
      displayName: "Command",
      runtimeAttributes: {
        status: "online",
      },
    }),
  ];

  writeModules(modules, tempDir);

  const app = createBackendApp({ cwd: tempDir, apiToken: "test-token" });
  const messages: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };

  try {
    const listResponse = await app.request("http://localhost/modules");
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json()).modules.length, 2);

    const showResponse = await app.request("http://localhost/modules/command-1");
    assert.equal(showResponse.status, 200);
    assert.equal((await showResponse.json()).module.displayName, "Command");

    const updateResponse = await app.request("http://localhost/modules/command-1", {
      method: "PUT",
      body: JSON.stringify({
        module: {
          ...modules[1],
          displayName: "Command Updated",
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).module.displayName, "Command Updated");

    const inventoryResponse = await app.request("http://localhost/inventory");
    assert.deepEqual(await inventoryResponse.json(), { inventory: { ferrite: 10 } });

    const inventoryUpdateResponse = await app.request("http://localhost/inventory", {
      method: "PUT",
      body: JSON.stringify({
        inventory: {
          ferrite: 25,
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    assert.equal(inventoryUpdateResponse.status, 200);
    assert.deepEqual(await inventoryUpdateResponse.json(), {
      inventory: {
        ferrite: 25,
      },
    });

    const updatedInventoryResponse = await app.request("http://localhost/inventory");
    assert.deepEqual(await updatedInventoryResponse.json(), {
      inventory: {
        ferrite: 25,
      },
    });

    const deleteResponse = await app.request("http://localhost/modules/command-1", {
      method: "DELETE",
    });

    assert.equal(deleteResponse.status, 204);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(messages, [
    '[habitat-api] GET /modules -> 2 modules',
    '[habitat-api] GET /modules/command-1 -> found module "command-1"',
    '[habitat-api] PUT /modules/command-1 -> updated module "Command Updated"',
    '[habitat-api] GET /inventory -> 1 resource types',
    '[habitat-api] PUT /inventory -> 1 resource types',
    '[habitat-api] GET /inventory -> 1 resource types',
    '[habitat-api] DELETE /modules/command-1 -> deleted module "command-1"',
  ]);
});
