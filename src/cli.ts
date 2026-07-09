#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { Command, CommanderError } from "commander";
import packageJson from "../package.json";
import {
  deleteRegistration,
  deleteModules,
  getRegistrationFilePath,
  getModulesFilePath,
  hydrateModulesFromStarterModules,
  type HabitatModule,
  readRegistration,
  readModules,
  type HabitatStatus,
  type ProductionBlueprint,
  type StarterModuleInstance,
  type StoredRegistration,
  writeModules,
  writeRegistration,
} from "./habitat-store";
import {
  formatModulePowerStatusTable,
  getDeclaredModuleState,
  getCurrentPowerDrawKw,
  getEffectiveModuleState,
  runPowerTicks,
} from "./power-tick";
import {
  advanceConstructionJobs,
  cancelConstructionJob,
  formatConstructionStatusTable,
  startConstruction,
} from "./construction";
import {
  addSupplyCacheInventory,
  formatInventoryTable,
} from "./habitat-inventory";
import {
  getBlueprint,
  listBlueprints,
  type BlueprintDetail,
  type BlueprintSummary,
} from "./kepler-blueprints";
import { listResources, type ResourceSummary } from "./kepler-resources";

type RegisterOptions = {
  name: string;
};

type ModuleCreateOptions = {
  id: string;
  alias?: string;
  blueprintId: string;
  name: string;
  status?: string;
  health?: string;
};

type ModuleUpdateOptions = {
  name?: string;
  status?: string;
  health?: string;
};

const allowedModuleStatuses = [
  "offline",
  "idle",
  "online",
  "active",
  "damaged",
] as const;

type AllowedModuleStatus = (typeof allowedModuleStatuses)[number];

type TickOptions = {
  ticks?: string;
};

type InventoryAddOptions = {
  resourceType: string;
  quantity: string;
};

type KeplerErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

type HabitatRegistrationResponse = {
  habitatId: string;
  starterModules: StarterModuleInstance[];
  blueprints: ProductionBlueprint[];
};

type HabitatResponse = {
  habitat: HabitatStatus;
};

const defaultBaseUrl = "https://planet.turingguild.com";

function getBaseUrl() {
  return (
    process.env.KEPLER_BASE_URL ??
    process.env.KEPLER_WORLD_BASE_URL ??
    process.env.PLANET_SERVER_PUBLIC_BASE_URL ??
    defaultBaseUrl
  ).replace(/\/+$/, "");
}

function getToken() {
  return (
    process.env.KEPLER_PLANET_TOKEN ??
    process.env.KEPLER_WORLD_TOKEN ??
    process.env.PLANET_TOKEN
  );
}

function requireToken() {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Missing Kepler token. Set KEPLER_PLANET_TOKEN in your environment or .env file.",
    );
  }

  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStarterModuleInstance(value: unknown): value is StarterModuleInstance {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.blueprintId === "string" &&
    typeof value.displayName === "string" &&
    isStringArray(value.connectedTo) &&
    isRecord(value.runtimeAttributes) &&
    isStringArray(value.capabilities)
  );
}

function isProductionBlueprint(value: unknown): value is ProductionBlueprint {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.blueprintId === "string" &&
    typeof value.displayName === "string"
  );
}

function isHabitatStatus(value: unknown): value is HabitatStatus {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.habitatSlug === "string" &&
    typeof value.displayName === "string" &&
    typeof value.catalogVersion === "string" &&
    typeof value.status === "string" &&
    (value.lastSeenAt === undefined ||
      value.lastSeenAt === null ||
      typeof value.lastSeenAt === "string")
  );
}

function isHabitatRegistrationResponse(
  value: unknown,
): value is HabitatRegistrationResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.habitatId === "string" &&
    Array.isArray(value.starterModules) &&
    value.starterModules.every(isStarterModuleInstance) &&
    Array.isArray(value.blueprints) &&
    value.blueprints.every(isProductionBlueprint)
  );
}

function isHabitatResponse(value: unknown): value is HabitatResponse {
  return isRecord(value) && isHabitatStatus(value.habitat);
}

function parseHealth(value: string) {
  const health = Number(value);

  if (!Number.isFinite(health) || health < 0 || health > 100) {
    throw new Error("Health must be a number from 0 to 100.");
  }

  return health;
}

