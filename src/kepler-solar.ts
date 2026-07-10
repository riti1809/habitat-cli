import { requestJson } from "./api-client";

export type SolarCondition = "clear" | "dust" | "storm" | "night";

export type SolarIrradiance = {
  wPerM2: number;
  condition: SolarCondition;
};

type SolarIrradianceResponse = {
  solarIrradiance: SolarIrradiance;
};

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

export async function getSolarIrradiance() {
  const parsed = (await requestJson<unknown>("/solar/irradiance")) as unknown;

  if (!isSolarIrradianceResponse(parsed)) {
    throw new Error("Kepler returned an unexpected solar irradiance response.");
  }

  return parsed.solarIrradiance;
}
