import { existsSync, rmSync } from "node:fs";

import {
  getLegacyModulesFilePath,
  getLegacyRegistrationFilePath,
  getStateDatabaseFilePath,
  openHabitatDatabase,
} from "./habitat-state-db";

export type StarterModuleInstance = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

export type ProductionBlueprint = {
  id: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  status?: string;
  output?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  buildTicks?: number;
  repeatable?: boolean;
  runtimeAttributes?: Record<string, unknown>;
  capabilities?: string[];
};

export type StoredRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  baseUrl: string;
  registeredAt: string;
  starterModules: StarterModuleInstance[];
  blueprints: ProductionBlueprint[];
  lastStatus?: HabitatStatus;
};

export type HabitatModule = {
  id: string;
  alias: string;
  blueprintId: string;
  moduleType: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
  constructionStatus: "built";
  source: "kepler-registration" | "local";
  createdAt: string;
  updatedAt: string;
  constructionJob?: ConstructionJob;
};

export type ConstructionJob = {
  blueprintId: string;
  outputModuleId: string;
  outputModuleType: string;
  buildTicks: number;
  remainingTicks: number;
  requiredResources: Record<string, number>;
  futureRuntimeAttributes: Record<string, unknown>;
  futureCapabilities: string[];
  startedAt: string;
};

export type HabitatStatus = {
  id: string;
  habitatSlug: string;
  displayName: string;
  catalogVersion: string;
  status: string;
  lastSeenAt?: string | null;
};

type RegistrationRow = {
  habitat_uuid: string;
  habitat_id: string;
  display_name: string;
  base_url: string;
  registered_at: string;
  starter_modules_json: string;
  blueprints_json: string;
  last_status_json: string | null;
};

type ModuleRow = {
  id: string;
  alias: string;
  blueprint_id: string;
  module_type: string;
  display_name: string;
  connected_to_json: string;
  runtime_attributes_json: string;
  capabilities_json: string;
  construction_status: string;
  source: string;
  created_at: string;
  updated_at: string;
  construction_job_json: string | null;
};

let legacyWarningShown = false;

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

function isStoredRegistration(value: unknown): value is StoredRegistration {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.habitatUuid === "string" &&
    typeof value.habitatId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.baseUrl === "string" &&
    typeof value.registeredAt === "string" &&
    Array.isArray(value.starterModules) &&
    value.starterModules.every(isStarterModuleInstance) &&
    Array.isArray(value.blueprints) &&
    value.blueprints.every(isProductionBlueprint) &&
    (value.lastStatus === undefined || isHabitatStatus(value.lastStatus))
  );
}

function isConstructionJob(value: unknown): value is ConstructionJob {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.blueprintId === "string" &&
    typeof value.outputModuleId === "string" &&
    typeof value.outputModuleType === "string" &&
    typeof value.buildTicks === "number" &&
    typeof value.remainingTicks === "number" &&
    isRecord(value.requiredResources) &&
    isRecord(value.futureRuntimeAttributes) &&
    isStringArray(value.futureCapabilities) &&
    typeof value.startedAt === "string"
  );
}

function isHabitatModule(value: unknown): value is HabitatModule {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.alias === "string" &&
    typeof value.blueprintId === "string" &&
    typeof value.moduleType === "string" &&
    typeof value.displayName === "string" &&
    isStringArray(value.connectedTo) &&
    isRecord(value.runtimeAttributes) &&
    isStringArray(value.capabilities) &&
    value.constructionStatus === "built" &&
    (value.source === "kepler-registration" || value.source === "local") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.constructionJob === undefined || isConstructionJob(value.constructionJob))
  );
}

function toModuleAlias(moduleType: string, index: number) {
  const aliasBaseByType: Record<string, string> = {
    "basic-battery": "battery",
    "basic-suitport": "suitport",
    "command-module": "command",
    "life-support": "life-support",
    "supply-cache": "supply",
    "workshop-fabricator": "fabricator",
  };

  return `${aliasBaseByType[moduleType] ?? moduleType}-${index}`;
}

function withModuleAliases(modules: Omit<HabitatModule, "alias">[]): HabitatModule[] {
  const typeCounts = new Map<string, number>();

  return modules.map((module) => {
    const nextCount = (typeCounts.get(module.moduleType) ?? 0) + 1;
    typeCounts.set(module.moduleType, nextCount);

    return {
      ...module,
      alias: toModuleAlias(module.moduleType, nextCount),
    };
  });
}

