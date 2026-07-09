export type SolarCondition = "clear" | "dust" | "storm" | "night";

export type SolarIrradiance = {
  wPerM2: number;
  condition: SolarCondition;
};

type SolarIrradianceResponse = {
  solarIrradiance: SolarIrradiance;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSolarCondition(value: unknown): value is SolarCondition {
  return (
    value === "clear" ||
    value === "dust" ||
    value === "storm" ||
    value === "night"
  );
}

function isSolarIrradiance(value: unknown): value is SolarIrradiance {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.wPerM2 === "number" &&
    isSolarCondition(value.condition)
  );
}

function isSolarIrradianceResponse(value: unknown): value is SolarIrradianceResponse {
  return isRecord(value) && isSolarIrradiance(value.solarIrradiance);
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

async function keplerRequest(path: string, init: RequestInit = {}, baseUrl = getBaseUrl()) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  return response;
}

export async function getSolarIrradiance(baseUrl = getBaseUrl()) {
  const response = await keplerRequest("/world/solar-irradiance", {}, baseUrl);

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const parsed = (await response.json()) as unknown;

  if (!isSolarIrradianceResponse(parsed)) {
    throw new Error("Kepler returned an unexpected solar irradiance response.");
  }

  return parsed.solarIrradiance;
}
