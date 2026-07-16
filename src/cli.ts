#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import packageJson from "../package.json";
import {
  hydrateModulesFromStarterModules,
  type HabitatModule,
  type HabitatStatus,
  type StoredRegistration,
  readRegistration,
} from "./habitat-store";
import {
  applySolarGeneration,
  formatModulePowerStatusTable,
  hasSolarGenerationModules,
  getDeclaredModuleState,
  getCurrentPowerDrawKw,
  getEffectiveModuleState,
  runPowerTicks,
} from "./power-tick";
import type { SolarIrradiance } from "./kepler-solar";
import {
  advanceConstructionJobs,
  cancelConstructionJob,
  formatConstructionStatusTable,
  startConstruction,
} from "./construction";
import {
  formatInventoryTableFromInventory,
} from "./habitat-inventory";
import {
  getBlueprint,
  listBlueprints,
  type BlueprintDetail,
  type BlueprintSummary,
} from "./kepler-blueprints";
import { listResources, type ResourceSummary } from "./kepler-resources";
import { getSolarIrradiance } from "./kepler-solar";
import { requestJson, type JsonRequestOptions } from "./api-client";
import { resolveRegisteredAt } from "./registration-summary";
import {
  createModule as createRemoteModule,
  deleteModule as deleteRemoteModule,
  getInventory as getRemoteInventory,
  getModule as getRemoteModule,
  getRegistration as getRemoteRegistration,
  listHumans as listRemoteHumans,
  moveHuman as moveRemoteHuman,
  getExplorationState,
  deployExplorer,
  moveExplorer,
  dockExplorer,
  listModules as listRemoteModules,
  registerHabitat as registerRemoteHabitat,
  replaceModules as replaceRemoteModules,
  setInventory as setRemoteInventory,
  scanWorld,
  collectResource,
  listAlerts as listRemoteAlerts,
  acknowledgeAlert as acknowledgeRemoteAlert,
  unregisterHabitat as unregisterRemoteHabitat,
  updateModule as updateRemoteModule,
} from "./local-api";
import { formatWorldScan, formatWorldScanJson } from "./world-scan";
import { formatHumanList } from "./humans";
import { formatExplorationStatus } from "./exploration";
import { formatCollection } from "./collection";
import { formatAlertList } from "./alerts";

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

type ScanOptions = {
  strength: string;
  radius: string;
  json?: boolean;
};

type HumanListOptions = {
  json?: boolean;
};

type EvaOptions = { json?: boolean };

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

function parseScanInteger(value: string, name: string, minimum?: number, maximum?: number) {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  const parsed = Number(value);

  if (
    (minimum !== undefined && parsed < minimum) ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }

  return parsed;
}

function formatKwh(value: number) {
  return value.toFixed(6);
}