function parseTicks(value: string) {
  const ticks = Number(value);

  if (!Number.isInteger(ticks) || ticks <= 0) {
    throw new Error("Ticks must be a positive integer.");
  }

  return ticks;
}

function parseQuantity(value: string) {
  const quantity = Number(value);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer.");
  }

  return quantity;
}

function formatKwh(value: number) {
  return value.toFixed(6);
}

function formatPowerDrawKw(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

async function parseErrorMessage(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const parsed = (await response.json()) as KeplerErrorResponse;
    return parsed.error?.message ?? parsed.error?.code ?? fallback;
  } catch {
    return fallback;
  }
}

async function keplerRequest(
  path: string,
  init: RequestInit = {},
  baseUrl = getBaseUrl(),
) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return response;
}

async function registerHabitat(name: string) {
  const existingRegistration = readRegistration();

  if (existingRegistration) {
    throw new Error(
      `Habitat is already registered as "${existingRegistration.displayName}" (${existingRegistration.habitatId}). Run habitat status to inspect it or habitat unregister first.`,
    );
  }

  const habitatUuid = randomUUID();
  const response = await keplerRequest("/habitats/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      displayName: name,
      habitatUuid,
    }),
  });

  const parsed = (await response.json()) as unknown;

  if (!isHabitatRegistrationResponse(parsed)) {
    throw new Error("Kepler returned an unexpected registration response.");
  }

  const registration: StoredRegistration = {
    habitatUuid,
    habitatId: parsed.habitatId,
    displayName: name,
    baseUrl: getBaseUrl(),
    registeredAt: new Date().toISOString(),
    starterModules: parsed.starterModules,
    blueprints: parsed.blueprints,
  };

  writeRegistration(registration);
  writeModules(hydrateModulesFromStarterModules(parsed.starterModules));
  return registration;
}

async function fetchRegistrationStatus(registration: StoredRegistration) {
  const response = await keplerRequest(
    `/habitats/${encodeURIComponent(registration.habitatId)}/registration`,
    {},
    registration.baseUrl,
  );
  const parsed = (await response.json()) as unknown;

  if (!isHabitatResponse(parsed)) {
    throw new Error("Kepler returned an unexpected status response.");
  }

  const updatedRegistration: StoredRegistration = {
    ...registration,
    lastStatus: parsed.habitat,
  };

  writeRegistration(updatedRegistration);
  return parsed.habitat;
}

async function unregisterHabitat(registration: StoredRegistration) {
  try {
    await keplerRequest(
      `/habitats/${encodeURIComponent(registration.habitatId)}`,
      {
        method: "DELETE",
      },
      registration.baseUrl,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.toLowerCase().includes("not registered")) {
      throw error;
    }

    console.warn(
      `Kepler no longer has habitat "${registration.habitatId}". Removing stale local registration.`,
    );
  }

  deleteRegistration();
  deleteModules();
}

function createModule(options: ModuleCreateOptions) {
  const modules = readHydratedModules();

  if (modules.some((module) => module.id === options.id)) {
    throw new Error(`Module "${options.id}" already exists.`);
  }

  const alias = options.alias ?? options.id;

  if (modules.some((module) => module.alias === alias)) {
    throw new Error(`Module alias "${alias}" already exists.`);
  }

  const now = new Date().toISOString();
  const runtimeAttributes: Record<string, unknown> = {};

  if (options.status) {
    runtimeAttributes.status = options.status;
  }

  if (options.health !== undefined) {
    runtimeAttributes.health = parseHealth(options.health);
  }

  const module: HabitatModule = {
    id: options.id,
    alias,
    blueprintId: options.blueprintId,
    moduleType: options.blueprintId,
    displayName: options.name,
    connectedTo: [],
    runtimeAttributes,
    capabilities: [],
    constructionStatus: "built",
    source: "local",
    createdAt: now,
    updatedAt: now,
  };

  writeModules([...modules, module]);
  return module;
}

function findModule(moduleId: string) {
  return readHydratedModules().find(
    (module) => module.id === moduleId || module.alias === moduleId,
  );
}

