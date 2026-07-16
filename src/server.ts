import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { cors } from "hono/cors";

import { ApiClientError, requestJson, requestJsonWithStatus } from "./api-client";
import {
  deleteModules,
  deleteRegistration,
  hydrateModulesFromStarterModules,
  readModules,
  readRegistration,
  writeRegistration,
  type HabitatModule,
  type StoredRegistration,
  type RegistrationContracts,
  type StreamRegistrationMetadata,
  type StarterHuman,
  writeModules,
  writeRegistrationAndModules,
} from "./habitat-store";
import type { BlueprintDetail } from "./kepler-blueprints";
import type { ResourceSummary } from "./kepler-resources";
import {
  readSupplyCacheInventory,
  type HabitatInventory,
  writeSupplyCacheInventory,
} from "./habitat-inventory";
import type { SolarIrradiance } from "./kepler-solar";
import {
  applySolarGeneration,
  getTotalCurrentPowerGenerationKw,
  getTotalCurrentPowerDrawKw,
  runPowerTicks,
} from "./power-tick";
import {
  HumanMoveError,
  moveHabitatHuman,
  readHabitatHumans,
  type HabitatHuman,
} from "./humans";
import {
  ExplorationError,
  deployExplorer,
  dockExplorer,
  formatExplorationStatus,
  moveExplorer,
  readExplorationState,
  type ExplorationState,
} from "./exploration";
import {
  persistCollection,
  validateCollection,
  type WorldCollectionResponse,
} from "./collection";
import { acknowledgeAlert, listAlerts, observeAlert } from "./alerts";

export type BackendRegistrationView = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  baseUrl: string;
  registeredAt: string;
  starterModules: StoredRegistration["starterModules"];
  starterHumans: StarterHuman[];
  blueprints: StoredRegistration["blueprints"];
  contracts?: RegistrationContracts;
  lastStatus?: StoredRegistration["lastStatus"];
  streamUrl?: string;
  apiToken?: string;
  stream?: StreamRegistrationMetadata;
};

export type BackendRegistrationResponse = {
  registration: BackendRegistrationView | null;
};

export type BackendModulesResponse = {
  modules: HabitatModule[];
};

export type BackendHumansResponse = {
  humans: HabitatHuman[];
};

export type BackendExplorationResponse = {
  exploration: ExplorationState;
};

export type BackendModuleResponse = {
  module: HabitatModule;
};

export type BackendInventoryResponse = {
  inventory: HabitatInventory;
};

export type BackendPowerSnapshot = {
  modules: HabitatModule[];
  powerGenerationKw: number;
  powerConsumptionKw: number;
  netPowerKw: number;
  batteryEnergyKwh: number;
  batteryCapacityKwh: number;
  solarIrradiance: SolarIrradiance | null;
};

export type BackendAppOptions = {
  cwd?: string;
  apiToken?: string;
  keplerBaseUrl?: string;
  keplerToken?: string;
};

function getApiToken(options: BackendAppOptions) {
  return (
    options.apiToken ??
    process.env.HABITAT_API_TOKEN ??
    process.env.KEPLER_PLANET_TOKEN ??
    process.env.KEPLER_WORLD_TOKEN ??
    process.env.PLANET_TOKEN
  );
}

function getListenPort() {
  const rawPort = process.env.HABITAT_API_PORT ?? "8787";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("HABITAT_API_PORT must be a valid TCP port number.");
  }

  return port;
}

function getKeplerBaseUrl(options: BackendAppOptions) {
  return (
    options.keplerBaseUrl ??
    process.env.KEPLER_BASE_URL ??
    process.env.KEPLER_WORLD_BASE_URL ??
    process.env.PLANET_SERVER_PUBLIC_BASE_URL ??
    "https://planet.turingguild.com"
  ).replace(/\/+$/, "");
}

