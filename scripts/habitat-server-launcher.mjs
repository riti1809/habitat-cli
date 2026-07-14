export function userServiceIsLoaded(runCommand) {
  const result = runCommand(
    "systemctl",
    ["--user", "show", "habitat-api.service", "--property=LoadState", "--value"],
    { encoding: "utf8" },
  );

  return result.status === 0 && result.stdout?.trim() === "loaded";
}

export function stopManagedService(runCommand) {
  const result = runCommand(
    "systemctl",
    ["--user", "stop", "habitat-api.service"],
    { stdio: "inherit" },
  );

  return result.status ?? 1;
}