function updateModule(moduleId: string, options: ModuleUpdateOptions) {
  const modules = readHydratedModules();
  const moduleIndex = modules.findIndex(
    (module) => module.id === moduleId || module.alias === moduleId,
  );

  if (moduleIndex === -1) {
    throw new Error(`Module "${moduleId}" was not found.`);
  }

  if (!options.name && !options.status && options.health === undefined) {
    throw new Error("Provide at least one field to update.");
  }

  const currentModule = modules[moduleIndex];
  const runtimeAttributes = { ...currentModule.runtimeAttributes };

  if (options.status) {
    runtimeAttributes.status = options.status;
  }

  if (options.health !== undefined) {
    runtimeAttributes.health = parseHealth(options.health);
  }

  const updatedModule: HabitatModule = {
    ...currentModule,
    displayName: options.name ?? currentModule.displayName,
    runtimeAttributes,
    updatedAt: new Date().toISOString(),
  };

  modules[moduleIndex] = updatedModule;
  writeModules(modules);
  return updatedModule;
}

function deleteModule(moduleId: string) {
  const modules = readHydratedModules();
  const remainingModules = modules.filter(
    (module) => module.id !== moduleId && module.alias !== moduleId,
  );

  if (remainingModules.length === modules.length) {
    throw new Error(`Module "${moduleId}" was not found.`);
  }

  writeModules(remainingModules);
}

function parseModuleStatus(value: string): AllowedModuleStatus {
  if (allowedModuleStatuses.includes(value as AllowedModuleStatus)) {
    return value as AllowedModuleStatus;
  }

  throw new Error(
    `Status must be one of: ${allowedModuleStatuses.join(", ")}.`,
  );
}

function setModuleStatus(moduleId: string, status: AllowedModuleStatus) {
  const modules = readHydratedModules();
  const moduleIndex = modules.findIndex(
    (module) => module.id === moduleId || module.alias === moduleId,
  );

  if (moduleIndex === -1) {
    throw new Error(`Module "${moduleId}" was not found.`);
  }

  const currentModule = modules[moduleIndex];
  const updatedModule: HabitatModule = {
    ...currentModule,
    runtimeAttributes: {
      ...currentModule.runtimeAttributes,
      status,
    },
    updatedAt: new Date().toISOString(),
  };

  modules[moduleIndex] = updatedModule;
  writeModules(modules);
  return updatedModule;
}

function printRegistration(registration: StoredRegistration) {
  const modules = readModules();

  console.log(`Registered habitat "${registration.displayName}".`);
  console.log(`Habitat ID: ${registration.habitatId}`);
  console.log(`Habitat UUID: ${registration.habitatUuid}`);
  console.log(`Kepler base URL: ${registration.baseUrl}`);
  console.log(`Starter modules: ${registration.starterModules.length}`);
  console.log(`Local modules: ${modules.length}`);
  console.log(`Blueprints returned: ${registration.blueprints.length}`);
  console.log(`Stored in ${getRegistrationFilePath()}`);
  console.log(`Modules stored in ${getModulesFilePath()}`);
}

function ensureModulesHydrated(registration: StoredRegistration) {
  const modules = readModules();

  if (modules.length > 0 || registration.starterModules.length === 0) {
    return modules;
  }

  const hydratedModules = hydrateModulesFromStarterModules(
    registration.starterModules,
    registration.registeredAt,
  );
  writeModules(hydratedModules);
  return hydratedModules;
}

function readHydratedModules() {
  const registration = readRegistration();
  return registration ? ensureModulesHydrated(registration) : readModules();
}

function printStatus(status: HabitatStatus, registration: StoredRegistration) {
  const modules = ensureModulesHydrated(registration);

  console.log(`Habitat: ${status.displayName}`);
  console.log(`Habitat ID: ${status.id}`);
  console.log(`Slug: ${status.habitatSlug}`);
  console.log(`Status: ${status.status}`);
  console.log(`Modules: ${modules.length}`);
  console.log(`Catalog version: ${status.catalogVersion}`);
  console.log(`Last seen: ${status.lastSeenAt ?? "never"}`);
  console.log(`Local registration: ${getRegistrationFilePath()}`);
  console.log(`Registered at: ${registration.registeredAt}`);
}

