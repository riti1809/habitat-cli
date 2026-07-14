import assert from "node:assert/strict";
import test from "node:test";

import {
  restartManagedService,
  userServiceIsLoaded,
} from "../scripts/habitat-server-launcher.mjs";

test("recognizes a loaded Habitat user service", () => {
  const runCommand = () => ({ status: 0, stdout: "loaded\n" });

  assert.equal(userServiceIsLoaded(runCommand), true);
});

test("does not treat an unavailable user service as managed", () => {
  const runCommand = () => ({ status: 1, stdout: "not-found\n" });

  assert.equal(userServiceIsLoaded(runCommand), false);
});

test("restarts the Habitat user service", () => {
  const calls = [];
  const runCommand = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };

  assert.equal(restartManagedService(runCommand), 0);
  assert.deepEqual(calls, [
    {
      command: "systemctl",
      args: ["--user", "restart", "habitat-api.service"],
      options: { stdio: "inherit" },
    },
  ]);
});
