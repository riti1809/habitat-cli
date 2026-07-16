import { openHabitatDatabase } from "./habitat-state-db";
import { readModules, readRegistration, type HabitatModule } from "./habitat-store";
import { observeAlert, resolveAlert } from "./alerts";

export const EXPLORATION_BOUNDS = {
  minX: -25,
  maxX: 24,
  minY: -25,
  maxY: 24,
} as const;

export const DEFAULT_CARRYING_CAPACITY_KG = 20;

export type ExplorationState = {
  deployedHumanId: string | null;
  x: number;
  y: number;
  carriedResources: Record<string, number>;
  maxCarryingCapacityKg: number;
};

type ExplorationRow = {
  deployed_human_id: string | null;
  x: number;
  y: number;
  carried_resources_json: string;
  max_carrying_capacity_kg: number;
};

export class ExplorationError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

function emptyState(): ExplorationState {
  return {
    deployedHumanId: null,
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: DEFAULT_CARRYING_CAPACITY_KG,
  };
}

export function readExplorationState(cwd = process.cwd()): ExplorationState {
  const database = openHabitatDatabase(cwd);
  try {
    const row = database.query(
      `SELECT deployed_human_id, x, y, carried_resources_json,
              max_carrying_capacity_kg
         FROM exploration_state WHERE id = 1`,
    ).get() as ExplorationRow | null;
    if (!row) return emptyState();
    return {
      deployedHumanId: row.deployed_human_id,
      x: row.x,
      y: row.y,
      carriedResources: JSON.parse(row.carried_resources_json) as Record<string, number>,
      maxCarryingCapacityKg: row.max_carrying_capacity_kg,
    };
  } finally {
    database.close();
  }
}

export function writeExplorationState(state: ExplorationState, cwd = process.cwd()) {
  const database = openHabitatDatabase(cwd);
  try {
    database.run(
      `INSERT INTO exploration_state
        (id, deployed_human_id, x, y, carried_resources_json, max_carrying_capacity_kg)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        deployed_human_id = excluded.deployed_human_id,
        x = excluded.x,
        y = excluded.y,
        carried_resources_json = excluded.carried_resources_json,
        max_carrying_capacity_kg = excluded.max_carrying_capacity_kg`,
      [state.deployedHumanId, state.x, state.y, JSON.stringify(state.carriedResources), state.maxCarryingCapacityKg],
    );
  } finally {
    database.close();
  }
}

function findSuitport(modules: HabitatModule[]) {
  return modules.find((module) => module.capabilities.includes("suitport-access"));
}

export function deployExplorer(humanId: string, cwd = process.cwd()) {
  const registration = readRegistration(cwd);
  const humans = registration?.starterHumans ?? [];
  const human = humans.find((item) => item.id === humanId);
  if (!human) throw new ExplorationError(`Human "${humanId}" was not found.`, 404);

  const suitport = findSuitport(readModules(cwd));
  if (!suitport) throw new ExplorationError("No active basic suitport is available.", 409);
  const suitportStatus = suitport.runtimeAttributes.status;
  if (suitportStatus !== "online" && suitportStatus !== "active") {
    throw new ExplorationError("The basic suitport is not active.", 409);
  }
  if (human.locationModuleId !== suitport.id) {
    throw new ExplorationError(`Human "${humanId}" must be in the active suitport.`, 409);
  }

  const state = readExplorationState(cwd);
  if (state.deployedHumanId !== null) {
    throw new ExplorationError(`Human "${state.deployedHumanId}" is already deployed.`, 409);
  }

  const next = { ...state, deployedHumanId: humanId, x: 0, y: 0, carriedResources: {} };
  writeExplorationState(next, cwd);
  observeAlert("explorer-deployed", { message: "A human is deployed outside the habitat.", severity: "warning", source: "habitat.exploration", subject: { humanId } }, cwd);
  return next;
}

