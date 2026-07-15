import {
  readExplorationState,
  writeExplorationState,
  ExplorationError,
  type ExplorationState,
} from "./exploration";
import { readRegistration } from "./habitat-store";

export type WorldCollection = {
  x: number;
  y: number;
  resourceType: string;
  unit: "kg";
  collectedKg: number;
  remainingKg: number;
};

export type WorldCollectionResponse = {
  collection: WorldCollection;
};

export function validateCollection(quantityKg: number, cwd = process.cwd()) {
  const state = readExplorationState(cwd);
  if (!state.deployedHumanId) {
    throw new ExplorationError("No human is deployed. Deploy a human before collecting.", 409);
  }
  if (!Number.isInteger(quantityKg) || quantityKg <= 0) {
    throw new ExplorationError("Collection quantity must be a positive whole number.", 400);
  }

  const carriedKg = Object.values(state.carriedResources).reduce((total, quantity) => total + quantity, 0);
  if (carriedKg + quantityKg > state.maxCarryingCapacityKg) {
    throw new ExplorationError(
      `Collection would exceed carrying capacity (${state.maxCarryingCapacityKg} kg).`,
      409,
    );
  }

  const registration = readRegistration(cwd);
  if (!registration) throw new ExplorationError("No local registration found.", 404);
  return { state, habitatId: registration.habitatId };
}

export function persistCollection(
  state: ExplorationState,
  collection: WorldCollection,
  cwd = process.cwd(),
) {
  if (collection.collectedKg <= 0 || collection.unit !== "kg" || !collection.resourceType) {
    throw new Error("Kepler returned an invalid collection response.");
  }
  if (collection.collectedKg > state.maxCarryingCapacityKg -
      Object.values(state.carriedResources).reduce((total, quantity) => total + quantity, 0)) {
    throw new Error("Kepler returned more material than the available carrying capacity.");
  }

  const next: ExplorationState = {
    ...state,
    carriedResources: {
      ...state.carriedResources,
      [collection.resourceType]: (state.carriedResources[collection.resourceType] ?? 0) + collection.collectedKg,
    },
  };
  writeExplorationState(next, cwd);
  return next;
}

export function formatCollection(collection: WorldCollection, state: ExplorationState) {
  return [
    `Collected: ${collection.collectedKg} kg ${collection.resourceType}`,
    `Position: (${collection.x}, ${collection.y})`,
    `Carrying: ${Object.values(state.carriedResources).reduce((total, quantity) => total + quantity, 0)} / ${state.maxCarryingCapacityKg} kg`,
  ].join("\n");
}
