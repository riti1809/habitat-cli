import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeRegistration, type StoredRegistration } from "../src/habitat-store.ts";
import { createBackendApp } from "../src/server.ts";

function createTempHabitatDir() {
  const tempDir = mkdtempSync(join(tmpdir(), "habitat-server-"));
  mkdirSync(join(tempDir, ".habitat"), { recursive: true });
  return tempDir;
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
      apiToken: "test-token",
    },
  });
});
