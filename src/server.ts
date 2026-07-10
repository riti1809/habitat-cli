import { Hono } from "hono";

import { ApiClientError, requestJsonWithStatus } from "./api-client";
import {
  readModules,
  readRegistration,
  type HabitatModule,
  type StoredRegistration,
  writeModules,
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

function toRegistrationView(
  registration: StoredRegistration,
  apiToken: string,
): BackendRegistrationView {
  return {
    habitatUuid: registration.habitatUuid,
    habitatId: registration.habitatId,
    displayName: registration.displayName,
    apiToken,
  };
}

function getListenHost() {
  return process.env.HABITAT_API_HOST ?? "127.0.0.1";
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
      registration: toRegistrationView(registration, apiToken),
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
  const host = getListenHost();
  const port = getListenPort();

  Bun.serve({
    fetch: app.fetch,
    hostname: host,
    port,
  });

  console.log(`Hono backend listening on http://${host}:${port}`);
}
