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

export function getRegistrationFilePath() {
  return registrationFilePath;
}

export function readRegistration(): StoredRegistration | undefined {
  if (!existsSync(registrationFilePath)) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(registrationFilePath, "utf8")) as unknown;

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
