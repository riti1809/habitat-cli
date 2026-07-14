export type WorldScanProbability = {
  resourceType: string | null;
  probabilityPct: number;
};

export type WorldScanQuantityEstimate = {
  resourceType: string;
  unit: "kg";
  estimatedKg: number;
  minimumKg: number;
  maximumKg: number;
  exact: boolean;
};

export type WorldScanTile = {
  x: number;
  y: number;
  terrain: string;
  distanceTiles: number;
  probabilities: WorldScanProbability[];
  topCandidate: WorldScanProbability;
  quantityEstimate: WorldScanQuantityEstimate | null;
};

export type WorldScanResponse = {
  scan: {
    modelVersion: string;
    origin: { x: number; y: number };
    sensorStrength: number;
    radiusTiles: number;
    tiles: WorldScanTile[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProbability(value: unknown): value is WorldScanProbability {
  return (
    isRecord(value) &&
    (typeof value.resourceType === "string" || value.resourceType === null) &&
    typeof value.probabilityPct === "number"
  );
}

function isQuantityEstimate(value: unknown): value is WorldScanQuantityEstimate {
  return (
    isRecord(value) &&
    typeof value.resourceType === "string" &&
    value.unit === "kg" &&
    typeof value.estimatedKg === "number" &&
    typeof value.minimumKg === "number" &&
    typeof value.maximumKg === "number" &&
    typeof value.exact === "boolean"
  );
}

function isTile(value: unknown): value is WorldScanTile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.terrain === "string" &&
    typeof value.distanceTiles === "number" &&
    Array.isArray(value.probabilities) &&
    value.probabilities.every(isProbability) &&
    isProbability(value.topCandidate) &&
    (value.quantityEstimate === null || isQuantityEstimate(value.quantityEstimate))
  );
}

export function isWorldScanResponse(value: unknown): value is WorldScanResponse {
  if (!isRecord(value) || !isRecord(value.scan)) {
    return false;
  }

  const scan = value.scan;
  return (
    typeof scan.modelVersion === "string" &&
    isRecord(scan.origin) &&
    typeof scan.origin.x === "number" &&
    typeof scan.origin.y === "number" &&
    typeof scan.sensorStrength === "number" &&
    typeof scan.radiusTiles === "number" &&
    Array.isArray(scan.tiles) &&
    scan.tiles.every(isTile)
  );
}

export function parseWorldScanResponse(value: unknown): WorldScanResponse {
  if (!isWorldScanResponse(value)) {
    throw new Error("Kepler returned an unexpected world scan response.");
  }

  return value;
}

function formatCandidate(candidate: WorldScanProbability) {
  return candidate.resourceType ?? "none";
}

function formatQuantity(quantity: WorldScanQuantityEstimate | null) {
  if (!quantity) {
    return "-";
  }

  const range = quantity.exact
    ? `${quantity.estimatedKg} kg exact`
    : `${quantity.estimatedKg} kg (${quantity.minimumKg}-${quantity.maximumKg} kg)`;
  return `${quantity.resourceType}: ${range}`;
}

function formatOneTile(tile: WorldScanTile) {
  const probabilityRows = tile.probabilities.map((probability) =>
    `${formatCandidate(probability).padEnd(18)} ${probability.probabilityPct.toFixed(2).padStart(8)}%`,
  );

  return [
    `Tile: (${tile.x}, ${tile.y})`,
    `Distance: ${tile.distanceTiles}`,
    `Terrain: ${tile.terrain}`,
    "",
    "Resource           Probability",
    "------------------  -----------",
    ...probabilityRows,
    "",
    `Top candidate: ${formatCandidate(tile.topCandidate)} (${tile.topCandidate.probabilityPct.toFixed(2)}%)`,
    `Quantity estimate: ${formatQuantity(tile.quantityEstimate)}`,
  ].join("\n");
}

function formatTileSummary(tile: WorldScanTile) {
  const candidate = formatCandidate(tile.topCandidate);
  const confidence = `${tile.topCandidate.probabilityPct.toFixed(2)}%`;
  return `${String(tile.x).padStart(3)} ${String(tile.y).padStart(3)}  ${tile.distanceTiles.toFixed(3).padStart(8)}  ${tile.terrain.padEnd(8)}  ${candidate.padEnd(18)}  ${confidence.padStart(10)}  ${formatQuantity(tile.quantityEstimate)}`;
}

function formatMultipleTiles(tiles: WorldScanTile[]) {
  return [
    "  X   Y  Distance  Terrain   Top Candidate       Confidence  Estimated Quantity",
    "---  ---  --------  --------  ------------------  ----------  ------------------",
    ...tiles.map(formatTileSummary),
  ].join("\n");
}

export function formatWorldScan(value: unknown) {
  const parsed = parseWorldScanResponse(value);
  const { scan } = parsed;
  const header = [
    `Scan origin: (${scan.origin.x}, ${scan.origin.y})`,
    `Sensor strength: ${scan.sensorStrength}`,
    `Radius: ${scan.radiusTiles}`,
    `Tiles: ${scan.tiles.length}`,
  ];

  return [
    ...header,
    "",
    scan.tiles.length === 1
      ? formatOneTile(scan.tiles[0])
      : formatMultipleTiles(scan.tiles),
  ].join("\n");
}

export function formatWorldScanJson(value: unknown) {
  return JSON.stringify(parseWorldScanResponse(value), null, 2);
}