function normalizeModules(value: unknown): HabitatModule[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.every(isHabitatModule)) {
    return value;
  }

  const modulesWithoutAliases = value.filter(
    (module): module is Omit<HabitatModule, "alias"> => {
      if (!isRecord(module)) {
        return false;
      }

      return (
        typeof module.id === "string" &&
        typeof module.blueprintId === "string" &&
        typeof module.moduleType === "string" &&
        typeof module.displayName === "string" &&
        isStringArray(module.connectedTo) &&
        isRecord(module.runtimeAttributes) &&
        isStringArray(module.capabilities) &&
        module.constructionStatus === "built" &&
        (module.source === "kepler-registration" || module.source === "local") &&
        typeof module.createdAt === "string" &&
        typeof module.updatedAt === "string" &&
        (module.constructionJob === undefined || isConstructionJob(module.constructionJob))
      );
    },
  );

  if (modulesWithoutAliases.length !== value.length) {
    return undefined;
  }

  return withModuleAliases(modulesWithoutAliases);
}

function parseJsonColumn(value: string | null, label: string): unknown {
  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON in the local state database.`);
  }
}

function maybeWarnLegacyJsonIgnored(cwd = process.cwd()) {
  if (legacyWarningShown) {
    return;
  }

  const legacyRegistrationPath = getLegacyRegistrationFilePath(cwd);
  const legacyModulesPath = getLegacyModulesFilePath(cwd);

  if (!existsSync(legacyRegistrationPath) && !existsSync(legacyModulesPath)) {
    return;
  }

  const database = openHabitatDatabase(cwd);

  try {
    const registrationCount = Number(
      database.query("SELECT COUNT(*) AS count FROM registration").get()?.count ?? 0,
    );
    const moduleCount = Number(
      database.query("SELECT COUNT(*) AS count FROM modules").get()?.count ?? 0,
    );

    if (registrationCount === 0 && moduleCount === 0) {
      console.warn(
        "Legacy .habitat JSON files were found, but this CLI now reads local state from .habitat/state.sqlite.",
      );
      legacyWarningShown = true;
    }
  } finally {
    database.close();
  }
}

function rowToStoredRegistration(row: RegistrationRow): StoredRegistration {
  const parsed = {
    habitatUuid: row.habitat_uuid,
    habitatId: row.habitat_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    registeredAt: row.registered_at,
    starterModules: parseJsonColumn(row.starter_modules_json, "starter_modules_json"),
    blueprints: parseJsonColumn(row.blueprints_json, "blueprints_json"),
    lastStatus: parseJsonColumn(row.last_status_json, "last_status_json"),
  };

  if (!isStoredRegistration(parsed)) {
    throw new Error(
      `Registration state is not valid in the local state database: ${getStateDatabaseFilePath()}`,
    );
  }

  return parsed;
}

function moduleToRow(module: HabitatModule): ModuleRow {
  return {
    id: module.id,
    alias: module.alias,
    blueprint_id: module.blueprintId,
    module_type: module.moduleType,
    display_name: module.displayName,
    connected_to_json: JSON.stringify(module.connectedTo),
    runtime_attributes_json: JSON.stringify(module.runtimeAttributes),
    capabilities_json: JSON.stringify(module.capabilities),
    construction_status: module.constructionStatus,
    source: module.source,
    created_at: module.createdAt,
    updated_at: module.updatedAt,
    construction_job_json: module.constructionJob
      ? JSON.stringify(module.constructionJob)
      : null,
  };
}

function rowToModule(row: ModuleRow): HabitatModule {
  const parsed = {
    id: row.id,
    alias: row.alias,
    blueprintId: row.blueprint_id,
    moduleType: row.module_type,
    displayName: row.display_name,
    connectedTo: parseJsonColumn(row.connected_to_json, "connected_to_json"),
    runtimeAttributes: parseJsonColumn(
      row.runtime_attributes_json,
      "runtime_attributes_json",
    ),
    capabilities: parseJsonColumn(row.capabilities_json, "capabilities_json"),
    constructionStatus: row.construction_status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    constructionJob: parseJsonColumn(row.construction_job_json, "construction_job_json"),
  };

  if (!isHabitatModule(parsed)) {
    throw new Error(
      `Modules state is not valid in the local state database: ${getStateDatabaseFilePath()}`,
    );
  }

  return parsed;
}

export function getDatabaseFilePath(cwd = process.cwd()) {
  return getStateDatabaseFilePath(cwd);
}

export function getRegistrationFilePath(cwd = process.cwd()) {
  return getStateDatabaseFilePath(cwd);
}

export function getModulesFilePath(cwd = process.cwd()) {
  return getStateDatabaseFilePath(cwd);
}

export function readRegistration(cwd = process.cwd()): StoredRegistration | undefined {
  maybeWarnLegacyJsonIgnored(cwd);
  const database = openHabitatDatabase(cwd);

  try {
    const row = database
      .query(
        `SELECT habitat_uuid, habitat_id, display_name, base_url, registered_at,
                starter_modules_json, blueprints_json, last_status_json
           FROM registration
          LIMIT 1`,
      )
      .get() as RegistrationRow | null;

    return row ? rowToStoredRegistration(row) : undefined;
  } finally {
    database.close();
  }
}

export function writeRegistration(registration: StoredRegistration, cwd = process.cwd()) {
  maybeWarnLegacyJsonIgnored(cwd);
  const database = openHabitatDatabase(cwd);

  try {
    const row: RegistrationRow = {
      habitat_uuid: registration.habitatUuid,
      habitat_id: registration.habitatId,
      display_name: registration.displayName,
      base_url: registration.baseUrl,
      registered_at: registration.registeredAt,
      starter_modules_json: JSON.stringify(registration.starterModules),
      blueprints_json: JSON.stringify(registration.blueprints),
      last_status_json: registration.lastStatus
        ? JSON.stringify(registration.lastStatus)
        : null,
    };

    const replaceRegistration = database.transaction((value: RegistrationRow) => {
      database.run("DELETE FROM registration");
      database.run(
        `INSERT INTO registration (
          habitat_uuid,
          habitat_id,
          display_name,
          base_url,
          registered_at,
          starter_modules_json,
          blueprints_json,
          last_status_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          value.habitat_uuid,
          value.habitat_id,
          value.display_name,
          value.base_url,
          value.registered_at,
          value.starter_modules_json,
          value.blueprints_json,
          value.last_status_json,
        ],
      );
    });

    replaceRegistration(row);
  } finally {
    database.close();
  }
}

