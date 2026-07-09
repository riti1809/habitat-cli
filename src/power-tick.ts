import type { SolarIrradiance } from "./kepler-solar";
import type { HabitatModule } from "./habitat-store";

export type PowerTickResult = {
  modules: HabitatModule[];
  ticksExecuted: number;
  totalPowerDemandKw: number;
  energyConsumedKwh: number;
  batteryEnergyBeforeKwh: number;
  batteryEnergyAfterKwh: number;
  updatedBatteryCount: number;
};

export type SolarGenerationResult = {
  modules: HabitatModule[];
  solarIrradianceWPerM2: number;
  solarMultiplier: number;
  solarEfficiency: number;
  effectiveGenerationKw: number;
  generatedKwhPerTick: number;
  grossGeneratedKwh: number;
  batteryHeadroomKwh: number;
  batteryEnergyBeforeKwh: number;
  batteryEnergyAfterKwh: number;
  storedKwh: number;
  updatedBatteryCount: number;
  noChargingReason?: string;
};

type RunPowerTicksOptions = {
  now?: string;
};

type ModulePowerStatus = {
  moduleName: string;
  declaredState: string;
  effectiveState: string;
  powerDrawKw: number;
};

const BATTERY_MODULE_TYPE = "basic-battery";
const SOLAR_REFERENCE_IRRADIANCE_W_PER_M2 = 900;
const SOLAR_EFFICIENCY = 0.5;

function getRuntimeNumber(
  module: HabitatModule,
  key: string,
): number | undefined {
  const value = module.runtimeAttributes[key];
  return typeof value === "number" ? value : undefined;
}

function getRuntimeStatus(module: HabitatModule): string | undefined {
  const value = module.runtimeAttributes.status;
  return typeof value === "string" ? value : undefined;
}

export function getCurrentModuleState(module: HabitatModule): string {
  return getRuntimeStatus(module) ?? "unknown";
}

export function getDeclaredModuleState(module: HabitatModule): string {
  return getRuntimeStatus(module) ?? "unknown";
}

export function getEffectiveModuleState(module: HabitatModule): string {
  if (module.constructionJob) {
    return "constructing";
  }

  return getCurrentModuleState(module);
}

export function getCurrentPowerDrawKw(module: HabitatModule): number {
  const status = getRuntimeStatus(module);

  if (!status) {
    return 0;
  }

  const powerDraw = module.runtimeAttributes.powerDrawKw;

  if (!powerDraw || typeof powerDraw !== "object") {
    return 0;
  }

  const drawByStatus = powerDraw as Record<string, unknown>;
  const draw = drawByStatus[status];
  return typeof draw === "number" ? draw : 0;
}

function getSolarGenerationKw(module: HabitatModule): number {
  const powerGenerationKw = getRuntimeNumber(module, "powerGenerationKw");

  if (powerGenerationKw !== undefined) {
    return powerGenerationKw;
  }

  const generationKw = getRuntimeNumber(module, "generationKw");

  if (generationKw !== undefined) {
    return generationKw;
  }

  const generation = getRuntimeNumber(module, "generation");
  return generation ?? 0;
}

function isSolarGenerationModule(module: HabitatModule) {
  if (module.constructionJob) {
    return false;
  }

  if (module.capabilities.includes("solar-generation")) {
    return true;
  }

  return getSolarGenerationKw(module) > 0;
}

function formatDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function getModulePowerStatuses(modules: HabitatModule[]): ModulePowerStatus[] {
  return modules.map((module) => ({
    moduleName: module.displayName,
    declaredState: getDeclaredModuleState(module),
    effectiveState: getEffectiveModuleState(module),
    powerDrawKw: getCurrentPowerDrawKw(module),
  }));
}

export function getTotalCurrentPowerDrawKw(modules: HabitatModule[]): number {
  return modules.reduce((total, module) => total + getCurrentPowerDrawKw(module), 0);
}

export function getOneTickEnergyCostKwh(modules: HabitatModule[]): number {
  return getTotalCurrentPowerDrawKw(modules) / 3600;
}

