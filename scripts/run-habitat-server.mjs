import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  restartManagedService,
  userServiceIsLoaded,
  waitForServer,
} from "./habitat-server-launcher.mjs";

const candidates = [
  process.env.BUN_BIN,
  "bun",
  "/home/ritip/.bun/bin/bun",
  "/mnt/c/Users/ritip/.bun/bin/bun.exe",
].filter(Boolean);

function canRun(candidate) {
  if (candidate !== "bun" && !existsSync(candidate)) {
    return false;
  }

  const result = spawnSync(candidate, ["--version"], {
    stdio: "ignore",
  });

  return result.status === 0;
}

function findBunExecutable() {
  const bunExecutable = candidates.find(canRun);

  if (!bunExecutable) {
    console.error("Bun is required to run the server.");
    process.exit(1);
  }

  return bunExecutable;
}

function getListenPort() {
  const rawPort = process.env.HABITAT_API_PORT ?? "8787";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("HABITAT_API_PORT must be a valid TCP port number.");
    process.exit(1);
  }

  return port;
}

if (userServiceIsLoaded(spawnSync)) {
  const status = restartManagedService(spawnSync);

  if (status !== 0) {
    process.exit(status);
  }

  const port = getListenPort();
  const ready = await waitForServer(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/registration`);
      return response.ok;
    } catch {
      return false;
    }
  });

  if (!ready) {
    console.error("Habitat API did not become ready after restarting through systemd.");
    process.exit(1);
  }

  console.log("Habitat API restarted through systemd and is listening.");
  process.exit(0);
}

const bunExecutable = findBunExecutable();
const result = spawnSync(bunExecutable, ["run", "src/server.ts"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
