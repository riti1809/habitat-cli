import { requestJson } from "./api-client";
import type { HabitatInventory } from "./habitat-inventory";
import type { HabitatModule } from "./habitat-store";
import type { StoredRegistration } from "./habitat-store";
import type { WorldScanResponse } from "./world-scan";

type ModulesResponse = {
  modules: HabitatModule[];
};

type ModuleResponse = {
  module: HabitatModule;
};

type InventoryResponse = {
  inventory: HabitatInventory;
};

type RegistrationResponse = {
  registration: (StoredRegistration & { apiToken: string }) | null;
};

type ModulesReplaceResponse = {
  modules: HabitatModule[];
};

export async function listModules() {
  const response = await requestJson<ModulesResponse>("/modules");
  return response.modules;
}

export async function getRegistration() {
  const response = await requestJson<RegistrationResponse>("/registration");
  return response.registration;
}

export async function registerHabitat(displayName: string) {
  const response = await requestJson<RegistrationResponse>("/registration", {
    method: "POST",
    body: {
      displayName,
    },
  });

  return response.registration;
}

export async function unregisterHabitat() {
  await requestJson<void>("/registration", {
    method: "DELETE",
  });
}

export async function getModule(moduleId: string) {
  const response = await requestJson<ModuleResponse>(
    `/modules/${encodeURIComponent(moduleId)}`,
  );

  return response.module;
}

export async function createModule(module: HabitatModule) {
  const response = await requestJson<ModuleResponse>("/modules", {
    method: "POST",
    body: {
      module,
    },
  });

  return response.module;
}

export async function updateModule(moduleId: string, module: HabitatModule) {
  const response = await requestJson<ModuleResponse>(
    `/modules/${encodeURIComponent(moduleId)}`,
    {
      method: "PUT",
      body: {
        module,
      },
    },
  );

  return response.module;
}

export async function deleteModule(moduleId: string) {
  await requestJson<void>(`/modules/${encodeURIComponent(moduleId)}`, {
    method: "DELETE",
  });
}

export async function replaceModules(modules: HabitatModule[]) {
  const response = await requestJson<ModulesReplaceResponse>("/modules", {
    method: "PUT",
    body: {
      modules,
    },
  });

  return response.modules;
}

export async function getInventory() {
  const response = await requestJson<InventoryResponse>("/inventory");
  return response.inventory;
}

export async function setInventory(inventory: HabitatInventory) {
  const response = await requestJson<InventoryResponse>("/inventory", {
    method: "PUT",
    body: {
      inventory,
    },
  });

  return response.inventory;
}

export async function scanWorld(
  x: number,
  y: number,
  sensorStrength: number,
  radiusTiles = 0,
) {
  const query = new URLSearchParams({
    x: String(x),
    y: String(y),
    sensorStrength: String(sensorStrength),
    radiusTiles: String(radiusTiles),
  });
  return requestJson<WorldScanResponse>(`/world/scan?${query.toString()}`);
}
