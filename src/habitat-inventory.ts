import { type HabitatModule } from "./habitat-store";

export type HabitatInventory = Record<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHabitatInventory(value: unknown): value is HabitatInventory {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
  );
}

function getSupplyCacheModule(modules: HabitatModule[]) {
  return modules.find((module) => module.moduleType === "supply-cache");
}

function getModuleInventory(module: HabitatModule): HabitatInventory {
  const inventory = module.runtimeAttributes.inventory;

  if (inventory === undefined) {
    return {};
  }

  if (!isHabitatInventory(inventory)) {
    throw new Error('Supply cache inventory is not valid.');
  }

  return inventory;
}

function formatInventoryRows(inventory: HabitatInventory) {
  return Object.entries(inventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceType, quantity]) => ({
      resourceType,
      quantity: String(quantity),
    }));
}

export function formatInventoryTable(modules: HabitatModule[]) {
  const { inventory } = readSupplyCacheInventory(modules);
  return formatInventoryTableFromInventory(inventory);
}

export function formatInventoryTableFromInventory(inventory: HabitatInventory) {
  const rows = formatInventoryRows(inventory);

  if (rows.length === 0) {
    return "Supply cache inventory is empty.";
  }

  const header = {
    resourceType: "Resource",
    quantity: "Quantity",
  };

  const resourceWidth = Math.max(
    header.resourceType.length,
    ...rows.map((row) => row.resourceType.length),
  );
  const quantityWidth = Math.max(
    header.quantity.length,
    ...rows.map((row) => row.quantity.length),
  );

  return [
    `${header.resourceType.padEnd(resourceWidth)}  ${header.quantity.padStart(quantityWidth)}`,
    `${"-".repeat(resourceWidth)}  ${"-".repeat(quantityWidth)}`,
    ...rows.map(
      (row) =>
        `${row.resourceType.padEnd(resourceWidth)}  ${row.quantity.padStart(quantityWidth)}`,
    ),
  ].join("\n");
}

export function readSupplyCacheInventory(modules: HabitatModule[]) {
  const supplyCache = getSupplyCacheModule(modules);

  if (!supplyCache) {
    throw new Error('No "supply-cache" module found.');
  }

  return {
    supplyCache,
    inventory: getModuleInventory(supplyCache),
  };
}

export function writeSupplyCacheInventory(
  modules: HabitatModule[],
  inventory: HabitatInventory,
) {
  const supplyCache = getSupplyCacheModule(modules);

  if (!supplyCache) {
    throw new Error('No "supply-cache" module found.');
  }

  const updatedSupplyCache: HabitatModule = {
    ...supplyCache,
    runtimeAttributes: {
      ...supplyCache.runtimeAttributes,
      inventory,
    },
    updatedAt: new Date().toISOString(),
  };

  return modules.map((module) =>
    module.id === supplyCache.id ? updatedSupplyCache : module,
  );
}

export function addSupplyCacheInventory(
  modules: HabitatModule[],
  resourceType: string,
  quantity: number,
) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer.");
  }

  const { inventory } = readSupplyCacheInventory(modules);
  const updatedInventory = {
    ...inventory,
    [resourceType]: (inventory[resourceType] ?? 0) + quantity,
  };

  return {
    inventory: updatedInventory,
    modules: writeSupplyCacheInventory(modules, updatedInventory),
  };
}

export function subtractSupplyCacheInventory(
  modules: HabitatModule[],
  requiredResources: Record<string, number>,
) {
  const { inventory } = readSupplyCacheInventory(modules);
  const updatedInventory = { ...inventory };

  for (const [resourceType, requiredQuantity] of Object.entries(requiredResources)) {
    const availableQuantity = updatedInventory[resourceType] ?? 0;

    if (availableQuantity < requiredQuantity) {
      throw new Error(
        `Insufficient local inventory for required resource "${resourceType}".`,
      );
    }

    updatedInventory[resourceType] = availableQuantity - requiredQuantity;
  }

  return {
    inventory: updatedInventory,
    modules: writeSupplyCacheInventory(modules, updatedInventory),
  };
}