function getModuleStatus(module: HabitatModule) {
  const status = module.runtimeAttributes.status;
  return typeof status === "string" ? status : "unknown";
}

function getModuleHealth(module: HabitatModule) {
  const health = module.runtimeAttributes.health;
  return typeof health === "number" ? String(health) : "unknown";
}

function getRuntimeNumber(module: HabitatModule, key: string) {
  const value = module.runtimeAttributes[key];
  return typeof value === "number" ? value : undefined;
}

function printModuleList(modules: HabitatModule[]) {
  if (modules.length === 0) {
    console.log("No modules found.");
    console.log(`Modules file: ${getModulesFilePath()}`);
    return;
  }

  for (const module of modules) {
    console.log(
      `${module.alias} | type: ${module.moduleType} | name: ${module.displayName} | status: ${getModuleStatus(module)} | health: ${getModuleHealth(module)}`,
    );
  }
}

function formatRuntimeAttributes(module: HabitatModule) {
  const lines: string[] = [];

  if (module.runtimeAttributes.status !== undefined) {
    lines.push(`Declared status: ${String(module.runtimeAttributes.status)}`);
  }

  lines.push(`Effective status: ${getEffectiveModuleState(module)}`);

  const health = getRuntimeNumber(module, "health");
  if (health !== undefined) {
    lines.push(`Health: ${health}`);
  }

  const powerDrawKw = module.runtimeAttributes.powerDrawKw;
  if (powerDrawKw && typeof powerDrawKw === "object") {
    lines.push("Power draw:");
    for (const [state, draw] of Object.entries(powerDrawKw)) {
      if (typeof draw === "number") {
        lines.push(`  ${state}: ${draw} kW`);
      }
    }
  }

  const remainingEntries = Object.entries(module.runtimeAttributes).filter(
    ([key]) => key !== "status" && key !== "powerDrawKw",
  );

  if (remainingEntries.length > 0) {
    lines.push("Attributes:");
    for (const [key, value] of remainingEntries) {
      const formattedValue =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      lines.push(`  ${key}: ${formattedValue}`);
    }
  }

  return lines;
}

function formatBatteryDetails(module: HabitatModule) {
  const lines: string[] = [];

  const currentEnergyKwh = getRuntimeNumber(module, "currentEnergyKwh");
  const capacityKwh = getRuntimeNumber(module, "capacityKwh");
  const reserveKwh = getRuntimeNumber(module, "reserveKwh");
  const maxOutputKw = getRuntimeNumber(module, "maxOutputKw");

  if (currentEnergyKwh !== undefined) {
    lines.push(`Current energy: ${currentEnergyKwh} kWh`);
  }

  if (capacityKwh !== undefined) {
    lines.push(`Capacity: ${capacityKwh} kWh`);
  }

  if (reserveKwh !== undefined) {
    lines.push(`Reserve: ${reserveKwh} kWh`);
  }

  if (maxOutputKw !== undefined) {
    lines.push(`Max output: ${maxOutputKw} kW`);
  }

  return lines;
}

function formatConstructionJobDetails(module: HabitatModule) {
  const job = module.constructionJob;

  if (!job) {
    return [];
  }

  return [
    `Blueprint: ${job.blueprintId}`,
    `Output module: ${job.outputModuleId}`,
    `Build ticks: ${job.buildTicks}`,
    `Remaining ticks: ${job.remainingTicks}`,
    `Started at: ${job.startedAt}`,
  ];
}

function appendTextSection(lines: string[], title: string, entries: string[]) {
  if (entries.length === 0) {
    return;
  }

  lines.push(`${title}:`);
  for (const entry of entries) {
    lines.push(`  ${entry}`);
  }
}

function formatModuleDetails(module: HabitatModule) {
  const lines = [
    `Module ID: ${module.id}`,
    `Alias: ${module.alias}`,
    `Type: ${module.moduleType}`,
    `Name: ${module.displayName}`,
    `Construction status: ${module.constructionStatus}`,
    `Source: ${module.source}`,
    `Declared state: ${getDeclaredModuleState(module)}`,
    `Effective state: ${getEffectiveModuleState(module)}`,
  ];

  appendTextSection(lines, "Runtime Attributes", formatRuntimeAttributes(module));

  if (module.moduleType === "basic-battery") {
    appendTextSection(lines, "Battery", formatBatteryDetails(module));
  }

  if (module.constructionJob) {
    appendTextSection(lines, "Construction Job", formatConstructionJobDetails(module));
  }

  formatSection(lines, "Capabilities", module.capabilities);

  return lines.join("\n");
}