export function moveExplorer(x: number, y: number, cwd = process.cwd()) {
  const state = readExplorationState(cwd);
  if (!state.deployedHumanId) throw new ExplorationError("No human is deployed.", 409);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new ExplorationError("Coordinates must be integers.", 400);
  if (Math.abs(x - state.x) + Math.abs(y - state.y) !== 1) {
    throw new ExplorationError("Move exactly one adjacent grid tile.", 400);
  }
  if (x < EXPLORATION_BOUNDS.minX || x > EXPLORATION_BOUNDS.maxX || y < EXPLORATION_BOUNDS.minY || y > EXPLORATION_BOUNDS.maxY) {
    throw new ExplorationError("Destination is outside the current Kepler sector.", 400);
  }
  const next = { ...state, x, y };
  writeExplorationState(next, cwd);
  if (Object.values(next.carriedResources).reduce((sum, quantity) => sum + quantity, 0) >= next.maxCarryingCapacityKg) {
    observeAlert("explorer-capacity-reached", { message: "Carried material has reached explorer capacity.", severity: "warning", source: "habitat.exploration", subject: { humanId: next.deployedHumanId ?? undefined } }, cwd);
  }
  return next;
}

export function dockExplorer(cwd = process.cwd()) {
  const state = readExplorationState(cwd);
  if (!state.deployedHumanId) throw new ExplorationError("No human is deployed.", 409);
  if (state.x !== 0 || state.y !== 0) throw new ExplorationError("Docking is only allowed at (0, 0).", 400);

  const registration = readRegistration(cwd);
  const modules = readModules(cwd);
  if (!registration) throw new ExplorationError("No local registration found.", 404);
  const suitport = findSuitport(modules);
  if (!suitport) throw new ExplorationError("No suitport module is available.", 409);
  if (!modules.some((module) => module.moduleType === "supply-cache")) {
    throw new ExplorationError('No "supply-cache" module found.', 409);
  }

  const human = registration.starterHumans?.find((item) => item.id === state.deployedHumanId);
  if (!human) throw new ExplorationError(`Human "${state.deployedHumanId}" was not found.`, 404);

  const database = openHabitatDatabase(cwd);
  try {
    const transaction = database.transaction(() => {
      const supplyCache = modules.find((module) => module.moduleType === "supply-cache")!;
      const currentInventory = supplyCache.runtimeAttributes.inventory;
      if (currentInventory !== undefined &&
          (typeof currentInventory !== "object" || currentInventory === null ||
           Object.values(currentInventory).some((quantity) => typeof quantity !== "number" || quantity < 0))) {
        throw new Error("Supply cache inventory is not valid.");
      }
      const inventory = { ...(currentInventory as Record<string, number> | undefined) };
      for (const [resourceType, quantity] of Object.entries(state.carriedResources)) {
        inventory[resourceType] = (inventory[resourceType] ?? 0) + quantity;
      }

      const updatedModules = modules.map((module) => module.id === supplyCache.id
        ? { ...module, runtimeAttributes: { ...module.runtimeAttributes, inventory }, updatedAt: new Date().toISOString() }
        : module);
      const updatedHumans = registration.starterHumans!.map((item) => item.id === human.id
        ? { ...item, locationModuleId: suitport.id }
        : item);

      database.run(
        `UPDATE modules SET runtime_attributes_json = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(updatedModules.find((module) => module.id === supplyCache.id)!.runtimeAttributes), updatedModules.find((module) => module.id === supplyCache.id)!.updatedAt, supplyCache.id],
      );
      database.run(
        `UPDATE registration SET starter_humans_json = ? WHERE habitat_uuid = ?`,
        [JSON.stringify(updatedHumans), registration.habitatUuid],
      );
      database.run(
        `INSERT INTO exploration_state
          (id, deployed_human_id, x, y, carried_resources_json, max_carrying_capacity_kg)
         VALUES (1, NULL, 0, 0, '{}', ?)
         ON CONFLICT(id) DO UPDATE SET
          deployed_human_id = NULL, x = 0, y = 0, carried_resources_json = '{}',
          max_carrying_capacity_kg = excluded.max_carrying_capacity_kg`,
        [state.maxCarryingCapacityKg],
      );
    });
    transaction();
    resolveAlert("explorer-deployed", cwd);
    resolveAlert("explorer-capacity-reached", cwd);
  } finally {
    database.close();
  }

  return readExplorationState(cwd);
}

export function formatExplorationStatus(state: ExplorationState) {
  return [
    `Deployed human: ${state.deployedHumanId ?? "none"}`,
    `Position: (${state.x}, ${state.y})`,
    `Carried resources: ${Object.keys(state.carriedResources).length === 0 ? "none" : JSON.stringify(state.carriedResources)}`,
    `Carrying capacity: ${state.maxCarryingCapacityKg} kg`,
  ].join("\n");
}
