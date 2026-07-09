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

type KeplerErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
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
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      Accept: "application/json",
      ...init.headers,
    },
  });

  return response;
}

export async function listBlueprints(baseUrl = getBaseUrl()) {
  const response = await keplerRequest("/catalog/blueprints", {}, baseUrl);

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const parsed = (await response.json()) as unknown;

  if (!isBlueprintCatalogResponse(parsed)) {
    throw new Error("Kepler returned an unexpected blueprint catalog response.");
  }

  return parsed.blueprints;
}

export async function getBlueprint(
  blueprintId: string,
  baseUrl = getBaseUrl(),
) {
  const response = await keplerRequest(
    `/catalog/blueprints/${encodeURIComponent(blueprintId)}`,
    {},
    baseUrl,
  );

  if (response.status === 404) {
    throw new Error(`Blueprint "${blueprintId}" was not found.`);
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const parsed = (await response.json()) as unknown;

  if (!isBlueprintResponse(parsed)) {
    throw new Error("Kepler returned an unexpected blueprint response.");
  }

  return parsed.blueprint;
}
