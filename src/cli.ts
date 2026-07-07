#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { Command, CommanderError } from "commander";
import packageJson from "../package.json";
import {
  deleteRegistration,
  getRegistrationFilePath,
  readRegistration,
  type HabitatStatus,
  type ProductionBlueprint,
  type StarterModuleInstance,
  type StoredRegistration,
  writeRegistration,
} from "./habitat-store";

type RegisterOptions = {
  name: string;
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
  await keplerRequest(
    `/habitats/${encodeURIComponent(registration.habitatId)}`,
    {
      method: "DELETE",
    },
    registration.baseUrl,
  );
  deleteRegistration();
}

function printRegistration(registration: StoredRegistration) {
  console.log(`Registered habitat "${registration.displayName}".`);
  console.log(`Habitat ID: ${registration.habitatId}`);
  console.log(`Habitat UUID: ${registration.habitatUuid}`);
  console.log(`Kepler base URL: ${registration.baseUrl}`);
  console.log(`Starter modules: ${registration.starterModules.length}`);
  console.log(`Blueprints returned: ${registration.blueprints.length}`);
  console.log(`Stored in ${getRegistrationFilePath()}`);
}

function printStatus(status: HabitatStatus, registration: StoredRegistration) {
  console.log(`Habitat: ${status.displayName}`);
  console.log(`Habitat ID: ${status.id}`);
  console.log(`Slug: ${status.habitatSlug}`);
  console.log(`Status: ${status.status}`);
  console.log(`Catalog version: ${status.catalogVersion}`);
  console.log(`Last seen: ${status.lastSeenAt ?? "never"}`);
  console.log(`Local registration: ${getRegistrationFilePath()}`);
  console.log(`Registered at: ${registration.registeredAt}`);
}

function printError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
}

const program = new Command();

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
`,
);

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
