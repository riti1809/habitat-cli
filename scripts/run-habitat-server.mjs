import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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

function findListenerPid(port) {
  const result = spawnSync("ss", ["-ltnp"], {
    encoding: "utf8",
  });

  if (result.status !== 0 || !result.stdout) {
    return undefined;
  }

  const line = result.stdout
    .split("\n")
    .find((entry) => entry.includes(`:${port} `));

  if (!line) {
    return undefined;
  }

  const match = line.match(/pid=(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function hasListener(port) {
  return findListenerPid(port) !== undefined;
}

function killPid(pid) {
  function isAlive(targetPid) {
    try {
      process.kill(targetPid, 0);
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
        return false;
      }

      throw error;
    }
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      return;
    }

    throw error;
  }

  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
        return;
      }

      throw error;
    }
  }
}

function waitForPortToClear(port, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  const pause = new Int32Array(new SharedArrayBuffer(4));

  while (Date.now() < deadline) {
    if (!hasListener(port)) {
      return;
    }

    Atomics.wait(pause, 0, 0, 50);
  }

  if (hasListener(port)) {
    console.warn(`Port ${port} was still busy after cleanup. Starting anyway.`);
  }
}

const port = getListenPort();
const listenerPid = findListenerPid(port);

if (listenerPid) {
  killPid(listenerPid);
  waitForPortToClear(port);
}

const bunExecutable = findBunExecutable();
const result = spawnSync(bunExecutable, ["run", "src/server.ts"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
