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

const bunExecutable = candidates.find(canRun);

if (!bunExecutable) {
  console.error("Bun is required to run this command.");
  process.exit(1);
}

const result = spawnSync(bunExecutable, process.argv.slice(2), {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