export function formatModulePowerStatusTable(modules: HabitatModule[]): string {
  const rows = getModulePowerStatuses(modules);
  const header = {
    moduleName: "Module",
    declaredState: "Declared",
    effectiveState: "Effective",
    powerDrawKw: "Power Draw (kW)",
  };

  const moduleWidth = Math.max(
    header.moduleName.length,
    ...rows.map((row) => row.moduleName.length),
  );
  const declaredWidth = Math.max(
    header.declaredState.length,
    ...rows.map((row) => row.declaredState.length),
  );
  const effectiveWidth = Math.max(
    header.effectiveState.length,
    ...rows.map((row) => row.effectiveState.length),
  );
  const drawWidth = Math.max(
    header.powerDrawKw.length,
    ...rows.map((row) => formatDecimal(row.powerDrawKw).length),
  );

  const lines = [
    `${header.moduleName.padEnd(moduleWidth)}  ${header.declaredState.padEnd(declaredWidth)}  ${header.effectiveState.padEnd(effectiveWidth)}  ${header.powerDrawKw.padStart(drawWidth)}`,
    `${"-".repeat(moduleWidth)}  ${"-".repeat(declaredWidth)}  ${"-".repeat(effectiveWidth)}  ${"-".repeat(drawWidth)}`,
    ...rows.map(
      (row) =>
        `${row.moduleName.padEnd(moduleWidth)}  ${row.declaredState.padEnd(declaredWidth)}  ${row.effectiveState.padEnd(effectiveWidth)}  ${formatDecimal(row.powerDrawKw).padStart(drawWidth)}`,
    ),
    "",
    `Total power draw: ${formatDecimal(getTotalCurrentPowerDrawKw(modules))} kW`,
    `One tick energy cost: ${getOneTickEnergyCostKwh(modules).toFixed(6)} kWh`,
  ];

  return lines.join("\n");
}

function isBatteryModule(module: HabitatModule) {
  return module.moduleType === BATTERY_MODULE_TYPE;
}

function isOnlineModule(module: HabitatModule) {
  return getRuntimeStatus(module) === "online";
}

function isOnlineBatteryModule(module: HabitatModule) {
  return isBatteryModule(module) && isOnlineModule(module);
}

function isOnlineSolarGenerationModule(module: HabitatModule) {
  return isSolarGenerationModule(module) && isOnlineModule(module);
}

function assertValidTickCount(ticks: number) {
  if (!Number.isInteger(ticks) || ticks <= 0) {
    throw new Error("Ticks must be a positive integer.");
  }
}

export function runPowerTicks(
  modules: HabitatModule[],
  ticks: number,
  options: RunPowerTicksOptions = {},
): PowerTickResult {
  assertValidTickCount(ticks);

  const totalPowerDemandKw = modules.reduce((total, module) => {
    if (isBatteryModule(module)) {
      return total;
    }

    return total + getCurrentPowerDrawKw(module);
  }, 0);

  const energyConsumedKwh = (totalPowerDemandKw * ticks) / 3600;

  const batteryModules = modules.filter(isBatteryModule);
  const batteryEnergyBeforeKwh = batteryModules.reduce(
    (total, module) => total + (getRuntimeNumber(module, "currentEnergyKwh") ?? 0),
    0,
  );

  if (batteryEnergyBeforeKwh < energyConsumedKwh) {
    if (batteryEnergyBeforeKwh === 0 && energyConsumedKwh > 0) {
      throw new Error(
        "No usable battery energy is available. Add or activate a battery before ticking.",
      );
    }

    throw new Error(
      `Insufficient battery energy. Required ${energyConsumedKwh} kWh but only ${batteryEnergyBeforeKwh} kWh is available.`,
    );
  }

  let remainingEnergyToDrainKwh = energyConsumedKwh;
  const now = options.now ?? new Date().toISOString();
  let updatedBatteryCount = 0;

  const updatedModules = modules.map((module) => {
    if (!isBatteryModule(module)) {
      return module;
    }

    const currentEnergyKwh = getRuntimeNumber(module, "currentEnergyKwh") ?? 0;
    const drainedEnergyKwh = Math.min(currentEnergyKwh, remainingEnergyToDrainKwh);

    if (drainedEnergyKwh === 0) {
      return module;
    }

    remainingEnergyToDrainKwh -= drainedEnergyKwh;
    updatedBatteryCount += 1;

    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        currentEnergyKwh: currentEnergyKwh - drainedEnergyKwh,
      },
      updatedAt: now,
    };
  });

  return {
    modules: updatedModules,
    ticksExecuted: ticks,
    totalPowerDemandKw,
    energyConsumedKwh,
    batteryEnergyBeforeKwh,
    batteryEnergyAfterKwh: batteryEnergyBeforeKwh - energyConsumedKwh,
    updatedBatteryCount,
  };
}

function getBatteryRemainingCapacityKwh(module: HabitatModule) {
  const capacityKwh = getRuntimeNumber(module, "capacityKwh") ?? 0;
  const currentEnergyKwh = getRuntimeNumber(module, "currentEnergyKwh") ?? 0;
  return Math.max(0, capacityKwh - currentEnergyKwh);
}

function getBatteryEnergyKwh(module: HabitatModule) {
  return getRuntimeNumber(module, "currentEnergyKwh") ?? 0;
}

export function hasSolarGenerationModules(modules: HabitatModule[]) {
  return modules.some(isSolarGenerationModule);
}

