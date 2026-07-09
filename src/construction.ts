import type { BlueprintDetail } from "./kepler-blueprints";
import { getBlueprint } from "./kepler-blueprints";
import { getCurrentModuleState } from "./power-tick";
import {
  type ConstructionJob,
  type HabitatModule,
  readModules,
  readRegistration,
  writeModules,
} from "./habitat-store";
import {
  subtractSupplyCacheInventory,
  type HabitatInventory,
} from "./habitat-inventory";

export type ConstructionResult = {
  blueprint: BlueprintDetail;
  fabricator: HabitatModule;
  inventory: HabitatInventory;
};

type ConstructionStatusRow = {
  fabricator: string;
  blueprintId: string;
  outputModuleId: string;
  remainingTicks: string;
  buildTicks: string;
};

type ConstructionAdvanceResult = {
  modules: HabitatModule[];
  completedModuleIds: string[];
};

type ConstructionCancelResult = {
  modules: HabitatModule[];
  cancelledBlueprintId: string;
  fabricatorAlias: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getRequiredResources(blueprint: BlueprintDetail) {
  if (!isRecord(blueprint.inputs)) {
    throw new Error(
      `Blueprint "${blueprint.blueprintId}" does not define required inputs.`,
    );
  }

  const requiredResources: Record<string, number> = {};

  for (const [resourceType, quantity] of Object.entries(blueprint.inputs)) {
    const amount = getNumber(quantity);

    if (amount === undefined || amount < 0) {
      throw new Error(
        `Blueprint "${blueprint.blueprintId}" has invalid input requirements.`,
      );
    }

    requiredResources[resourceType] = amount;
  }

  return requiredResources;
}

function getOutputModuleType(blueprint: BlueprintDetail) {
  if (!isRecord(blueprint.output)) {
    throw new Error(
      `Blueprint "${blueprint.blueprintId}" does not define a module output.`,
    );
  }

  const itemType = getString(blueprint.output.itemType);
  const moduleType = getString(blueprint.output.moduleType);

  if (itemType !== "module" || !moduleType) {
    throw new Error(
      `Blueprint "${blueprint.blueprintId}" does not produce a module output.`,
    );
  }

  return moduleType;
}

function getBuildTicks(blueprint: BlueprintDetail): number {
  const buildTicks = blueprint.buildTicks;

  if (typeof buildTicks !== "number" || !Number.isInteger(buildTicks) || buildTicks <= 0) {
    throw new Error(
      `Blueprint "${blueprint.blueprintId}" does not define a valid build duration.`,
    );
  }

  return buildTicks;
}

function getWorkshopFabricator(modules: HabitatModule[]) {
  return modules.find((module) => module.moduleType === "workshop-fabricator");
}

function getModuleByIdOrAlias(modules: HabitatModule[], moduleId: string) {
  return modules.find((module) => module.id === moduleId || module.alias === moduleId);
}

function ensureConstructionJobSlot(module: HabitatModule) {
  if (module.constructionJob) {
    throw new Error(`Fabricator "${module.alias}" already has a construction job.`);
  }
}

function formatTicks(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(0);
}

function isConstructionPowered(module: HabitatModule) {
  const state = getCurrentModuleState(module);
  return state === "active" || state === "online";
}

function toDisplayName(moduleType: string) {
  return moduleType
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getNextModuleId(modules: HabitatModule[], moduleType: string) {
  const nextIndex =
    modules.filter((module) => module.moduleType === moduleType).length + 1;
  return `${moduleType}-${nextIndex}`;
}

function getConstructionStatusRows(modules: HabitatModule[]): ConstructionStatusRow[] {
  return modules
    .filter((module) => module.constructionJob)
    .map((module) => ({
      fabricator: module.alias,
      blueprintId: module.constructionJob?.blueprintId ?? "-",
      outputModuleId: module.constructionJob?.outputModuleId ?? "-",
      remainingTicks: formatTicks(module.constructionJob?.remainingTicks ?? 0),
      buildTicks: formatTicks(module.constructionJob?.buildTicks ?? 0),
    }));
}

export function formatConstructionStatusTable(modules: HabitatModule[]) {
  const rows = getConstructionStatusRows(modules);

  if (rows.length === 0) {
    return "No active construction jobs.";
  }

  const header = {
    fabricator: "Fabricator",
    blueprintId: "Blueprint",
    outputModuleId: "Output Module",
    remainingTicks: "Remaining Ticks",
    buildTicks: "Build Ticks",
  };

  const fabricatorWidth = Math.max(
    header.fabricator.length,
    ...rows.map((row) => row.fabricator.length),
  );
  const blueprintWidth = Math.max(
    header.blueprintId.length,
    ...rows.map((row) => row.blueprintId.length),
  );
  const outputWidth = Math.max(
    header.outputModuleId.length,
    ...rows.map((row) => row.outputModuleId.length),
  );
  const remainingWidth = Math.max(
    header.remainingTicks.length,
    ...rows.map((row) => row.remainingTicks.length),
  );
  const buildWidth = Math.max(
    header.buildTicks.length,
    ...rows.map((row) => row.buildTicks.length),
  );

  return [
    `Active construction jobs: ${rows.length}`,
    `${header.fabricator.padEnd(fabricatorWidth)}  ${header.blueprintId.padEnd(blueprintWidth)}  ${header.outputModuleId.padEnd(outputWidth)}  ${header.remainingTicks.padStart(remainingWidth)}  ${header.buildTicks.padStart(buildWidth)}`,
    `${"-".repeat(fabricatorWidth)}  ${"-".repeat(blueprintWidth)}  ${"-".repeat(outputWidth)}  ${"-".repeat(remainingWidth)}  ${"-".repeat(buildWidth)}`,
    ...rows.map(
      (row) =>
        `${row.fabricator.padEnd(fabricatorWidth)}  ${row.blueprintId.padEnd(blueprintWidth)}  ${row.outputModuleId.padEnd(outputWidth)}  ${row.remainingTicks.padStart(remainingWidth)}  ${row.buildTicks.padStart(buildWidth)}`,
    ),
  ].join("\n");
}

function createConstructionJob(
  blueprint: BlueprintDetail,
  outputModuleType: string,
  outputModuleId: string,
  buildTicks: number,
  requiredResources: Record<string, number>,
): ConstructionJob {
  const now = new Date().toISOString();

  return {
    blueprintId: blueprint.blueprintId,
    outputModuleId,
    outputModuleType,
    buildTicks,
    remainingTicks: buildTicks,
    requiredResources,
    futureRuntimeAttributes: isRecord(blueprint.runtimeAttributes)
      ? { ...blueprint.runtimeAttributes }
      : {},
    futureCapabilities: blueprint.capabilities ? [...blueprint.capabilities] : [],
    startedAt: now,
  };
}

function createCompletedModule(
  fabricator: HabitatModule,
  completedAt: string,
): HabitatModule {
  const job = fabricator.constructionJob;

  if (!job) {
    throw new Error(`Fabricator "${fabricator.alias}" has no construction job.`);
  }

  return {
    id: job.outputModuleId,
    alias: job.outputModuleType,
    blueprintId: job.blueprintId,
    moduleType: job.outputModuleType,
    displayName: toDisplayName(job.outputModuleType),
    connectedTo: [],
    runtimeAttributes: {
      ...job.futureRuntimeAttributes,
    },
    capabilities: [...job.futureCapabilities],
    constructionStatus: "built",
    source: "local",
    createdAt: completedAt,
    updatedAt: completedAt,
  };
}

function finalizeConstructionJob(
  modules: HabitatModule[],
  fabricator: HabitatModule,
): ConstructionAdvanceResult {
  const completedAt = new Date().toISOString();
  const completedModule = createCompletedModule(fabricator, completedAt);

  const updatedFabricator: HabitatModule = {
    ...fabricator,
    runtimeAttributes: {
      ...fabricator.runtimeAttributes,
      status: "online",
    },
    constructionJob: undefined,
    updatedAt: completedAt,
  };

  const updatedModules = modules.map((module) =>
    module.id === fabricator.id ? updatedFabricator : module,
  );

  updatedModules.push(completedModule);

  return {
    modules: updatedModules,
    completedModuleIds: [completedModule.id],
  };
}

function progressConstructionJob(
  modules: HabitatModule[],
  fabricator: HabitatModule,
  ticks: number,
): ConstructionAdvanceResult {
  const job = fabricator.constructionJob;

  if (!job || !isConstructionPowered(fabricator)) {
    return { modules, completedModuleIds: [] };
  }

  const remainingTicks = job.remainingTicks - ticks;

  if (remainingTicks > 0) {
    const updatedFabricator: HabitatModule = {
      ...fabricator,
      constructionJob: {
        ...job,
        remainingTicks,
      },
      updatedAt: new Date().toISOString(),
    };

    const updatedModules = modules.map((module) =>
      module.id === fabricator.id ? updatedFabricator : module,
    );

    return { modules: updatedModules, completedModuleIds: [] };
  }

  return finalizeConstructionJob(modules, fabricator);
}

export function advanceConstructionJobs(
  modules: HabitatModule[],
  ticks: number,
): ConstructionAdvanceResult {
  if (!Number.isInteger(ticks) || ticks <= 0) {
    throw new Error("Ticks must be a positive integer.");
  }

  let currentModules = modules;
  const completedModuleIds: string[] = [];

  for (const module of modules) {
    if (!module.constructionJob) {
      continue;
    }

    const result = progressConstructionJob(currentModules, module, ticks);
    currentModules = result.modules;
    completedModuleIds.push(...result.completedModuleIds);
  }

  return {
    modules: currentModules,
    completedModuleIds,
  };
}

export function cancelConstructionJob(
  modules: HabitatModule[],
  moduleId: string,
): ConstructionCancelResult {
  const fabricator = getModuleByIdOrAlias(modules, moduleId);

  if (!fabricator || fabricator.moduleType !== "workshop-fabricator") {
    throw new Error(`Fabricator "${moduleId}" was not found.`);
  }

  const job = fabricator.constructionJob;

  if (!job) {
    throw new Error(`Fabricator "${fabricator.alias}" has no active construction job.`);
  }

  const cancelledAt = new Date().toISOString();

  const updatedFabricator: HabitatModule = {
    ...fabricator,
    runtimeAttributes: {
      ...fabricator.runtimeAttributes,
      status: "online",
    },
    constructionJob: undefined,
    updatedAt: cancelledAt,
  };

  const updatedModules = modules.map((module) =>
    module.id === fabricator.id ? updatedFabricator : module,
  );

  return {
    modules: updatedModules,
    cancelledBlueprintId: job.blueprintId,
    fabricatorAlias: fabricator.alias,
  };
}

export async function startConstruction(
  blueprintId: string,
): Promise<ConstructionResult> {
  const registration = readRegistration();

  if (!registration) {
    throw new Error("No local registration found. Run habitat register first.");
  }

  const blueprint = await getBlueprint(blueprintId, registration.baseUrl);
  const requiredResources = getRequiredResources(blueprint);
  const outputModuleType = getOutputModuleType(blueprint);
  const buildTicks = getBuildTicks(blueprint);
  const modules = readModules();
  const fabricator = getWorkshopFabricator(modules);

  if (!fabricator) {
    throw new Error('No "workshop-fabricator" module found.');
  }

  ensureConstructionJobSlot(fabricator);

  let updatedInventory: HabitatInventory;
  let modulesAfterInventorySpend: HabitatModule[];

  try {
    const result = subtractSupplyCacheInventory(modules, requiredResources);
    updatedInventory = result.inventory;
    modulesAfterInventorySpend = result.modules;
  } catch {
    throw new Error(`Insufficient local inventory for "${blueprint.blueprintId}".`);
  }

  const job = createConstructionJob(
    blueprint,
    outputModuleType,
    getNextModuleId(modulesAfterInventorySpend, outputModuleType),
    buildTicks,
    requiredResources,
  );

  const updatedFabricator: HabitatModule = {
    ...fabricator,
    runtimeAttributes: {
      ...fabricator.runtimeAttributes,
      status: "active",
    },
    constructionJob: job,
    updatedAt: new Date().toISOString(),
  };

  const updatedModules = modulesAfterInventorySpend.map((module) =>
    module.id === fabricator.id ? updatedFabricator : module,
  );

  writeModules(updatedModules);

  return {
    blueprint,
    fabricator: updatedFabricator,
    inventory: updatedInventory,
  };
}