function printModule(module: HabitatModule) {
  console.log(formatModuleDetails(module));
}

function runTickCommand(ticksInput: string) {
  const ticks = parseTicks(ticksInput);
  const modules = readHydratedModules();
  const result = runPowerTicks(modules, ticks);
  const constructionResult = advanceConstructionJobs(result.modules, ticks);
  writeModules(constructionResult.modules);

  console.log(`Executed ${result.ticksExecuted} ticks.`);
  console.log(`Power demand: ${result.totalPowerDemandKw} kW`);
  console.log(`Energy consumed: ${formatKwh(result.energyConsumedKwh)} kWh`);
  console.log(
    `Battery energy: ${result.batteryEnergyBeforeKwh} -> ${formatKwh(result.batteryEnergyAfterKwh)} kWh`,
  );
  console.log(`Updated ${result.updatedBatteryCount} battery module.`);

  if (constructionResult.completedModuleIds.length > 0) {
    console.log(
      `Completed construction: ${constructionResult.completedModuleIds.join(", ")}`,
    );
  }
}

function formatYesNo(value: boolean | undefined) {
  if (value === undefined) {
    return "-";
  }

  return value ? "yes" : "no";
}

function formatObjectEntries(value: Record<string, unknown>) {
  return Object.entries(value).map(([key, entryValue]) => {
    const formattedValue =
      typeof entryValue === "string" ||
      typeof entryValue === "number" ||
      typeof entryValue === "boolean"
        ? String(entryValue)
        : JSON.stringify(entryValue);

    return `${key}: ${formattedValue}`;
  });
}

function formatSection(
  lines: string[],
  title: string,
  value: Record<string, unknown> | string[] | undefined,
) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return;
    }

    lines.push(`${title}: ${value.join(", ")}`);
    return;
  }

  const entries = formatObjectEntries(value);

  if (entries.length === 0) {
    return;
  }

  lines.push(`${title}:`);
  for (const entry of entries) {
    lines.push(`  ${entry}`);
  }
}

function formatBlueprintTable(blueprints: BlueprintSummary[]) {
  if (blueprints.length === 0) {
    return "No blueprints found.";
  }

  const rows = blueprints.map((blueprint) => ({
    blueprintId: blueprint.blueprintId,
    displayName: blueprint.displayName,
    buildTicks: blueprint.buildTicks === undefined ? "-" : String(blueprint.buildTicks),
    repeatable: formatYesNo(blueprint.repeatable),
  }));

  const header = {
    blueprintId: "Blueprint",
    displayName: "Name",
    buildTicks: "Ticks",
    repeatable: "Repeatable",
  };

  const blueprintWidth = Math.max(
    header.blueprintId.length,
    ...rows.map((row) => row.blueprintId.length),
  );
  const nameWidth = Math.max(
    header.displayName.length,
    ...rows.map((row) => row.displayName.length),
  );
  const ticksWidth = Math.max(
    header.buildTicks.length,
    ...rows.map((row) => row.buildTicks.length),
  );
  const repeatableWidth = Math.max(
    header.repeatable.length,
    ...rows.map((row) => row.repeatable.length),
  );

  return [
    `${header.blueprintId.padEnd(blueprintWidth)}  ${header.displayName.padEnd(nameWidth)}  ${header.buildTicks.padStart(ticksWidth)}  ${header.repeatable.padEnd(repeatableWidth)}`,
    `${"-".repeat(blueprintWidth)}  ${"-".repeat(nameWidth)}  ${"-".repeat(ticksWidth)}  ${"-".repeat(repeatableWidth)}`,
    ...rows.map(
      (row) =>
        `${row.blueprintId.padEnd(blueprintWidth)}  ${row.displayName.padEnd(nameWidth)}  ${row.buildTicks.padStart(ticksWidth)}  ${row.repeatable.padEnd(repeatableWidth)}`,
    ),
  ].join("\n");
}

