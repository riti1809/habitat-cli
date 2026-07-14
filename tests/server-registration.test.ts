import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

import { writeRegistration, type StoredRegistration } from "../src/habitat-store.ts";
import { createBackendApp } from "../src/server.ts";

function createTempHabitatDir() {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-server-"));
  mkdirSync(join(tempDir, ".habitat"), { recursive: true });
  return tempDir;
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

function writeLocalRegistration(
  tempDir: string,
  registration: StoredRegistration,
) {
  writeRegistration(registration, tempDir);
}

test("GET /registration returns null when no local registration exists", async () => {
  const tempDir = createTempHabitatDir();
  const app = createBackendApp({ cwd: tempDir, apiToken: "test-token" });

  const response = await app.request("http://localhost/registration");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { registration: null });
});

test("backend logs each request with a summary", async () => {
  const tempDir = createTempHabitatDir();
  const app = createBackendApp({ cwd: tempDir, apiToken: "test-token" });
  const messages: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };

  try {
    await app.request("http://localhost/registration");
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(messages, [
    '[habitat-api] GET /registration -> not registered',
  ]);
});

test("GET /registration returns the stored registration envelope", async () => {
  const tempDir = createTempHabitatDir();
  const registration: StoredRegistration = {
    habitatUuid: "uuid-123",
    habitatId: "habitat-123",
    displayName: "Habitat One",
    baseUrl: "https://planet.turingguild.com",
    registeredAt: "2026-07-10T00:00:00.000Z",
    starterModules: [],
    blueprints: [],
  };

  writeLocalRegistration(tempDir, registration);

  const app = createBackendApp({ cwd: tempDir, apiToken: "test-token" });
  const response = await app.request("http://localhost/registration");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    registration: {
      habitatUuid: "uuid-123",
      habitatId: "habitat-123",
      displayName: "Habitat One",
      registeredAt: "2026-07-10T00:00:00.000Z",
      baseUrl: "https://planet.turingguild.com",
      starterModules: [],
      blueprints: [],
      apiToken: "test-token",
    },
  });
});

test("POST /registration stores the registration and hydrates starter modules", async () => {
  const tempDir = createTempHabitatDir();

  await withServer((request, response) => {
    if (request.method === "POST" && request.url === "/habitats/register") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          habitatId: "habitat-123",
          starterModules: [
            {
              id: "command-1",
              blueprintId: "command-module",
              displayName: "Command",
              connectedTo: [],
              runtimeAttributes: {},
              capabilities: [],
            },
          ],
          blueprints: [],
        }),
      );
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Route not mocked" } }));
  }, async (baseUrl) => {
    const app = createBackendApp({
      cwd: tempDir,
      apiToken: "test-token",
      keplerBaseUrl: baseUrl,
    });

    const response = await app.request("http://localhost/registration", {
      method: "POST",
      body: JSON.stringify({ displayName: "Habitat One" }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    assert.equal(response.status, 201);
    const responseBody = (await response.json()) as {
      registration: {
        habitatUuid: string;
        habitatId: string;
        displayName: string;
        registeredAt: string;
        baseUrl: string;
        starterModules: Array<{ id: string; blueprintId: string; displayName: string }>;
        blueprints: unknown[];
        lastStatus?: unknown;
        apiToken: string;
      };
    };

    assert.equal(responseBody.registration.habitatId, "habitat-123");
    assert.equal(responseBody.registration.displayName, "Habitat One");
    assert.equal(responseBody.registration.baseUrl, baseUrl);
    assert.equal(responseBody.registration.apiToken, "test-token");
    assert.equal(responseBody.registration.starterModules.length, 1);
    assert.equal(responseBody.registration.starterModules[0].id, "command-1");
    assert.equal(typeof responseBody.registration.habitatUuid, "string");
    assert.equal(typeof responseBody.registration.registeredAt, "string");

    const modulesResponse = await app.request("http://localhost/modules");
    assert.equal(modulesResponse.status, 200);
    assert.equal((await modulesResponse.json()).modules.length, 1);
  });
});

test("DELETE /registration clears stored state", async () => {
  const tempDir = createTempHabitatDir();

  await withServer((request, response) => {
    if (request.method === "DELETE" && request.url === "/habitats/habitat-123") {
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Route not mocked" } }));
  }, async (baseUrl) => {
    const registration: StoredRegistration = {
      habitatUuid: "uuid-123",
      habitatId: "habitat-123",
      displayName: "Habitat One",
      baseUrl,
      registeredAt: "2026-07-10T00:00:00.000Z",
      starterModules: [],
      blueprints: [],
    };

    writeLocalRegistration(tempDir, registration);

    const app = createBackendApp({
      cwd: tempDir,
      apiToken: "test-token",
      keplerBaseUrl: baseUrl,
    });

    const response = await app.request("http://localhost/registration", {
      method: "DELETE",
    });

    assert.equal(response.status, 204);

    const statusResponse = await app.request("http://localhost/registration");
    assert.deepEqual(await statusResponse.json(), { registration: null });

    const modulesResponse = await app.request("http://localhost/modules");
    assert.deepEqual(await modulesResponse.json(), { modules: [] });
  });
});
