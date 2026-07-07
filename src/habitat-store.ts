import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

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
};

export type HabitatStatus = {
  id: string;
  habitatSlug: string;
  displayName: string;
  catalogVersion: string;
  status: string;
  lastSeenAt?: string | null;
};

const registrationFilePath = join(
  process.cwd(),
  ".habitat",
  "registration.json",
);
const modulesFilePath = join(process.cwd(), ".habitat", "modules.json");

function ensureHabitatDirectory() {
  mkdirSync(dirname(registrationFilePath), { recursive: true });
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
    typeof value.updatedAt === "string"
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
        typeof module.updatedAt === "string"
      );
    },
  );

  if (modulesWithoutAliases.length !== value.length) {
    return undefined;
  }

  return withModuleAliases(modulesWithoutAliases);
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function getRegistrationFilePath() {
  return registrationFilePath;
}

export function getModulesFilePath() {
  return modulesFilePath;
}

export function readRegistration(): StoredRegistration | undefined {
  if (!existsSync(registrationFilePath)) {
    return undefined;
  }

  const parsed = readJsonFile(registrationFilePath);

  if (!isStoredRegistration(parsed)) {
    throw new Error(
      `Registration file is not valid: ${registrationFilePath}`,
    );
  }

  return parsed;
}

export function writeRegistration(registration: StoredRegistration) {
  ensureHabitatDirectory();
  writeFileSync(
    registrationFilePath,
    `${JSON.stringify(registration, null, 2)}\n`,
    "utf8",
  );
}

export function deleteRegistration() {
  if (existsSync(registrationFilePath)) {
    rmSync(registrationFilePath);
  }
}

export function readModules(): HabitatModule[] {
  if (!existsSync(modulesFilePath)) {
    return [];
  }

  const parsed = readJsonFile(modulesFilePath);

  const modules = normalizeModules(parsed);

  if (!modules) {
    throw new Error(`Modules file is not valid: ${modulesFilePath}`);
  }

  if (!Array.isArray(parsed) || !parsed.every(isHabitatModule)) {
    writeModules(modules);
  }

  return modules;
}

export function writeModules(modules: HabitatModule[]) {
  ensureHabitatDirectory();
  writeFileSync(modulesFilePath, `${JSON.stringify(modules, null, 2)}\n`, "utf8");
}

export function deleteModules() {
  if (existsSync(modulesFilePath)) {
    rmSync(modulesFilePath);
  }
}

export function hydrateModulesFromStarterModules(
  starterModules: StarterModuleInstance[],
  now = new Date().toISOString(),
): HabitatModule[] {
  return withModuleAliases(starterModules.map((starterModule) => ({
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
  })));
}