function formatBlueprintDetail(blueprint: BlueprintDetail) {
  const lines = [
    `Blueprint ID: ${blueprint.blueprintId}`,
    `Name: ${blueprint.displayName}`,
  ];

  if (blueprint.description) {
    lines.push(`Description: ${blueprint.description}`);
  }

  lines.push(
    `Build Ticks: ${blueprint.buildTicks === undefined ? "-" : String(blueprint.buildTicks)}`,
  );
  lines.push(`Repeatable: ${formatYesNo(blueprint.repeatable)}`);

  formatSection(lines, "Inputs", blueprint.inputs);
  formatSection(lines, "Output", blueprint.output);
  formatSection(lines, "Required Facility", blueprint.requiredFacility);
  formatSection(lines, "Prerequisites", blueprint.prerequisites);
  formatSection(lines, "Unlocks", blueprint.unlocks);
  formatSection(lines, "Capabilities", blueprint.capabilities);

  return lines.join("\n");
}

function formatResourceTable(resources: ResourceSummary[]) {
  if (resources.length === 0) {
    return "No resource types found.";
  }

  const rows = resources.map((resource) => ({
    resourceType: resource.resourceType,
    displayName: resource.displayName,
    kind: resource.kind,
    rarity: resource.rarity,
  }));

  const header = {
    resourceType: "Resource",
    displayName: "Name",
    kind: "Kind",
    rarity: "Rarity",
  };

  const resourceWidth = Math.max(
    header.resourceType.length,
    ...rows.map((row) => row.resourceType.length),
  );
  const nameWidth = Math.max(
    header.displayName.length,
    ...rows.map((row) => row.displayName.length),
  );
  const kindWidth = Math.max(header.kind.length, ...rows.map((row) => row.kind.length));
  const rarityWidth = Math.max(
    header.rarity.length,
    ...rows.map((row) => row.rarity.length),
  );

  return [
    `${header.resourceType.padEnd(resourceWidth)}  ${header.displayName.padEnd(nameWidth)}  ${header.kind.padEnd(kindWidth)}  ${header.rarity.padEnd(rarityWidth)}`,
    `${"-".repeat(resourceWidth)}  ${"-".repeat(nameWidth)}  ${"-".repeat(kindWidth)}  ${"-".repeat(rarityWidth)}`,
    ...rows.map(
      (row) =>
        `${row.resourceType.padEnd(resourceWidth)}  ${row.displayName.padEnd(nameWidth)}  ${row.kind.padEnd(kindWidth)}  ${row.rarity.padEnd(rarityWidth)}`,
    ),
  ].join("\n");
}

function printError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
}

const program = new Command();
const moduleCommand = program
  .command("module")
  .description("Create, list, show, update, and delete local habitat modules.");
const blueprintCommand = program
  .command("blueprint")
  .description("Inspect official Kepler blueprint catalog entries.");
const resourceCommand = program
  .command("resource")
  .description("Inspect official Kepler resource catalog entries.");
const constructionCommand = program
  .command("construction")
  .description("Inspect active construction jobs.");
const inventoryCommand = program
  .command("inventory")
  .description("Manage the supply cache inventory stored on the local habitat.");

program
  .name("habitat")
  .description("Register, inspect, and unregister this Habitat CLI with Kepler.")
  .version(packageJson.version)
  .showSuggestionAfterError()
  .exitOverride();

program.addHelpText(
  "after",
  `
Environment:
  KEPLER_PLANET_TOKEN  Bearer token for Kepler API requests
  KEPLER_BASE_URL      Optional Kepler base URL; defaults to ${defaultBaseUrl}

Local files:
  .habitat/registration.json stores the Kepler habitat ID, generated habitat UUID,
  display name, registration timestamp, starter modules, and returned blueprints.

Commands:
  habitat register --name "<habitat name>"
  habitat status
  habitat unregister
  habitat module create --id <id> --blueprint-id <blueprintId> --name "<name>" [--alias <alias>]
  habitat module list
  habitat module show <id-or-alias>
  habitat module update <id-or-alias> [--name <name>] [--status <status>] [--health <0-100>]
  habitat module delete <id-or-alias>
  habitat blueprint list
  habitat blueprint show <blueprint-id>
  habitat resource list
  habitat construction status
  habitat construction cancel <fabricator-id-or-alias>
  habitat inventory list
  habitat inventory add <resource-type> <quantity>
  habitat construct <blueprint-id>
  habitat tick <ticks>
`,
);

