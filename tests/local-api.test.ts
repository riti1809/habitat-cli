import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  createModule,
  deleteModule,
  getInventory,
  getModule,
  listModules,
  setInventory,
  updateModule,
} from "../src/local-api.ts";

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

test("local api client uses the backend routes", async () => {
  const requests: string[] = [];
  const previousBaseUrl = process.env.HABITAT_API_BASE_URL;

  await withServer((request, response) => {
    requests.push(`${request.method ?? "GET"} ${request.url ?? ""}`);

    if (request.url === "/modules" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          modules: [
            {
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
            },
          ],
        }),
      );
      return;
    }

    if (request.url === "/modules/module-1" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          module: {
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
          },
        }),
      );
      return;
    }

    if (request.url === "/modules" && request.method === "POST") {
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          module: {
            id: "module-2",
            alias: "module-2",
            blueprintId: "test-module",
            moduleType: "test-module",
            displayName: "Created Module",
            connectedTo: [],
            runtimeAttributes: {},
            capabilities: [],
            constructionStatus: "built",
            source: "local",
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
          },
        }),
      );
      return;
    }

    if (request.url === "/modules/module-1" && request.method === "PUT") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          module: {
            id: "module-1",
            alias: "module-1",
            blueprintId: "test-module",
            moduleType: "test-module",
            displayName: "Updated Module",
            connectedTo: [],
            runtimeAttributes: {},
            capabilities: [],
            constructionStatus: "built",
            source: "local",
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
          },
        }),
      );
      return;
    }

    if (request.url === "/modules/module-1" && request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.url === "/inventory" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ inventory: { ferrite: 10 } }));
      return;
    }

    if (request.url === "/inventory" && request.method === "PUT") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ inventory: { ferrite: 25 } }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Route not mocked" } }));
  }, async (baseUrl) => {
    process.env.HABITAT_API_BASE_URL = baseUrl;

    try {
      assert.equal((await listModules()).length, 1);
      assert.equal((await getModule("module-1")).displayName, "Test Module");
      assert.equal((await createModule({
        id: "module-2",
        alias: "module-2",
        blueprintId: "test-module",
        moduleType: "test-module",
        displayName: "Created Module",
        connectedTo: [],
        runtimeAttributes: {},
        capabilities: [],
        constructionStatus: "built",
        source: "local",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      })).displayName, "Created Module");
      assert.equal((await updateModule("module-1", {
        id: "module-1",
        alias: "module-1",
        blueprintId: "test-module",
        moduleType: "test-module",
        displayName: "Updated Module",
        connectedTo: [],
        runtimeAttributes: {},
        capabilities: [],
        constructionStatus: "built",
        source: "local",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      })).displayName, "Updated Module");
      await deleteModule("module-1");
      assert.deepEqual(await getInventory(), { ferrite: 10 });
      assert.deepEqual(await setInventory({ ferrite: 25 }), { ferrite: 25 });
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.HABITAT_API_BASE_URL;
      } else {
        process.env.HABITAT_API_BASE_URL = previousBaseUrl;
      }
    }
  });

  assert.deepEqual(requests, [
    "GET /modules",
    "GET /modules/module-1",
    "POST /modules",
    "PUT /modules/module-1",
    "DELETE /modules/module-1",
    "GET /inventory",
    "PUT /inventory",
  ]);
});
