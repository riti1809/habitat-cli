import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Zone = {
  name: string;
  purpose: string;
  status: string;
};

export type Door = {
  name: string;
  status: string;
  locked: string;
};

export type Sensor = {
  name: string;
  purpose: string;
  status: string;
};

export type Rover = {
  name: string;
  purpose: string;
  status: string;
};

export type Greenhouse = {
  name: string;
  purpose: string;
  status: string;
};

export type Airlock = {
  name: string;
  pressureLevel: string;
  locked: string;
  doorNames: string[];
};

export type HabitatData = {
  zones: Zone[];
  doors: Door[];
  sensors: Sensor[];
  rovers: Rover[];
  greenhouses: Greenhouse[];
  airlocks: Airlock[];
};

const dataFilePath = join(process.cwd(), ".habitat", "data.json");

const emptyData: HabitatData = {
  zones: [],
  doors: [],
  sensors: [],
  rovers: [],
  greenhouses: [],
  airlocks: [],
};

function ensureDataFile() {
  const directoryPath = dirname(dataFilePath);

  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }

  if (!existsSync(dataFilePath)) {
    writeFileSync(dataFilePath, `${JSON.stringify(emptyData, null, 2)}\n`, "utf8");
  }
}

function isZone(value: unknown): value is Zone {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.name === "string" &&
    typeof record.purpose === "string" &&
    typeof record.status === "string"
  );
}

function isDoor(value: unknown): value is Door {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.name === "string" &&
    typeof record.status === "string" &&
    typeof record.locked === "string"
  );
}

function isAirlock(value: unknown): value is Airlock {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.name === "string" &&
    typeof record.pressureLevel === "string" &&
    typeof record.locked === "string" &&
    Array.isArray(record.doorNames) &&
    record.doorNames.every((doorName: unknown) => typeof doorName === "string")
  );
}

function isSensor(value: unknown): value is Sensor {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.name === "string" &&
    typeof record.purpose === "string" &&
    typeof record.status === "string"
  );
}

function isRover(value: unknown): value is Rover {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.name === "string" &&
    typeof record.purpose === "string" &&
    typeof record.status === "string"
  );
}

function isGreenhouse(value: unknown): value is Greenhouse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.name === "string" &&
    typeof record.purpose === "string" &&
    typeof record.status === "string"
  );
}

export function getDataFilePath() {
  return dataFilePath;
}

export function readData(): HabitatData {
  ensureDataFile();

  const fileContents = readFileSync(dataFilePath, "utf8");
  const parsed = JSON.parse(fileContents) as unknown;

  if (typeof parsed !== "object" || parsed === null) {
    return { ...emptyData };
  }

  const record = parsed as Record<string, unknown>;

  return {
    zones: Array.isArray(record.zones) ? record.zones.filter(isZone) : [],
    doors: Array.isArray(record.doors) ? record.doors.filter(isDoor) : [],
    sensors: Array.isArray(record.sensors) ? record.sensors.filter(isSensor) : [],
    rovers: Array.isArray(record.rovers) ? record.rovers.filter(isRover) : [],
    greenhouses: Array.isArray(record.greenhouses)
      ? record.greenhouses.filter(isGreenhouse)
      : [],
    airlocks: Array.isArray(record.airlocks)
      ? record.airlocks.filter(isAirlock)
      : [],
  };
}

export function writeData(data: HabitatData) {
  ensureDataFile();
  writeFileSync(dataFilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
