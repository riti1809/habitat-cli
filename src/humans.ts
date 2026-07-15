import { readRegistration, type StarterHuman } from "./habitat-store";

export type HabitatHuman = StarterHuman;

export function readHabitatHumans(cwd = process.cwd()): HabitatHuman[] {
  return readRegistration(cwd)?.starterHumans ?? [];
}

export function formatHumanList(humans: HabitatHuman[]) {
  if (humans.length === 0) {
    return "No humans found.";
  }

  const rows = humans.map((human) => ({
    id: human.id,
    name: human.displayName,
    location: human.locationModuleId,
  }));
  const widths = {
    id: Math.max("ID".length, ...rows.map((row) => row.id.length)),
    name: Math.max("Name".length, ...rows.map((row) => row.name.length)),
    location: Math.max("Location Module".length, ...rows.map((row) => row.location.length)),
  };

  return [
    `${"ID".padEnd(widths.id)}  ${"Name".padEnd(widths.name)}  ${"Location Module".padEnd(widths.location)}`,
    `${"-".repeat(widths.id)}  ${"-".repeat(widths.name)}  ${"-".repeat(widths.location)}`,
    ...rows.map((row) =>
      `${row.id.padEnd(widths.id)}  ${row.name.padEnd(widths.name)}  ${row.location.padEnd(widths.location)}`,
    ),
  ].join("\n");
}