export function deleteRegistration(cwd = process.cwd()) {
  maybeWarnLegacyJsonIgnored(cwd);
  const database = openHabitatDatabase(cwd);

  try {
    database.run("DELETE FROM registration");
  } finally {
    database.close();
  }
}

export function readModules(cwd = process.cwd()): HabitatModule[] {
  maybeWarnLegacyJsonIgnored(cwd);
  const database = openHabitatDatabase(cwd);

  try {
    const rows = database
      .query(
        `SELECT id, alias, blueprint_id, module_type, display_name, connected_to_json,
                runtime_attributes_json, capabilities_json, construction_status, source,
                created_at, updated_at, construction_job_json
           FROM modules
          ORDER BY rowid`,
      )
      .all() as ModuleRow[];

    return rows.map(rowToModule);
  } finally {
    database.close();
  }
}

export function writeModules(modules: HabitatModule[], cwd = process.cwd()) {
  maybeWarnLegacyJsonIgnored(cwd);
  const database = openHabitatDatabase(cwd);

  try {
    const normalizedModules = normalizeModules(modules);

    if (!normalizedModules) {
      throw new Error(`Modules data is not valid: ${getStateDatabaseFilePath(cwd)}`);
    }

    const rows = normalizedModules.map(moduleToRow);
    const replaceModules = database.transaction((items: ModuleRow[]) => {
      database.run("DELETE FROM modules");

      for (const row of items) {
        database.run(
          `INSERT INTO modules (
            id,
            alias,
            blueprint_id,
            module_type,
            display_name,
            connected_to_json,
            runtime_attributes_json,
            capabilities_json,
            construction_status,
            source,
            created_at,
            updated_at,
            construction_job_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.alias,
            row.blueprint_id,
            row.module_type,
            row.display_name,
            row.connected_to_json,
            row.runtime_attributes_json,
            row.capabilities_json,
            row.construction_status,
            row.source,
            row.created_at,
            row.updated_at,
            row.construction_job_json,
          ],
        );
      }
    });

    replaceModules(rows);
  } finally {
    database.close();
  }
}

export function deleteModules(cwd = process.cwd()) {
  maybeWarnLegacyJsonIgnored(cwd);
  const database = openHabitatDatabase(cwd);

  try {
    database.run("DELETE FROM modules");
  } finally {
    database.close();
  }
}

export function deleteLegacyStateFiles(cwd = process.cwd()) {
  const legacyPaths = [getLegacyRegistrationFilePath(cwd), getLegacyModulesFilePath(cwd)];

  for (const path of legacyPaths) {
    if (existsSync(path)) {
      rmSync(path);
    }
  }
}

export function hydrateModulesFromStarterModules(
  starterModules: StarterModuleInstance[],
  now = new Date().toISOString(),
): HabitatModule[] {
  return withModuleAliases(
    starterModules.map((starterModule) => ({
      id: starterModule.id,
      blueprintId: starterModule.blueprintId,
      moduleType: starterModule.blueprintId,
      displayName: starterModule.displayName,
      connectedTo: starterModule.connectedTo,
      runtimeAttributes: starterModule.runtimeAttributes,
      capabilities: starterModule.capabilities,
      constructionStatus: "built",
      source: "kepler-registration",
      createdAt: now,
      updatedAt: now,
    })),
  );
}