export function calculateSolarGenerationKwhPerTick(
  powerGenerationKw: number,
  solarIrradianceWPerM2: number,
) {
  const solarMultiplier = solarIrradianceWPerM2 / SOLAR_REFERENCE_IRRADIANCE_W_PER_M2;
  return {
    solarMultiplier,
    solarEfficiency: SOLAR_EFFICIENCY,
    generatedKwhPerTick:
      (powerGenerationKw * solarMultiplier * SOLAR_EFFICIENCY) / 3600,
  };
}

export function applySolarGeneration(
  modules: HabitatModule[],
  ticks: number,
  solarIrradiance: SolarIrradiance,
  options: RunPowerTicksOptions = {},
): SolarGenerationResult {
  assertValidTickCount(ticks);

  const solarModules = modules.filter(isOnlineSolarGenerationModule);
  const totalPowerGenerationKw = solarModules.reduce(
    (total, module) => total + getSolarGenerationKw(module),
    0,
  );

  const calculation = calculateSolarGenerationKwhPerTick(
    totalPowerGenerationKw,
    solarIrradiance.wPerM2,
  );
  const effectiveGenerationKw =
    totalPowerGenerationKw * calculation.solarMultiplier * calculation.solarEfficiency;
  const grossGeneratedKwh = calculation.generatedKwhPerTick * ticks;

  const batteryHeadroomKwh = modules.reduce((total, module) => {
    if (!isOnlineBatteryModule(module)) {
      return total;
    }

    return total + getBatteryRemainingCapacityKwh(module);
  }, 0);
  const totalBatteryModuleCount = modules.filter(isBatteryModule).length;
  const onlineBatteryModuleCount = modules.filter(isOnlineBatteryModule).length;
  const batteryEnergyBeforeKwh = modules.reduce((total, module) => {
    if (!isOnlineBatteryModule(module)) {
      return total;
    }

    return total + getBatteryEnergyKwh(module);
  }, 0);

  const storedKwh = Math.min(grossGeneratedKwh, batteryHeadroomKwh);
  const batteryEnergyAfterKwh = batteryEnergyBeforeKwh + storedKwh;
  const noChargingReason = getNoSolarChargingReason(
    solarModules.length,
    totalBatteryModuleCount,
    onlineBatteryModuleCount,
    solarIrradiance.wPerM2,
    batteryHeadroomKwh,
  );

  if (storedKwh <= 0) {
    return {
      modules,
      solarIrradianceWPerM2: solarIrradiance.wPerM2,
      solarMultiplier: calculation.solarMultiplier,
      solarEfficiency: calculation.solarEfficiency,
      effectiveGenerationKw,
      generatedKwhPerTick: calculation.generatedKwhPerTick,
      grossGeneratedKwh,
      batteryHeadroomKwh,
      batteryEnergyBeforeKwh,
      batteryEnergyAfterKwh,
      storedKwh,
      updatedBatteryCount: 0,
      noChargingReason,
    };
  }

  let remainingKwhToStore = storedKwh;
  const now = options.now ?? new Date().toISOString();
  let updatedBatteryCount = 0;

  const updatedModules = modules.map((module) => {
    if (!isBatteryModule(module)) {
      return module;
    }

    if (!isOnlineModule(module)) {
      return module;
    }

    const currentEnergyKwh = getBatteryEnergyKwh(module);
    const remainingCapacityKwh = getBatteryRemainingCapacityKwh(module);
    const chargedKwh = Math.min(remainingCapacityKwh, remainingKwhToStore);

    if (chargedKwh === 0) {
      return module;
    }

    remainingKwhToStore -= chargedKwh;
    updatedBatteryCount += 1;

    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        currentEnergyKwh: currentEnergyKwh + chargedKwh,
      },
      updatedAt: now,
    };
  });

  return {
    modules: updatedModules,
    solarIrradianceWPerM2: solarIrradiance.wPerM2,
    solarMultiplier: calculation.solarMultiplier,
    solarEfficiency: calculation.solarEfficiency,
    effectiveGenerationKw,
    generatedKwhPerTick: calculation.generatedKwhPerTick,
    grossGeneratedKwh,
    batteryHeadroomKwh,
    batteryEnergyBeforeKwh,
    batteryEnergyAfterKwh,
    storedKwh,
    updatedBatteryCount,
    noChargingReason,
  };
}

function getNoSolarChargingReason(
  onlineSolarModuleCount: number,
  totalBatteryModuleCount: number,
  onlineBatteryModuleCount: number,
  solarIrradianceWPerM2: number,
  batteryHeadroomKwh: number,
) {
  if (onlineSolarModuleCount === 0) {
    return "no online solar modules are available";
  }

  if (totalBatteryModuleCount === 0) {
    return "no battery modules are available";
  }

  if (onlineBatteryModuleCount === 0) {
    return "no online battery modules are available";
  }

  if (solarIrradianceWPerM2 <= 0) {
    return "solar irradiance is 0 W/m2";
  }

  if (batteryHeadroomKwh <= 0) {
    return "online batteries are already at capacity";
  }

  return undefined;
}
