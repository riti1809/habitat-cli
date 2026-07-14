import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBackendApp } from "../src/server.ts";
import { scanWorld } from "../src/local-api.ts";
import { writeRegistration, type StoredRegistration } from "../src/habitat-store.ts";
import { formatWorldScan } from "../src/world-scan.ts";

function createTempHabitatDir() {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-scan-"));
  mkdirSync(join(tempDir, ".habitat"), { recursive: true });
  return tempDir;
}

async function withKeplerServer(
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
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function writeLocalRegistration(cwd: string) {
  const registration: StoredRegistration = {
    habitatUuid: "uuid-123",
    habitatId: "habitat-123",
    displayName: "Habitat One",
    baseUrl: "https://planet.turingguild.com",
    registeredAt: "2026-07-10T00:00:00.000Z",
    starterModules: [],
    blueprints: [],
  };

  writeRegistration(registration, cwd);
}

test("world scan proxies the saved habitat ID and returns Kepler data", async () => {
  const tempDir = createTempHabitatDir();
  writeLocalRegistration(tempDir);
  const requests: string[] = [];

  await withKeplerServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        scan: {
          modelVersion: "resource-probability-v2",
          origin: { x: 3, y: -2 },
          sensorStrength: 60,
          radiusTiles: 0,
          tiles: [],
        },
      }),
    );
  }, async (keplerBaseUrl) => {
    const app = createBackendApp({
      cwd: tempDir,
      apiToken: "test-token",
      keplerBaseUrl,
    });

    const response = await app.request(
      "http://localhost/world/scan?x=3&y=-2&sensorStrength=60&radiusTiles=0",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      scan: {
        modelVersion: "resource-probability-v2",
        origin: { x: 3, y: -2 },
        sensorStrength: 60,
        radiusTiles: 0,
        tiles: [],
      },
    });
  });

  assert.deepEqual(requests, [
    "/world/scan?habitatId=habitat-123&x=3&y=-2&sensorStrength=60&radiusTiles=0",
  ]);
});

test("world scan rejects invalid scan parameters before calling Kepler", async () => {
  const tempDir = createTempHabitatDir();
  writeLocalRegistration(tempDir);
  let keplerCalls = 0;

  await withKeplerServer((request, response) => {
    keplerCalls += 1;
    response.writeHead(500);
    response.end();
  }, async (keplerBaseUrl) => {
    const app = createBackendApp({
      cwd: tempDir,
      apiToken: "test-token",
      keplerBaseUrl,
    });

    const response = await app.request(
      "http://localhost/world/scan?x=3&y=-2&sensorStrength=101&radiusTiles=0",
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { message: "sensorStrength must be an integer from 0 to 100." },
    });
  });

  assert.equal(keplerCalls, 0);
});

test("local scan client calls the local Habitat API", async () => {
  const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ scan: { tiles: [] } }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine mock server address.");
  }

  process.env.HABITAT_API_BASE_URL = `http://127.0.0.1:${address.port}`;

  try {
    assert.deepEqual(await scanWorld(3, -2, 60, 0), { scan: { tiles: [] } });
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.HABITAT_API_BASE_URL;
    } else {
      process.env.HABITAT_API_BASE_URL = previousBaseUrl;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  assert.deepEqual(requests, [
    "/world/scan?x=3&y=-2&sensorStrength=60&radiusTiles=0",
  ]);
});

test("world scan formatting shows the full one-tile probability table", () => {
  const output = formatWorldScan({
    scan: {
      modelVersion: "resource-probability-v2",
      origin: { x: 3, y: -2 },
      sensorStrength: 60,
      radiusTiles: 0,
      tiles: [
        {
          x: 3,
          y: -2,
          terrain: "flat",
          distanceTiles: 0,
          probabilities: [
            { resourceType: "ferrite", probabilityPct: 72.5 },
            { resourceType: null, probabilityPct: 27.5 },
          ],
          topCandidate: { resourceType: "ferrite", probabilityPct: 72.5 },
          quantityEstimate: {
            resourceType: "ferrite",
            unit: "kg",
            estimatedKg: 184,
            minimumKg: 184,
            maximumKg: 184,
            exact: true,
          },
        },
      ],
    },
  });

  assert.match(output, /Resource\s+Probability/);
  assert.match(output, /ferrite\s+72\.50%/);
  assert.match(output, /Quantity estimate: ferrite: 184 kg exact/);
});

test("world scan formatting summarizes multiple tiles", () => {
  const output = formatWorldScan({
    scan: {
      modelVersion: "resource-probability-v2",
      origin: { x: 0, y: 0 },
      sensorStrength: 40,
      radiusTiles: 1,
      tiles: [
        {
          x: 0,
          y: 0,
          terrain: "flat",
          distanceTiles: 0,
          probabilities: [],
          topCandidate: { resourceType: "ferrite", probabilityPct: 88 },
          quantityEstimate: null,
        },
        {
          x: 1,
          y: -1,
          terrain: "flat",
          distanceTiles: 1.414,
          probabilities: [],
          topCandidate: { resourceType: null, probabilityPct: 51.25 },
          quantityEstimate: null,
        },
      ],
    },
  });

  assert.match(output, /X\s+Y\s+Distance\s+Terrain\s+Top Candidate\s+Confidence/);
  assert.match(output, /ferrite/);
  assert.match(output, /none/);
  assert.match(output, /51\.25%/);
});
