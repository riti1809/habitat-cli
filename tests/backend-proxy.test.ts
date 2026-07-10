import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBackendApp } from "../src/server.ts";

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

function createTempHabitatDir() {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-backend-"));
  mkdirSync(join(tempDir, ".habitat"), { recursive: true });
  return tempDir;
}

test("backend proxies catalog and solar routes to Kepler", async () => {
  const requests: string[] = [];
  const messages: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };

  try {
    await withServer((request, response) => {
      requests.push(request.url ?? "");

      if (request.url === "/catalog/blueprints") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            blueprints: [
              {
                id: "blueprint-1",
                blueprintId: "survey-rover",
                displayName: "Survey Rover",
              },
            ],
          }),
        );
        return;
      }

      if (request.url === "/catalog/blueprints/survey-rover") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            blueprint: {
              id: "blueprint-1",
              blueprintId: "survey-rover",
              displayName: "Survey Rover",
              description: "A rover blueprint.",
            },
          }),
        );
        return;
      }

      if (request.url === "/catalog/resources") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            resources: [
              {
                id: "resource-1",
                resourceType: "ferrite",
                displayName: "Ferrite",
                kind: "ore",
                rarity: "common",
              },
            ],
          }),
        );
        return;
      }

      if (request.url === "/world/solar-irradiance") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            solarIrradiance: {
              wPerM2: 720,
              condition: "clear",
            },
          }),
        );
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Route not mocked" } }));
    }, async (keplerBaseUrl) => {
      const tempDir = createTempHabitatDir();
      const app = createBackendApp({
        cwd: tempDir,
        apiToken: "test-token",
        keplerBaseUrl,
        keplerToken: "test-token",
      });

      const blueprintsResponse = await app.request("http://localhost/catalog/blueprints");
      const blueprintResponse = await app.request(
        "http://localhost/catalog/blueprints/survey-rover",
      );
      const resourcesResponse = await app.request("http://localhost/catalog/resources");
      const solarResponse = await app.request("http://localhost/solar/irradiance");

      assert.deepEqual(await blueprintsResponse.json(), {
        blueprints: [
          {
            id: "blueprint-1",
            blueprintId: "survey-rover",
            displayName: "Survey Rover",
          },
        ],
      });
      assert.deepEqual(await blueprintResponse.json(), {
        blueprint: {
          id: "blueprint-1",
          blueprintId: "survey-rover",
          displayName: "Survey Rover",
          description: "A rover blueprint.",
        },
      });
      assert.deepEqual(await resourcesResponse.json(), {
        resources: [
          {
            id: "resource-1",
            resourceType: "ferrite",
            displayName: "Ferrite",
            kind: "ore",
            rarity: "common",
          },
        ],
      });
      assert.deepEqual(await solarResponse.json(), {
        solarIrradiance: {
          wPerM2: 720,
          condition: "clear",
        },
      });

      assert.deepEqual(requests, [
        "/catalog/blueprints",
        "/catalog/blueprints/survey-rover",
        "/catalog/resources",
        "/world/solar-irradiance",
      ]);
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(messages, [
    "[habitat-api] GET /catalog/blueprints -> proxied to Kepler",
    "[kepler] GET /catalog/blueprints -> 200",
    "[habitat-api] GET /catalog/blueprints/survey-rover -> proxied to Kepler",
    "[kepler] GET /catalog/blueprints/survey-rover -> 200",
    "[habitat-api] GET /catalog/resources -> proxied to Kepler",
    "[kepler] GET /catalog/resources -> 200",
    "[habitat-api] GET /solar/irradiance -> proxied to Kepler",
    "[kepler] GET /world/solar-irradiance -> 200",
  ]);
});
