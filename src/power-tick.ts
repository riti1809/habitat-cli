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
