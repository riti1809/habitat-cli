import { randomUUID } from "node:crypto";

import { Hono } from "hono";

import { ApiClientError, requestJson, requestJsonWithStatus } from "./api-client";
import {
  deleteModules,
  deleteRegistration,
  hydrateModulesFromStarterModules,
  readModules,
  readRegistration,
  type HabitatModule,
  type StoredRegistration,
  writeModules,
  writeRegistration,
} from "./habitat-store";
import type { BlueprintDetail } from "./kepler-blueprints";
import type { ResourceSummary } from "./kepler-resources";
import {
  readSupplyCacheInventory,
  type HabitatInventory,
  writeSupplyCacheInventory,
} from "./habitat-inventory";
import type { SolarIrradiance } from "./kepler-solar";

export type BackendRegistrationView = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  baseUrl: string;
  registeredAt: string;
  starterModules: StoredRegistration["starterModules"];
  blueprints: StoredRegistration["blueprints"];
  lastStatus?: StoredRegistration["lastStatus"];
  apiToken: string;
};

export type BackendRegistrationResponse = {
  registration: BackendRegistrationView | null;
};

export type BackendModulesResponse = {
  modules: HabitatModule[];
};

export type BackendModuleResponse = {
  module: HabitatModule;
};

export type BackendInventoryResponse = {
  inventory: HabitatInventory;
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
) {
  try {
    const response = await requestJsonWithStatus<TResponse>(path, {
      baseUrl: getKeplerBaseUrl(options),
      apiToken: requiresToken ? getKeplerToken(options) : undefined,
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

  app.post("/registration", async (c) => {
    const parsed = (await c.req.json()) as { displayName?: string } | null;
    const displayName = parsed?.displayName;

    if (!displayName) {
      logHabitatApi(c.req.method, "/registration", "missing registration payload");
      return jsonError("Provide a habitat display name.");
    }

    const cwd = options.cwd ?? process.cwd();
    const existingRegistration = readRegistration(cwd);

    if (existingRegistration) {
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

    const habitatUuid = randomUUID();
    const registrationResponse = await requestJsonWithStatus<{
      habitatId: string;
      starterModules: StoredRegistration["starterModules"];
      blueprints: StoredRegistration["blueprints"];
    }>("/habitats/register", {
      baseUrl: getKeplerBaseUrl(options),
      apiToken: getKeplerToken(options),
      method: "POST",
      body: {
        displayName,
        habitatUuid,
      },
    });

    const registration: StoredRegistration = {
      habitatUuid,
      habitatId: registrationResponse.data.habitatId,
      displayName,
      baseUrl: getKeplerBaseUrl(options),
      registeredAt: new Date().toISOString(),
      starterModules: registrationResponse.data.starterModules,
      blueprints: registrationResponse.data.blueprints,
    };

    writeRegistration(registration, cwd);
    writeModules(
      hydrateModulesFromStarterModules(registration.starterModules, registration.registeredAt),
      cwd,
    );

    logHabitatApi(c.req.method, "/registration", `registered habitat "${displayName}"`);
    return c.json<BackendRegistrationResponse>(
      {
        registration: {
          ...registration,
          apiToken,
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

    const apiToken = getApiToken(options);

    if (!apiToken) {
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
        apiToken,
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

    if (!registration) {
      logHabitatApi(c.req.method, "/world/scan", "not registered");
      return jsonError("No local registration found.", 404);
    }

    let x: number;
    let y: number;
    let sensorStrength: number;
    let radiusTiles: number;

    try {
      x = parseScanInteger(query.x, "x");
      y = parseScanInteger(query.y, "y");
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

    const keplerQuery = new URLSearchParams({
      habitatId: registration.habitatId,
      x: String(x),
      y: String(y),
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
