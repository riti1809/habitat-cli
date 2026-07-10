import { requestJson } from "./api-client";
import type { HabitatInventory } from "./habitat-inventory";
import type { HabitatModule } from "./habitat-store";

type ModulesResponse = {
  modules: HabitatModule[];
};

type ModuleResponse = {
  module: HabitatModule;
};

type InventoryResponse = {
  inventory: HabitatInventory;
};

export async function listModules() {
  const response = await requestJson<ModulesResponse>("/modules");
  return response.modules;
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
