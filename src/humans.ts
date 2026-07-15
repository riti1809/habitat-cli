import {
  readModules,
  readRegistration,
  writeRegistration,
  type HabitatModule,
  type StarterHuman,
} from "./habitat-store";

export type HabitatHuman = StarterHuman;

export class HumanMoveError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
  }
}

export function readHabitatHumans(cwd = process.cwd()): HabitatHuman[] {
  return readRegistration(cwd)?.starterHumans ?? [];
}

function findModule(modules: HabitatModule[], moduleId: string) {
  return modules.find((module) => module.id === moduleId || module.alias === moduleId);
}

export function moveHabitatHuman(
  humanId: string,
  destinationModuleId: string,
  cwd = process.cwd(),
) {
  const registration = readRegistration(cwd);
  const humans = registration?.starterHumans ?? [];
  const human = humans.find((item) => item.id === humanId);

  if (!human) {
    throw new HumanMoveError(`Human "${humanId}" was not found.`, 404);
  }

  const modules = readModules(cwd);
  const destination = findModule(modules, destinationModuleId);

  if (!destination) {
    throw new HumanMoveError(
      `Module "${destinationModuleId}" was not found.`,
      404,
    );
  }

  if (human.locationModuleId !== destination.id) {
    const occupants = humans.filter(
      (item) => item.locationModuleId === destination.id,
    ).length;
    const crewCapacity = destination.runtimeAttributes.crewCapacity;

    if (typeof crewCapacity !== "number" || occupants >= crewCapacity) {
      throw new HumanMoveError(
        `Module "${destination.id}" has no open crew capacity.`,
        409,
      );
    }
  }

  const movedHuman = {
    ...human,
    locationModuleId: destination.id,
  };
  writeRegistration({
    ...registration!,
    starterHumans: humans.map((item) =>
      item.id === humanId ? movedHuman : item,
    ),
  }, cwd);

  return movedHuman;
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