moduleCommand.addHelpText(
  "after",
  `
Local module records are stored in .habitat/modules.json.
Registration hydrates starter modules from Kepler's starterModules response.

Examples:
  habitat module list
  habitat module show command-1
  habitat module create --id test-module-1 --alias test-1 --blueprint-id test-module --name "Test Module"
  habitat module update test-module-1 --status active --health 95
  habitat module delete test-module-1
`,
);

blueprintCommand.addHelpText(
  "after",
  `
These commands read the official Kepler blueprint catalog.
They do not write local registration, module, or inventory state.

Examples:
  habitat blueprint list
  habitat blueprint show survey-rover
`,
);

resourceCommand.addHelpText(
  "after",
  `
These commands read the official Kepler resource catalog.
They describe possible resource types in the Kepler world, not your local inventory.

Examples:
  habitat resource list
`,
);

inventoryCommand
  .command("add")
  .description("Add resources to the supply cache inventory.")
  .argument("<resource-type>", "Resource type")
  .argument("<quantity>", "Quantity to add")
  .action((resourceType: string, quantity: string) => {
    try {
      const result = addSupplyCacheInventory(
        readHydratedModules(),
        resourceType,
        parseQuantity(quantity),
      );

      writeModules(result.modules);
      console.log(
        `Supply cache inventory updated: ${resourceType} = ${result.inventory[resourceType]}`,
      );
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

inventoryCommand.addHelpText(
  "after",
  `
Inventory is stored on the supply-cache module in .habitat/modules.json.

Examples:
  habitat inventory list
  habitat inventory add ferrite 90
`,
);

constructionCommand.addHelpText(
  "after",
  `
Shows construction jobs stored on fabricator records.

Examples:
  habitat construction status
  habitat construction cancel workshop-fabricator-1
`,
);

program
  .command("construct")
  .description("Start a local construction job for a Kepler blueprint.")
  .argument("<blueprint-id>", "Blueprint ID")
  .action(async (blueprintId: string) => {
    try {
      const result = await startConstruction(blueprintId);
      const job = result.fabricator.constructionJob;

      console.log(`Started construction of "${result.blueprint.blueprintId}".`);
      console.log(`Fabricator: ${result.fabricator.alias}`);
      console.log(`Output module ID: ${job?.outputModuleId}`);
      console.log(`Build ticks: ${job?.buildTicks}`);
      console.log(`Remaining ticks: ${job?.remainingTicks}`);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

constructionCommand
  .command("status")
  .description("Show active construction jobs and remaining build time.")
  .action(() => {
    try {
      console.log(formatConstructionStatusTable(readHydratedModules()));
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

constructionCommand
  .command("cancel")
  .description("Cancel one active construction job.")
  .argument("<fabricator-id-or-alias>", "Fabricator ID or alias")
  .action((moduleId: string) => {
    try {
      const result = cancelConstructionJob(readHydratedModules(), moduleId);
      writeModules(result.modules);
      console.log(
        `Cancelled construction job for ${result.fabricatorAlias}. No materials were refunded.`,
      );
      console.log(`Cancelled blueprint: ${result.cancelledBlueprintId}`);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

inventoryCommand
  .command("list")
  .description("Show the supply cache inventory.")
  .action(() => {
    try {
      console.log(formatInventoryTable(readHydratedModules()));
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

program
  .command("tick")
  .description("Advance the local habitat simulation by a number of power ticks.")
  .argument("[ticks]", "Number of one-second ticks to execute")
  .option("--ticks <ticks>", "Number of one-second ticks to execute")
  .action((ticksArgument: string | undefined, options: TickOptions) => {
    try {
      const ticksInput = ticksArgument ?? options.ticks;

      if (!ticksInput) {
        throw new Error("Provide ticks as a positional argument or with --ticks.");
      }

      runTickCommand(ticksInput);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

program
  .command("register")
  .description("Register this habitat with Kepler.")
  .requiredOption("--name <habitatName>", "Habitat display name")
  .action(async (options: RegisterOptions) => {
    try {
      const registration = await registerHabitat(options.name);
      printRegistration(registration);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show this habitat registration status from Kepler.")
  .action(async () => {
    try {
      const registration = readRegistration();

      if (!registration) {
        throw new Error("No local registration found. Run habitat register first.");
      }

      const status = await fetchRegistrationStatus(registration);
      printStatus(status, registration);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

program
  .command("unregister")
  .description("Delete this habitat registration from Kepler and local state.")
  .action(async () => {
    try {
      const registration = readRegistration();

      if (!registration) {
        throw new Error("No local registration found. Nothing to unregister.");
      }

      await unregisterHabitat(registration);
      console.log(`Unregistered habitat "${registration.displayName}".`);
      console.log(`Removed ${getRegistrationFilePath()}`);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

blueprintCommand
  .command("list")
  .description("List official Kepler blueprints.")
  .action(async () => {
    try {
      console.log(formatBlueprintTable(await listBlueprints()));
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

blueprintCommand
  .command("show")
  .description("Show one official Kepler blueprint.")
  .argument("<blueprint-id>", "Blueprint ID")
  .action(async (blueprintId: string) => {
    try {
      console.log(formatBlueprintDetail(await getBlueprint(blueprintId)));
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

resourceCommand
  .command("list")
  .description("List official Kepler resources.")
  .action(async () => {
    try {
      console.log(
        "Resource catalog entries are possible resource types in the Kepler world, not local inventory.",
      );
      console.log(formatResourceTable(await listResources()));
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("create")
  .description("Create a local module.")
  .requiredOption("--id <id>", "Local module ID")
  .option("--alias <alias>", "Short local module alias")
  .requiredOption("--blueprint-id <blueprintId>", "Blueprint ID or module type")
  .requiredOption("--name <name>", "Module display name")
  .option("--status <status>", "Initial runtime status")
  .option("--health <health>", "Initial health from 0 to 100")
  .action((options: ModuleCreateOptions) => {
    try {
      const module = createModule(options);
      console.log(`Created module "${module.id}".`);
      printModule(module);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("list")
  .description("List local modules.")
  .action(() => {
    try {
      printModuleList(readHydratedModules());
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("status")
  .description("Show module states with current power draw.")
  .action(() => {
    try {
      console.log(formatModulePowerStatusTable(readHydratedModules()));
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("set-status")
  .description("Set one local module runtime status.")
  .argument("<id>", "Module ID or alias")
  .argument("<status>", "New module status")
  .action((moduleId: string, status: string) => {
    try {
      const updatedModule = setModuleStatus(moduleId, parseModuleStatus(status));
      console.log(
        `Updated module "${updatedModule.id}" to status "${String(updatedModule.runtimeAttributes.status)}" (power draw: ${formatPowerDrawKw(getCurrentPowerDrawKw(updatedModule))} kW).`,
      );
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("show")
  .description("Show one local module.")
  .argument("<id>", "Module ID")
  .action((moduleId: string) => {
    try {
      const module = findModule(moduleId);

      if (!module) {
        throw new Error(`Module "${moduleId}" was not found.`);
      }

      printModule(module);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("update")
  .description("Update one local module.")
  .argument("<id>", "Module ID")
  .option("--name <name>", "New module display name")
  .option("--status <status>", "New runtime status")
  .option("--health <health>", "New health from 0 to 100")
  .action((moduleId: string, options: ModuleUpdateOptions) => {
    try {
      const module = updateModule(moduleId, options);
      console.log(`Updated module "${module.id}".`);
      printModule(module);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("delete")
  .description("Delete one local module.")
  .argument("<id>", "Module ID")
  .action((moduleId: string) => {
    try {
      deleteModule(moduleId);
      console.log(`Deleted module "${moduleId}".`);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

try {
  program.parse(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version"
    ) {
      process.exit(0);
    }

    if (
      error.code === "commander.unknownCommand" ||
      error.code === "commander.excessArguments"
    ) {
      console.error("That command is not available.");
      console.error("Run `habitat --help` to see supported commands.");
      process.exit(1);
    }

    process.exit(error.exitCode);
  }

  throw error;
}
