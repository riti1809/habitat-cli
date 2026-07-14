export function userServiceIsLoaded(runCommand) {
  const result = runCommand(
    "systemctl",
    ["--user", "show", "habitat-api.service", "--property=LoadState", "--value"],
    { encoding: "utf8" },
  );

  return result.status === 0 && result.stdout?.trim() === "loaded";
}

export function restartManagedService(runCommand) {
  const result = runCommand(
    "systemctl",
    ["--user", "restart", "habitat-api.service"],
    { stdio: "inherit" },
  );

  return result.status ?? 1;
}

export async function waitForServer(
  probe,
  { attempts = 50, wait = () => new Promise((resolve) => setTimeout(resolve, 100)) } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probe()) {
      return true;
    }

    if (attempt < attempts - 1) {
      await wait();
    }
  }

  return false;
}
