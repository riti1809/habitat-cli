import { requestJson } from "./api-client";

export type ResourceSummary = {
  id: string;
  resourceType: string;
  displayName: string;
  kind: string;
  rarity: string;
  description?: string;
  unit?: string;
};

type ResourceCatalogResponse = {
  resources: ResourceSummary[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResourceSummary(value: unknown): value is ResourceSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.resourceType === "string" &&
    typeof value.displayName === "string" &&
    typeof value.kind === "string" &&
    typeof value.rarity === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.unit === undefined || typeof value.unit === "string")
  );
}

function isResourceCatalogResponse(value: unknown): value is ResourceCatalogResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.resources) &&
    value.resources.every(isResourceSummary)
  );
}

export async function listResources() {
  const parsed = (await requestJson<unknown>("/catalog/resources")) as unknown;

  if (!isResourceCatalogResponse(parsed)) {
    throw new Error("Kepler returned an unexpected resource catalog response.");
  }

  return parsed.resources;
}