function formatPowerDrawKw(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

async function keplerRequest<TResponse>(
  path: string,
  init: Omit<JsonRequestOptions, "baseUrl" | "apiToken"> = {},
  baseUrl = getBaseUrl(),
) {
  return requestJson<TResponse>(path, {
    ...init,
    baseUrl,
    apiToken: requireToken(),
  });
}

async function registerHabitat(name: string) {
  const registration = await registerRemoteHabitat(name);

  if (!registration) {
    throw new Error("Kepler returned an unexpected registration response.");
  }

  return registration;
}

async function fetchRegistrationStatus(registration: StoredRegistration) {
  const parsed = await keplerRequest<HabitatResponse>(
    `/habitats/${encodeURIComponent(registration.habitatId)}/registration`,
    {},
    registration.baseUrl,
  );

  if (!isHabitatResponse(parsed)) {
    throw new Error("Kepler returned an unexpected status response.");
  }
  return parsed.habitat;
}

async function unregisterHabitat() {
  await unregisterRemoteHabitat();
}

async function createModule(options: ModuleCreateOptions) {
  const modules = await listRemoteModules();

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

  return createRemoteModule(module);
}

async function findModule(moduleId: string) {
  try {
    return await getRemoteModule(moduleId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("was not found")) {
      return undefined;
    }

    throw error;
  }
}

async function updateModule(moduleId: string, options: ModuleUpdateOptions) {
  const currentModule = await getRemoteModule(moduleId);

  if (!options.name && !options.status && options.health === undefined) {
    throw new Error("Provide at least one field to update.");
  }
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

  return updateRemoteModule(moduleId, updatedModule);
}

async function deleteModule(moduleId: string) {
  await deleteRemoteModule(moduleId);
}

function parseModuleStatus(value: string): AllowedModuleStatus {
  if (allowedModuleStatuses.includes(value as AllowedModuleStatus)) {
    return value as AllowedModuleStatus;
  }

  throw new Error(
    `Status must be one of: ${allowedModuleStatuses.join(", ")}.`,
  );
}

async function setModuleStatus(moduleId: string, status: AllowedModuleStatus) {
  const currentModule = await getRemoteModule(moduleId);
  const updatedModule: HabitatModule = {
    ...currentModule,
    runtimeAttributes: {
      ...currentModule.runtimeAttributes,
      status,
    },
    updatedAt: new Date().toISOString(),
  };

  return updateRemoteModule(moduleId, updatedModule);
}

async function getCurrentInventory() {
  return getRemoteInventory();
}

async function printRegistration(registration: StoredRegistration) {
  const modules = await listRemoteModules();
  const localRegistration = readRegistration();

  console.log(`Registered habitat "${registration.displayName}".`);
  console.log(`Habitat ID: ${registration.habitatId}`);
  console.log(`Habitat UUID: ${registration.habitatUuid}`);
  console.log(`Kepler base URL: ${registration.baseUrl}`);
  console.log(`Starter modules: ${registration.starterModules.length}`);
  console.log(`Local modules: ${modules.length}`);
  console.log(`Blueprints returned: ${registration.blueprints.length}`);
  console.log(`Registered at: ${resolveRegisteredAt(registration, localRegistration)}`);
}

async function ensureModulesHydrated(registration: StoredRegistration) {
  const modules = await listRemoteModules();

  if (modules.length > 0 || registration.starterModules.length === 0) {
    return modules;
  }

  const hydratedModules = hydrateModulesFromStarterModules(
    registration.starterModules,
    registration.registeredAt,
  );
  return replaceRemoteModules(hydratedModules);
}

async function readHydratedModules() {
  const registration = await getRemoteRegistration();

  if (registration) {
    return ensureModulesHydrated(registration);
  }

  return listRemoteModules();
}

async function printStatus(status: HabitatStatus, registration: StoredRegistration) {
  const modules = await ensureModulesHydrated(registration);
  const localRegistration = readRegistration();

  console.log(`Habitat: ${status.displayName}`);
  console.log(`Habitat ID: ${status.id}`);
  console.log(`Slug: ${status.habitatSlug}`);
  console.log(`Status: ${status.status}`);
  console.log(`Modules: ${modules.length}`);
  console.log(`Catalog version: ${status.catalogVersion}`);
  console.log(`Last seen: ${status.lastSeenAt ?? "never"}`);
  console.log(`Registered at: ${resolveRegisteredAt(registration, localRegistration)}`);
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

async function runTickCommand(ticksInput: string) {
  const ticks = parseTicks(ticksInput);
  const modules = await readHydratedModules();
  let solarIrradiance: SolarIrradiance | undefined;
  let solarIssueReason: string | undefined;

  if (hasSolarGenerationModules(modules)) {
    try {
      solarIrradiance = await getSolarIrradiance();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      solarIssueReason = message.includes("unexpected solar irradiance response")
        ? "Kepler returned an unexpected solar irradiance response"
        : `Kepler solar endpoint failed: ${message.replace(/\.$/, "")}`;
    }
  }

  const result = runPowerTicks(modules, ticks);
  const solarResult = solarIrradiance
    ? applySolarGeneration(result.modules, ticks, solarIrradiance)
    : undefined;
  const constructionResult = advanceConstructionJobs(
    solarResult?.modules ?? result.modules,
    ticks,
  );
  await replaceRemoteModules(constructionResult.modules);

  console.log(`Executed ${result.ticksExecuted} ticks.`);
  console.log(`Power demand: ${result.totalPowerDemandKw} kW`);
  console.log(`Energy consumed: ${formatKwh(result.energyConsumedKwh)} kWh`);
  console.log(`Battery energy: ${result.batteryEnergyBeforeKwh} -> ${formatKwh(result.batteryEnergyAfterKwh)} kWh`);
  console.log(`Updated ${result.updatedBatteryCount} battery module.`);

  if (solarResult) {
    console.log(`Solar generation: ${formatKwh(solarResult.grossGeneratedKwh)} kWh`);
    console.log(`Solar charged: ${formatKwh(solarResult.storedKwh)} kWh`);
    console.log(
      `Online battery energy: ${formatKwh(solarResult.batteryEnergyBeforeKwh)} -> ${formatKwh(solarResult.batteryEnergyAfterKwh)} kWh`,
    );
    console.log(`Updated ${solarResult.updatedBatteryCount} online battery module${solarResult.updatedBatteryCount === 1 ? "" : "s"}.`);

    if (solarResult.storedKwh === 0) {
      console.log(
        `No solar charging happened: ${solarResult.noChargingReason ?? "no charge was stored"}.`,
      );
    }
  } else if (solarIssueReason) {
    console.log(`No solar charging happened: ${solarIssueReason}.`);
  } else {
    console.log("No solar charging happened: no solar modules are available.");
  }

  if (constructionResult.completedModuleIds.length > 0) {
    console.log(
      `Completed construction: ${constructionResult.completedModuleIds.join(", ")}`,
    );
  }
}

async function runScanCommand(options: ScanOptions) {
  const strength = parseScanInteger(options.strength, "strength", 0, 100);
  const radius = parseScanInteger(options.radius, "radius", 0, 5);
  const response = await scanWorld(strength, radius);

  if (options.json) {
    console.log(formatWorldScanJson(response));
    return;
  }

  console.log(formatWorldScan(response));
}

async function runCollectCommand(quantity: string) {
  const parsed = parseQuantity(quantity);
  const response = await collectResource(parsed);
  console.log(formatCollection(response.collection, response.exploration));
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

function formatSolarCondition(condition: string) {
  switch (condition) {
    case "clear":
      return "Clear skies, good for solar generation.";
    case "dust":
      return "Dust is dimming the sunlight.";
    case "storm":
      return "A storm is blocking much of the sunlight.";
    case "night":
      return "It is night, so sunlight is unavailable.";
    default:
      return `Unknown condition: ${condition}`;
  }
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
const humanCommand = program
  .command("human")
  .description("List humans and their current habitat locations.");
const evaCommand = program
  .command("eva")
  .description("Manage the local EVA exploration state.");
const blueprintCommand = program
  .command("blueprint")
  .description("Inspect official Kepler blueprint catalog entries.");
const resourceCommand = program
  .command("resource")
  .description("Inspect official Kepler resource catalog entries.");
const solarCommand = program
  .command("solar")
  .description("Inspect the current solar irradiance reading.");
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
  .habitat/state.sqlite stores local registration and module state.
  Legacy .habitat/registration.json and .habitat/modules.json are ignored unless
  migrated manually.

Commands:
  habitat register --name "<habitat name>"
  habitat status
  habitat unregister
  habitat module create --id <id> --blueprint-id <blueprintId> --name "<name>" [--alias <alias>]
  habitat module list
  habitat module show <id-or-alias>
  habitat module update <id-or-alias> [--name <name>] [--status <status>] [--health <0-100>]
  habitat module delete <id-or-alias>
  habitat human list [--json]
  habitat eva status [--json]
  habitat eva deploy <human-id>
  habitat eva move <x> <y>
  habitat eva dock
  habitat blueprint list
  habitat blueprint show <blueprint-id>
  habitat resource list
  habitat scan --x 3 --y -2 --strength 60 [--radius 0] [--json]
  habitat solar status
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
Local module records are stored in .habitat/state.sqlite.
Registration hydrates starter modules from Kepler's starterModules response into SQLite.

Examples:
  habitat module list
  habitat module show command-1
  habitat module create --id test-module-1 --alias test-1 --blueprint-id test-module --name "Test Module"
  habitat module update test-module-1 --status active --health 95
  habitat module delete test-module-1
`,
);

humanCommand
  .command("list")
  .description("List humans and their current module locations.")
  .option("--json", "Print humans as JSON")
  .action(async (options: HumanListOptions) => {
    try {
      const humans = await listRemoteHumans();
      console.log(
        options.json ? JSON.stringify(humans, null, 2) : formatHumanList(humans),
      );
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

evaCommand.command("status")
  .description("Show explorer, position, and carried resources.")
  .option("--json", "Print exploration state as JSON")
  .action(async (options: EvaOptions) => {
    try {
      const state = await getExplorationState();
      console.log(options.json ? JSON.stringify(state, null, 2) : formatExplorationStatus(state));
    } catch (error) { printError(error); process.exit(1); }
  });

evaCommand.command("deploy")
  .description("Deploy one human from the active suitport.")
  .argument("<human-id>", "Human ID")
  .action(async (humanId: string) => {
    try { await deployExplorer(humanId); console.log(`Deployed human "${humanId}" at (0, 0).`); }
    catch (error) { printError(error); process.exit(1); }
  });

evaCommand.command("move")
  .description("Move the deployed explorer one adjacent tile.")
  .argument("<x>", "Destination x coordinate")
  .argument("<y>", "Destination y coordinate")
  .action(async (x: string, y: string) => {
    try {
      const state = await moveExplorer(Number(x), Number(y));
      console.log(`Explorer moved to (${state.x}, ${state.y}).`);
    } catch (error) { printError(error); process.exit(1); }
  });

evaCommand.command("dock")
  .description("Dock the deployed explorer at (0, 0).")
  .action(async () => {
    try { await dockExplorer(); console.log("Explorer docked at (0, 0)."); }
    catch (error) { printError(error); process.exit(1); }
  });

humanCommand
  .command("move")
  .description("Move one human to another habitat module.")
  .argument("<human-id>", "Human ID")
  .argument("<module-id>", "Destination module ID or alias")
  .action(async (humanId: string, moduleId: string) => {
    try {
      const human = await moveRemoteHuman(humanId, moduleId);
      console.log(`Moved "${human.displayName}" to module "${human.locationModuleId}".`);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

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

solarCommand.addHelpText(
  "after",
  `
This command reads Kepler's current solar irradiance and describes it in plain language.

Examples:
  habitat solar status
`,
);

inventoryCommand
  .command("add")
  .description("Add resources to the supply cache inventory.")
  .argument("<resource-type>", "Resource type")
  .argument("<quantity>", "Quantity to add")
  .action(async (resourceType: string, quantity: string) => {
    try {
      const inventory = await getCurrentInventory();
      const updatedInventory = {
        ...inventory,
        [resourceType]: (inventory[resourceType] ?? 0) + parseQuantity(quantity),
      };
      const result = await setRemoteInventory(updatedInventory);
      console.log(
        `Supply cache inventory updated: ${resourceType} = ${result[resourceType]}`,
      );
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

inventoryCommand
  .command("remove")
  .description("Remove resources from the supply cache inventory.")
  .argument("<resource-type>", "Resource type")
  .argument("<quantity>", "Quantity to remove")
  .action(async (resourceType: string, quantity: string) => {
    try {
      const inventory = await getCurrentInventory();
      const removalQuantity = parseQuantity(quantity);
      const availableQuantity = inventory[resourceType] ?? 0;

      if (availableQuantity < removalQuantity) {
        throw new Error(
          `Insufficient inventory for required resource "${resourceType}".`,
        );
      }

      const updatedInventory = {
        ...inventory,
        [resourceType]: availableQuantity - removalQuantity,
      };
      const result = await setRemoteInventory(updatedInventory);
      console.log(
        `Supply cache inventory updated: ${resourceType} = ${result[resourceType]}`,
      );
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

inventoryCommand.addHelpText(
  "after",
  `
Inventory is stored on the supply-cache module in .habitat/state.sqlite.

Examples:
  habitat inventory list
  habitat inventory add ferrite 90
  habitat inventory remove ferrite 25
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
      const registration = await getRemoteRegistration();

      if (!registration) {
        throw new Error("No remote registration found. Run habitat register first.");
      }

      const modules = await readHydratedModules();
      const result = await startConstruction(blueprintId, modules);
      await replaceRemoteModules(result.modules);
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
  .action(async () => {
    try {
      console.log(formatConstructionStatusTable(await readHydratedModules()));
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

constructionCommand
  .command("cancel")
  .description("Cancel one active construction job.")
  .argument("<fabricator-id-or-alias>", "Fabricator ID or alias")
  .action(async (moduleId: string) => {
    try {
      const modules = await readHydratedModules();
      const result = cancelConstructionJob(modules, moduleId);
      await replaceRemoteModules(result.modules);
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
  .action(async () => {
    try {
      console.log(formatInventoryTableFromInventory(await getCurrentInventory()));
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
  .action(async (ticksArgument: string | undefined, options: TickOptions) => {
    try {
      const ticksInput = ticksArgument ?? options.ticks;

      if (!ticksInput) {
        throw new Error("Provide ticks as a positional argument or with --ticks.");
      }

      await runTickCommand(ticksInput);
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
      await printRegistration(registration);
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
      const registration = await getRemoteRegistration();

      if (!registration) {
        throw new Error("No remote registration found. Run habitat register first.");
      }

      const status = await fetchRegistrationStatus(registration);
      await printStatus(status, registration);
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
      const registration = await getRemoteRegistration();

      if (!registration) {
        throw new Error("No remote registration found. Nothing to unregister.");
      }

      await unregisterHabitat();
      console.log(`Unregistered habitat "${registration.displayName}".`);
      console.log(`Cleared remote state at ${registration.baseUrl}`);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

program
  .command("scan")
  .description("Scan nearby world tiles for estimated resources.")
  .requiredOption("--strength <0-100>", "Effective sensor strength")
  .option("--radius <0-5>", "Scan radius, default 0", "0")
  .option("--json", "Print the complete JSON response")
  .action(async (options: ScanOptions) => {
    try {
      await runScanCommand(options);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

program
  .command("collect <quantity-kg>")
  .description("Collect material at the deployed explorer's position.")
  .action(async (quantity: string) => {
    try {
      await runCollectCommand(quantity);
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

const alertCommand = program.command("alert").description("Manage operational alerts.");
alertCommand.command("list").description("List operational alerts.").action(async () => {
  try { console.log(formatAlertList(await listRemoteAlerts())); }
  catch (error) { printError(error); process.exit(1); }
});
alertCommand.command("acknowledge").argument("<alert-id>", "Alert ID").action(async (alertId: string) => {
  try { console.log(`Acknowledged alert \"${(await acknowledgeRemoteAlert(alertId)).id}\".`); }
  catch (error) { printError(error); process.exit(1); }
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

solarCommand
  .command("status")
  .description("Show the current solar irradiance and condition.")
  .action(async () => {
    try {
      const solarIrradiance = await getSolarIrradiance();
      console.log(`Current solar irradiance: ${solarIrradiance.wPerM2} W/m2`);
      console.log(`Condition: ${formatSolarCondition(solarIrradiance.condition)}`);
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
  .action(async (options: ModuleCreateOptions) => {
    try {
      const module = await createModule(options);
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
  .action(async () => {
    try {
      printModuleList(await readHydratedModules());
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  });

moduleCommand
  .command("status")
  .description("Show module states with current power draw.")
  .action(async () => {
    try {
      console.log(formatModulePowerStatusTable(await readHydratedModules()));
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
  .action(async (moduleId: string, status: string) => {
    try {
      const updatedModule = await setModuleStatus(moduleId, parseModuleStatus(status));
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
  .action(async (moduleId: string) => {
    try {
      const module = await findModule(moduleId);

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
  .action(async (moduleId: string, options: ModuleUpdateOptions) => {
    try {
      const module = await updateModule(moduleId, options);
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
  .action(async (moduleId: string) => {
    try {
      await deleteModule(moduleId);
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
