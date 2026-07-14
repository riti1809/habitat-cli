import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  stopManagedService,
  userServiceIsLoaded,
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

if (userServiceIsLoaded(spawnSync)) {
  const status = stopManagedService(spawnSync);

  if (status !== 0) {
    process.exit(status);
  }
}

const bunExecutable = findBunExecutable();
const result = spawnSync(bunExecutable, ["run", "src/server.ts"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