function getKeplerToken(options: BackendAppOptions) {
  return (
    options.keplerToken ??
    options.apiToken ??
    process.env.KEPLER_PLANET_TOKEN ??
    process.env.KEPLER_WORLD_TOKEN ??
    process.env.PLANET_TOKEN
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStarterHuman(value: unknown): value is StarterHuman {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.locationModuleId === "string"
  );
}

function isRegistrationContracts(value: unknown): value is RegistrationContracts {
  if (!isRecord(value) || !isRecord(value.alerts)) {
    return false;
  }

  return (
    typeof value.alerts.schemaVersion === "string" &&
    isRecord(value.alerts.schema)
  );
}

function isStreamRegistrationMetadata(value: unknown): value is StreamRegistrationMetadata {
  return (
    isRecord(value) &&
    typeof value.protocolVersion === "string" &&
    Array.isArray(value.subscriptions) &&
    value.subscriptions.every((item) => typeof item === "string") &&
    Number.isInteger(value.currentTick) &&
    (value.currentTick as number) >= 0 &&
    Number.isInteger(value.tickIntervalMs) &&
    (value.tickIntervalMs as number) >= 0 &&
    Number.isInteger(value.ticksPerPulse) &&
    (value.ticksPerPulse as number) > 0 &&
    typeof value.status === "string"
  );
}

function proxyErrorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function logHabitatApi(method: string, path: string, summary: string) {
  console.log(`[habitat-api] ${method} ${path} -> ${summary}`);
}

function logKepler(method: string, path: string, status: number) {
  console.log(`[kepler] ${method} ${path} -> ${status}`);
}

function summarizeRegistration(registration: StoredRegistration | null) {
  if (!registration) {
    return "not registered";
  }

  return `registered habitat "${registration.displayName}"`;
}

function summarizeModules(modules: HabitatModule[]) {
  return `${modules.length} modules`;
}

function summarizeInventory(inventory: HabitatInventory) {
  const resourceTypes = Object.values(inventory).filter((quantity) => quantity > 0).length;

  if (resourceTypes === 0) {
    return "empty inventory";
  }

  return `${resourceTypes} resource types`;
}

function summarizeModulesReplaced(modules: HabitatModule[]) {
  return `replaced ${modules.length} modules`;
}

function parseScanInteger(
  value: string | undefined,
  name: string,
  minimum?: number,
  maximum?: number,
) {
  if (value === undefined || !/^-?\d+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  const parsed = Number(value);

  if (
    (minimum !== undefined && parsed < minimum) ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }

  return parsed;
}

async function proxyKeplerJson<TResponse>(
  method: string,
  path: string,
  keplerPath: string,
  options: BackendAppOptions,
  requiresToken = true,
  body?: unknown,
) {
  try {
    const response = await requestJsonWithStatus<TResponse>(path, {
      method,
      baseUrl: getKeplerBaseUrl(options),
      apiToken: requiresToken ? getKeplerToken(options) : undefined,
      body,
    });
    logKepler(method, keplerPath, response.status);
    return response.data;
  } catch (error) {
    if (error instanceof ApiClientError) {
      logKepler(method, keplerPath, error.status);
      throw proxyErrorResponse(error.message, error.status);
    }

    throw error;
  }
}

function findModuleIndex(modules: HabitatModule[], moduleId: string) {
  return modules.findIndex(
    (module) => module.id === moduleId || module.alias === moduleId,
  );
}

export function createBackendApp(options: BackendAppOptions = {}) {
  const app = new Hono();
  app.use("*", cors());

  const getPowerSnapshot = async (cwd: string): Promise<BackendPowerSnapshot> => {
    const modules = readModules(cwd);
    let solarIrradiance: SolarIrradiance | null = null;

    try {
      solarIrradiance = await proxyKeplerJson<{ solarIrradiance: SolarIrradiance }>(
        "GET",
        "/world/solar-irradiance",
        "/world/solar-irradiance",
        options,
        false,
      ).then((response) => response.solarIrradiance);
    } catch {
      solarIrradiance = null;
    }

    const powerGenerationKw = getTotalCurrentPowerGenerationKw(modules);
    const powerConsumptionKw = getTotalCurrentPowerDrawKw(modules);
    const batteries = modules.filter((module) => module.moduleType === "basic-battery");
    const batteryEnergyKwh = batteries.reduce(
      (total, module) => total + (typeof module.runtimeAttributes.currentEnergyKwh === "number" ? module.runtimeAttributes.currentEnergyKwh : 0),
      0,
    );
    const batteryCapacityKwh = batteries.reduce(
      (total, module) => total + (typeof module.runtimeAttributes.capacityKwh === "number"
        ? module.runtimeAttributes.capacityKwh
        : typeof module.runtimeAttributes.energyStorageKwh === "number"
          ? module.runtimeAttributes.energyStorageKwh
          : 0),
      0,
    );

    return {
      modules,
      powerGenerationKw,
      powerConsumptionKw,
      netPowerKw: powerGenerationKw - powerConsumptionKw,
      batteryEnergyKwh,
      batteryCapacityKwh,
      solarIrradiance,
    };
  };

  app.post("/registration", async (c) => {
    const parsed = (await c.req.json()) as { displayName?: string } | null;
    const displayName = parsed?.displayName;

    if (!displayName) {
      logHabitatApi(c.req.method, "/registration", "missing registration payload");
      return jsonError("Provide a habitat display name.");
    }

    const cwd = options.cwd ?? process.cwd();
    const existingRegistration = readRegistration(cwd);

    if (existingRegistration && existingRegistration.apiToken?.trim()) {
      logHabitatApi(
        c.req.method,
        "/registration",
        `habitat "${existingRegistration.displayName}" already registered`,
      );
      return jsonError(
        `Habitat is already registered as "${existingRegistration.displayName}" (${existingRegistration.habitatId}).`,
        409,
      );
    }

    const apiToken = getApiToken(options);

    if (!apiToken) {
      logHabitatApi(c.req.method, "/registration", "missing API token for registration");
      throw new Error(
        "Missing API token. Set HABITAT_API_TOKEN or a Kepler token before registering.",
      );
    }

    const habitatUuid = existingRegistration?.habitatUuid ?? randomUUID();
    const registrationDisplayName = existingRegistration?.displayName ?? displayName;
    const registrationResponse = await requestJsonWithStatus<{
      habitatId: string;
      streamUrl: string;
      apiToken: string;
      stream: StreamRegistrationMetadata;
      starterModules: StoredRegistration["starterModules"];
      starterHumans: StarterHuman[];
      blueprints: StoredRegistration["blueprints"];
      contracts: RegistrationContracts;
    }>("/habitats/register", {
      baseUrl: getKeplerBaseUrl(options),
      apiToken: getKeplerToken(options),
      method: "POST",
      body: {
        displayName: registrationDisplayName,
        habitatUuid,
      },
    });

    if (
      typeof registrationResponse.data.streamUrl !== "string" ||
      typeof registrationResponse.data.apiToken !== "string" ||
      !isStreamRegistrationMetadata(registrationResponse.data.stream)
    ) {
      throw new Error("Kepler returned invalid stream registration data.");
    }

    if (
      !Array.isArray(registrationResponse.data.starterHumans) ||
      !registrationResponse.data.starterHumans.every(isStarterHuman)
    ) {
      throw new Error("Kepler returned invalid starter human registration data.");
    }

    if (!isRegistrationContracts(registrationResponse.data.contracts)) {
      throw new Error("Kepler returned an invalid registration contracts object.");
    }

    const registration: StoredRegistration = {
      habitatUuid,
      habitatId: registrationResponse.data.habitatId,
      displayName: registrationDisplayName,
      baseUrl: existingRegistration?.baseUrl ?? getKeplerBaseUrl(options),
      registeredAt: existingRegistration?.registeredAt ?? new Date().toISOString(),
      streamUrl: registrationResponse.data.streamUrl,
      apiToken: registrationResponse.data.apiToken,
      stream: registrationResponse.data.stream,
      starterModules: registrationResponse.data.starterModules,
      starterHumans: registrationResponse.data.starterHumans,
      blueprints: registrationResponse.data.blueprints,
      contracts: registrationResponse.data.contracts,
    };

    if (existingRegistration) {
      writeRegistration(registration, cwd);
    } else {
      writeRegistrationAndModules(
        registration,
        hydrateModulesFromStarterModules(registration.starterModules, registration.registeredAt),
        cwd,
      );
    }

    logHabitatApi(c.req.method, "/registration", `registered habitat "${registrationDisplayName}"`);
    return c.json<BackendRegistrationResponse>(
      {
        registration: {
          ...registration,
          starterHumans: registration.starterHumans ?? [],
        },
      },
      201,
    );
  });

  app.delete("/registration", async (c) => {
    const cwd = options.cwd ?? process.cwd();
    const registration = readRegistration(cwd);

    if (!registration) {
      logHabitatApi(c.req.method, "/registration", "not registered");
      return jsonError("No local registration found.", 404);
    }

    try {
      await requestJson(
        `/habitats/${encodeURIComponent(registration.habitatId)}`,
        {
          method: "DELETE",
          baseUrl: registration.baseUrl,
          apiToken: getKeplerToken(options),
        },
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

    deleteRegistration(cwd);
    deleteModules(cwd);
    logHabitatApi(c.req.method, "/registration", `deleted habitat "${registration.habitatId}"`);
    return c.body(null, 204);
  });

  app.get("/registration", (c) => {
    const registration = readRegistration(options.cwd ?? process.cwd());

    if (!registration) {
      logHabitatApi(c.req.method, "/registration", summarizeRegistration(null));
      return c.json<BackendRegistrationResponse>({ registration: null });
    }

    if (!getApiToken(options)) {
      logHabitatApi(
        c.req.method,
        "/registration",
        "missing API token for registration lookup",
      );
      throw new Error(
        "Missing API token. Set HABITAT_API_TOKEN or a Kepler token before reading registration.",
      );
    }

    const response = c.json<BackendRegistrationResponse>({
      registration: {
        ...registration,
        starterHumans: registration.starterHumans ?? [],
      },
    });
    logHabitatApi(
      c.req.method,
      "/registration",
      summarizeRegistration(registration),
    );
    return response;
  });

  app.get("/modules", (c) => {
    const modules = readModules(options.cwd ?? process.cwd());
    logHabitatApi(c.req.method, "/modules", summarizeModules(modules));
    return c.json<BackendModulesResponse>({ modules });
  });

  app.get("/power", async (c) => {
    const snapshot = await getPowerSnapshot(options.cwd ?? process.cwd());
    logHabitatApi(c.req.method, "/power", `${snapshot.powerConsumptionKw} kW consumption`);
    return c.json(snapshot);
  });

  app.post("/tick", async (c) => {
    const parsed = (await c.req.json()) as { ticks?: number } | null;
    const ticks = parsed?.ticks;

    if (!Number.isInteger(ticks) || (ticks as number) <= 0) {
      return jsonError("Ticks must be a positive integer.");
    }

    const cwd = options.cwd ?? process.cwd();
    const modules = readModules(cwd);
    try {
      const drained = runPowerTicks(modules, ticks as number);
      let updatedModules = drained.modules;
      let solar = null;

      if (getTotalCurrentPowerGenerationKw(updatedModules) > 0) {
        const snapshot = await getPowerSnapshot(cwd);
        if (snapshot.solarIrradiance) {
          solar = applySolarGeneration(updatedModules, ticks as number, snapshot.solarIrradiance);
          updatedModules = solar.modules;
        }
      }

      writeModules(updatedModules, cwd);
      const power = await getPowerSnapshot(cwd);
      logHabitatApi(c.req.method, "/tick", `advanced ${ticks} ticks`);
      return c.json({ ticksExecuted: ticks, power, solar });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 409);
    }
  });

  app.get("/humans", (c) => {
    const humans = readHabitatHumans(options.cwd ?? process.cwd());
    logHabitatApi(c.req.method, "/humans", `${humans.length} humans`);
    return c.json<BackendHumansResponse>({ humans });
  });

  app.put("/humans/:humanId", async (c) => {
    const humanId = c.req.param("humanId");
    const parsed = (await c.req.json()) as { locationModuleId?: string } | null;

    if (!parsed?.locationModuleId) {
      return jsonError("Provide a destination module ID.");
    }

    try {
      const human = moveHabitatHuman(
        humanId,
        parsed.locationModuleId,
        options.cwd ?? process.cwd(),
      );
      logHabitatApi(c.req.method, `/humans/${humanId}`, `moved to ${human.locationModuleId}`);
      return c.json<{ human: HabitatHuman }>({ human });
    } catch (error) {
      if (error instanceof HumanMoveError) {
        return jsonError(error.message, error.status);
      }
      throw error;
    }
  });

  app.get("/exploration", (c) => {
    const exploration = readExplorationState(options.cwd ?? process.cwd());
    logHabitatApi(c.req.method, "/exploration", formatExplorationStatus(exploration).split("\n")[0]);
    return c.json<BackendExplorationResponse>({ exploration });
  });

  app.post("/exploration/deploy", async (c) => {
    const parsed = (await c.req.json()) as { humanId?: string } | null;
    if (!parsed?.humanId) return jsonError("Provide a human ID.");
    try {
      const exploration = deployExplorer(parsed.humanId, options.cwd ?? process.cwd());
      return c.json<BackendExplorationResponse>({ exploration });
    } catch (error) {
      if (error instanceof ExplorationError) return jsonError(error.message, error.status);
      throw error;
    }
  });

  app.post("/exploration/move", async (c) => {
    const parsed = (await c.req.json()) as { x?: number; y?: number } | null;
    if (parsed?.x === undefined || parsed.y === undefined) return jsonError("Provide x and y coordinates.");
    try {
      const exploration = moveExplorer(parsed.x, parsed.y, options.cwd ?? process.cwd());
      return c.json<BackendExplorationResponse>({ exploration });
    } catch (error) {
      if (error instanceof ExplorationError) return jsonError(error.message, error.status);
      throw error;
    }
  });

  app.post("/exploration/dock", (c) => {
    try {
      const exploration = dockExplorer(options.cwd ?? process.cwd());
      return c.json<BackendExplorationResponse>({ exploration });
    } catch (error) {
      if (error instanceof ExplorationError) return jsonError(error.message, error.status);
      throw error;
    }
  });

  app.post("/collection", async (c) => {
    const parsed = (await c.req.json()) as { quantityKg?: number } | null;
    if (parsed?.quantityKg === undefined) return jsonError("Provide quantityKg.");

    try {
      const { state, habitatId } = validateCollection(parsed.quantityKg, options.cwd ?? process.cwd());
      let response: WorldCollectionResponse;
      try {
        response = await proxyKeplerJson<WorldCollectionResponse>(
        "POST",
        "/world/collect",
        "/world/collect",
        options,
        true,
        { habitatId, x: state.x, y: state.y, quantityKg: parsed.quantityKg },
        );
      } catch (error) {
        if (error instanceof Response) observeAlert("collection-failed", { message: "A validated collection attempt failed.", severity: "warning", source: "habitat.collection", subject: { humanId: state.deployedHumanId ?? undefined } }, options.cwd ?? process.cwd());
        throw error;
      }
      const exploration = persistCollection(state, response.collection, options.cwd ?? process.cwd());
      return c.json({ collection: response.collection, exploration });
    } catch (error) {
      if (error instanceof ExplorationError) return jsonError(error.message, error.status);
      if (error instanceof Response) return error;
      throw error;
    }
  });

  app.get("/alerts", (c) => c.json({ alerts: listAlerts(options.cwd ?? process.cwd()) }));
  app.post("/alerts/:alertId/acknowledge", (c) => {
    try { return c.json({ alert: acknowledgeAlert(c.req.param("alertId"), options.cwd ?? process.cwd()) }); }
    catch (error) { return jsonError(error instanceof Error ? error.message : String(error), 404); }
  });

  app.get("/modules/:moduleId", (c) => {
    const moduleId = c.req.param("moduleId");
    const modules = readModules(options.cwd ?? process.cwd());
    const module = modules.find(
      (item) => item.id === moduleId || item.alias === moduleId,
    );

    if (!module) {
      logHabitatApi(
        c.req.method,
        `/modules/${moduleId}`,
        `module "${moduleId}" not found`,
      );
      return jsonError(`Module "${moduleId}" was not found.`, 404);
    }

    logHabitatApi(c.req.method, `/modules/${moduleId}`, `found module "${module.id}"`);
    return c.json<BackendModuleResponse>({ module });
  });

  app.post("/modules", async (c) => {
    const parsed = (await c.req.json()) as { module?: HabitatModule } | null;
    const module = parsed?.module;

    if (!module) {
      logHabitatApi(c.req.method, "/modules", "missing module payload");
      return jsonError("Provide a module payload.");
    }

    const modules = readModules(options.cwd ?? process.cwd());

    if (
      findModuleIndex(modules, module.id) !== -1 ||
      findModuleIndex(modules, module.alias) !== -1
    ) {
      logHabitatApi(
        c.req.method,
        "/modules",
        `module "${module.id}" already exists`,
      );
      return jsonError(`Module "${module.id}" already exists.`, 409);
    }

    writeModules([...modules, module], options.cwd ?? process.cwd());
    logHabitatApi(c.req.method, "/modules", `created module "${module.id}"`);
    return c.json<BackendModuleResponse>({ module }, 201);
  });

  app.put("/modules", async (c) => {
    const parsed = (await c.req.json()) as { modules?: HabitatModule[] } | null;
    const modules = parsed?.modules;

    if (!modules) {
      logHabitatApi(c.req.method, "/modules", "missing modules payload");
      return jsonError("Provide a modules payload.");
    }

    writeModules(modules, options.cwd ?? process.cwd());
    logHabitatApi(c.req.method, "/modules", summarizeModulesReplaced(modules));
    return c.json<BackendModulesResponse>({ modules });
  });

  app.put("/modules/:moduleId", async (c) => {
    const moduleId = c.req.param("moduleId");
    const parsed = (await c.req.json()) as { module?: HabitatModule } | null;
    const module = parsed?.module;

    if (!module) {
      logHabitatApi(
        c.req.method,
        `/modules/${moduleId}`,
        "missing module payload",
      );
      return jsonError("Provide a module payload.");
    }

    const modules = readModules(options.cwd ?? process.cwd());
    const moduleIndex = findModuleIndex(modules, moduleId);

    if (moduleIndex === -1) {
      logHabitatApi(
        c.req.method,
        `/modules/${moduleId}`,
        `module "${moduleId}" was not found`,
      );
      return jsonError(`Module "${moduleId}" was not found.`, 404);
    }

    modules[moduleIndex] = module;
    writeModules(modules, options.cwd ?? process.cwd());
    logHabitatApi(
      c.req.method,
      `/modules/${moduleId}`,
      `updated module "${module.id}"`,
    );
    return c.json<BackendModuleResponse>({ module });
  });

  app.delete("/modules/:moduleId", (c) => {
    const moduleId = c.req.param("moduleId");
    const modules = readModules(options.cwd ?? process.cwd());
    const moduleIndex = findModuleIndex(modules, moduleId);

    if (moduleIndex === -1) {
      logHabitatApi(
        c.req.method,
        `/modules/${moduleId}`,
        `module "${moduleId}" was not found`,
      );
      return jsonError(`Module "${moduleId}" was not found.`, 404);
    }

    const occupied = readHabitatHumans(options.cwd ?? process.cwd()).some(
      (human) => human.locationModuleId === modules[moduleIndex].id,
    );

    if (occupied) {
      logHabitatApi(
        c.req.method,
        `/modules/${moduleId}`,
        `module "${modules[moduleIndex].id}" is occupied`,
      );
      return jsonError(
        `Module "${modules[moduleIndex].id}" cannot be deleted while a human is inside it.`,
        409,
      );
    }

    modules.splice(moduleIndex, 1);
    writeModules(modules, options.cwd ?? process.cwd());
    logHabitatApi(c.req.method, `/modules/${moduleId}`, `deleted module "${moduleId}"`);
    return c.body(null, 204);
  });

  app.get("/inventory", (c) => {
    const modules = readModules(options.cwd ?? process.cwd());
    const { inventory } = readSupplyCacheInventory(modules);

    logHabitatApi(c.req.method, "/inventory", summarizeInventory(inventory));
    return c.json<BackendInventoryResponse>({ inventory });
  });

  app.put("/inventory", async (c) => {
    const parsed = (await c.req.json()) as { inventory?: HabitatInventory } | null;
    const inventory = parsed?.inventory;

    if (!inventory) {
      logHabitatApi(c.req.method, "/inventory", "missing inventory payload");
      return jsonError("Provide an inventory payload.");
    }

    const modules = readModules(options.cwd ?? process.cwd());
    const updatedModules = writeSupplyCacheInventory(modules, inventory);
    writeModules(updatedModules, options.cwd ?? process.cwd());

    logHabitatApi(c.req.method, "/inventory", summarizeInventory(inventory));
    return c.json<BackendInventoryResponse>({ inventory });
  });

  app.get("/catalog/blueprints", async (c) => {
    logHabitatApi(c.req.method, "/catalog/blueprints", "proxied to Kepler");

    try {
      const response = await proxyKeplerJson<{ blueprints: BlueprintDetail[] }>(
        "GET",
        "/catalog/blueprints",
        "/catalog/blueprints",
        options,
      );
      return c.json(response);
    } catch (error) {
      if (error instanceof Response) {
        return new Response(await error.text(), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw error;
    }
  });

  app.get("/catalog/blueprints/:blueprintId", async (c) => {
    const blueprintId = c.req.param("blueprintId");
    logHabitatApi(
      c.req.method,
      `/catalog/blueprints/${blueprintId}`,
      "proxied to Kepler",
    );

    try {
      const response = await proxyKeplerJson<{ blueprint: BlueprintDetail }>(
        "GET",
        `/catalog/blueprints/${encodeURIComponent(blueprintId)}`,
        `/catalog/blueprints/${encodeURIComponent(blueprintId)}`,
        options,
      );
      return c.json(response);
    } catch (error) {
      if (error instanceof Response) {
        return new Response(await error.text(), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw error;
    }
  });

  app.get("/catalog/resources", async (c) => {
    logHabitatApi(c.req.method, "/catalog/resources", "proxied to Kepler");

    try {
      const response = await proxyKeplerJson<{ resources: ResourceSummary[] }>(
        "GET",
        "/catalog/resources",
        "/catalog/resources",
        options,
      );
      return c.json(response);
    } catch (error) {
      if (error instanceof Response) {
        return new Response(await error.text(), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw error;
    }
  });

  app.get("/world/scan", async (c) => {
    const query = c.req.query();
    const registration = readRegistration(options.cwd ?? process.cwd());
    const exploration = readExplorationState(options.cwd ?? process.cwd());

    if (!registration) {
      logHabitatApi(c.req.method, "/world/scan", "not registered");
      return jsonError("No local registration found.", 404);
    }

    let sensorStrength: number;
    let radiusTiles: number;

    try {
      sensorStrength = parseScanInteger(
        query.sensorStrength,
        "sensorStrength",
        0,
        100,
      );
      radiusTiles = parseScanInteger(query.radiusTiles, "radiusTiles", 0, 5);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logHabitatApi(c.req.method, "/world/scan", `invalid parameters: ${message}`);
      return jsonError(message);
    }

    if (!exploration.deployedHumanId) {
      logHabitatApi(c.req.method, "/world/scan", "no explorer deployed");
      return jsonError("No human is deployed. Deploy a human before scanning.", 409);
    }

    const keplerQuery = new URLSearchParams({
      habitatId: registration.habitatId,
      x: String(exploration.x),
      y: String(exploration.y),
      sensorStrength: String(sensorStrength),
      radiusTiles: String(radiusTiles),
    });

    logHabitatApi(c.req.method, "/world/scan", "proxied to Kepler");

    try {
      const response = await proxyKeplerJson<unknown>(
        "GET",
        `/world/scan?${keplerQuery.toString()}`,
        "/world/scan",
        options,
      );
      return c.json(response);
    } catch (error) {
      if (error instanceof Response) {
        return new Response(await error.text(), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw error;
    }
  });

  app.get("/solar/irradiance", async (c) => {
    logHabitatApi(c.req.method, "/solar/irradiance", "proxied to Kepler");

    try {
      const response = await proxyKeplerJson<{ solarIrradiance: SolarIrradiance }>(
        "GET",
        "/world/solar-irradiance",
        "/world/solar-irradiance",
        options,
        false,
      );
      return c.json(response);
    } catch (error) {
      if (error instanceof Response) {
        return new Response(await error.text(), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw error;
    }
  });

  return app;
}

export const app = createBackendApp();

if (import.meta.main) {
  const port = getListenPort();

  Bun.serve({
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port,
  });

  console.log(`Hono backend listening on http://0.0.0.0:${port}`);
}
