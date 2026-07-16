import { requestJson } from "./api-client";
import type { HabitatInventory } from "./habitat-inventory";
import type { HabitatModule } from "./habitat-store";
import type { StoredRegistration } from "./habitat-store";
import type { StarterHuman } from "./habitat-store";
import { parseWorldScanResponse, type WorldScanResponse } from "./world-scan";
import type { ExplorationState } from "./exploration";
import type { WorldCollection } from "./collection";
import type { HabitatAlert } from "./alerts";

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

type HumansResponse = {
  humans: StarterHuman[];
};

export async function listModules() {
  const response = await requestJson<ModulesResponse>("/modules");
  return response.modules;
}

export async function listHumans() {
  const response = await requestJson<HumansResponse>("/humans");
  return response.humans;
}

export async function moveHuman(humanId: string, moduleId: string) {
  const response = await requestJson<{ human: StarterHuman }>(
    `/humans/${encodeURIComponent(humanId)}`,
    {
      method: "PUT",
      body: {
        locationModuleId: moduleId,
      },
    },
  );
  return response.human;
}

export async function getExplorationState() {
  const response = await requestJson<{ exploration: ExplorationState }>("/exploration");
  return response.exploration;
}

export async function deployExplorer(humanId: string) {
  const response = await requestJson<{ exploration: ExplorationState }>("/exploration/deploy", {
    method: "POST", body: { humanId },
  });
  return response.exploration;
}

export async function moveExplorer(x: number, y: number) {
  const response = await requestJson<{ exploration: ExplorationState }>("/exploration/move", {
    method: "POST", body: { x, y },
  });
  return response.exploration;
}

export async function dockExplorer() {
  const response = await requestJson<{ exploration: ExplorationState }>("/exploration/dock", {
    method: "POST",
  });
  return response.exploration;
}

export async function collectResource(quantityKg: number) {
  return requestJson<{ collection: WorldCollection; exploration: ExplorationState }>("/collection", {
    method: "POST",
    body: { quantityKg },
  });
}

export async function listAlerts() {
  return (await requestJson<{ alerts: HabitatAlert[] }>("/alerts")).alerts;
}

export async function acknowledgeAlert(alertId: string) {
  return (await requestJson<{ alert: HabitatAlert }>(`/alerts/${encodeURIComponent(alertId)}/acknowledge`, { method: "POST" })).alert;
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
  sensorStrength: number,
  radiusTiles = 0,
) {
  const query = new URLSearchParams({
    sensorStrength: String(sensorStrength),
    radiusTiles: String(radiusTiles),
  });
  return parseWorldScanResponse(
    await requestJson<WorldScanResponse>(`/world/scan?${query.toString()}`),
  );
}
