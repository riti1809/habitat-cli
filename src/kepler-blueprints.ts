import { ApiClientError, requestJson } from "./api-client";

export type BlueprintSummary = {
  id: string;
  blueprintId: string;
  displayName: string;
  buildTicks?: number;
  repeatable?: boolean;
};

export type BlueprintDetail = BlueprintSummary & {
  description?: string;
  output?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  requiredFacility?: Record<string, unknown>;
  prerequisites?: string[];
  unlocks?: string[];
  capabilities?: string[];
  runtimeAttributes?: Record<string, unknown>;
};

type BlueprintCatalogResponse = {
  blueprints: BlueprintDetail[];
};

type BlueprintResponse = {
  blueprint: BlueprintDetail;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBlueprintDetail(value: unknown): value is BlueprintDetail {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.blueprintId === "string" &&
    typeof value.displayName === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.output === undefined || isRecord(value.output)) &&
    (value.inputs === undefined || isRecord(value.inputs)) &&
    (value.requiredFacility === undefined || isRecord(value.requiredFacility)) &&
    (value.prerequisites === undefined || isStringArray(value.prerequisites)) &&
    (value.unlocks === undefined || isStringArray(value.unlocks)) &&
    (value.capabilities === undefined || isStringArray(value.capabilities)) &&
    (value.buildTicks === undefined || typeof value.buildTicks === "number") &&
    (value.repeatable === undefined || typeof value.repeatable === "boolean")
  );
}

function isBlueprintCatalogResponse(value: unknown): value is BlueprintCatalogResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.blueprints) &&
    value.blueprints.every(isBlueprintDetail)
  );
}

function isBlueprintResponse(value: unknown): value is BlueprintResponse {
  return isRecord(value) && isBlueprintDetail(value.blueprint);
}

export async function listBlueprints() {
  const parsed = (await requestJson<unknown>("/catalog/blueprints")) as unknown;

  if (!isBlueprintCatalogResponse(parsed)) {
    throw new Error("Kepler returned an unexpected blueprint catalog response.");
  }

  return parsed.blueprints;
}

export async function getBlueprint(
  blueprintId: string,
) {
  let parsed: unknown;

  try {
    parsed = await requestJson<unknown>(
      `/catalog/blueprints/${encodeURIComponent(blueprintId)}`,
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      throw new Error(`Blueprint "${blueprintId}" was not found.`);
    }

    throw error;
  }

  if (!isBlueprintResponse(parsed)) {
    throw new Error("Kepler returned an unexpected blueprint response.");
  }

  return parsed.blueprint;
}
