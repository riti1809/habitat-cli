import { openHabitatDatabase } from "./habitat-state-db";
import { readModules, readRegistration, type HabitatModule } from "./habitat-store";

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
  return next;
}

export function dockExplorer(cwd = process.cwd()) {
  const state = readExplorationState(cwd);
  if (!state.deployedHumanId) throw new ExplorationError("No human is deployed.", 409);
  if (state.x !== 0 || state.y !== 0) throw new ExplorationError("Docking is only allowed at (0, 0).", 400);
  const next = { ...state, deployedHumanId: null, carriedResources: {} };
  writeExplorationState(next, cwd);
  return next;
}

export function formatExplorationStatus(state: ExplorationState) {
  return [
    `Deployed human: ${state.deployedHumanId ?? "none"}`,
    `Position: (${state.x}, ${state.y})`,
    `Carried resources: ${Object.keys(state.carriedResources).length === 0 ? "none" : JSON.stringify(state.carriedResources)}`,
    `Carrying capacity: ${state.maxCarryingCapacityKg} kg`,
  ].join("\n");
}
