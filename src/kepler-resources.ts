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

export async function listResources(baseUrl = getBaseUrl()) {
  const response = await keplerRequest("/catalog/resources", {}, baseUrl);

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const parsed = (await response.json()) as unknown;

  if (!isResourceCatalogResponse(parsed)) {
    throw new Error("Kepler returned an unexpected resource catalog response.");
  }

  return parsed.resources;
}
