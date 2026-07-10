import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { getBlueprint, listBlueprints } from "../src/kepler-blueprints.ts";
import { listResources } from "../src/kepler-resources.ts";
import { getSolarIrradiance } from "../src/kepler-solar.ts";

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

test("CLI catalog clients call the local backend", async () => {
  const requests: string[] = [];
  const previousBaseUrl = process.env.HABITAT_API_BASE_URL;

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

    if (request.url === "/solar/irradiance") {
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
  }, async (baseUrl) => {
    process.env.HABITAT_API_BASE_URL = baseUrl;

    try {
      assert.deepEqual(await listBlueprints(), [
        {
          id: "blueprint-1",
          blueprintId: "survey-rover",
          displayName: "Survey Rover",
        },
      ]);
      assert.deepEqual(await getBlueprint("survey-rover"), {
        id: "blueprint-1",
        blueprintId: "survey-rover",
        displayName: "Survey Rover",
        description: "A rover blueprint.",
      });
      assert.deepEqual(await listResources(), [
        {
          id: "resource-1",
          resourceType: "ferrite",
          displayName: "Ferrite",
          kind: "ore",
          rarity: "common",
        },
      ]);
      assert.deepEqual(await getSolarIrradiance(), {
        wPerM2: 720,
        condition: "clear",
      });
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.HABITAT_API_BASE_URL;
      } else {
        process.env.HABITAT_API_BASE_URL = previousBaseUrl;
      }
    }
  });

  assert.deepEqual(requests, [
    "/catalog/blueprints",
    "/catalog/blueprints/survey-rover",
    "/catalog/resources",
    "/solar/irradiance",
  ]);
});
