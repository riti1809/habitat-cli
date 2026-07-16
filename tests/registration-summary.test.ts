import test from "node:test";
import assert from "node:assert/strict";

import { resolveRegisteredAt, formatStreamRegistrationStatus } from "../src/registration-summary.ts";

test("resolveRegisteredAt falls back to a local timestamp when the remote response omits it", () => {
  assert.equal(
    resolveRegisteredAt(
      {
        registeredAt: undefined,
      },
      {
        registeredAt: "2026-07-10T16:06:11.967Z",
      },
    ),
    "2026-07-10T16:06:11.967Z",
  );
});

test("formatStreamRegistrationStatus prints persisted stream state without an environment token", () => {
  const lines = formatStreamRegistrationStatus({
    habitatUuid: "uuid-123",
    habitatId: "habitat-123",
    displayName: "Habitat One",
    baseUrl: "https://planet.turingguild.com",
    registeredAt: "2026-07-10T00:00:00.000Z",
    starterModules: [],
    blueprints: [],
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    apiToken: "stream-token-123",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 17,
      tickIntervalMs: 1000,
      ticksPerPulse: 4,
      status: "running",
    },
  });

  assert.deepEqual(lines, [
    "Stream URL: wss://planet.turingguild.com/planet/stream",
    "Stream API token: stream-token-123",
    "Subscriptions: ticks",
    "Registration clock tick: 17",
    "Registration stream status: running",
    "Ticks per pulse: 4",
  ]);
  assert.equal(lines.join("\n").includes("environment-token"), false);
});
