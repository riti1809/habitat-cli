#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import packageJson from "../package.json";
import {
  type Airlock,
  type Door,
  getDataFilePath,
  type Greenhouse,
  readData,
  type Rover,
  type Sensor,
  type Zone,
  writeData,
} from "./habitat-store";

type ZoneUpdateOptions = {
  name?: string;
  purpose?: string;
  status?: string;
};

type DoorUpdateOptions = {
  name?: string;
  status?: string;
  locked?: string;
};

type SensorUpdateOptions = {
  name?: string;
  purpose?: string;
  status?: string;
};

type RoverUpdateOptions = {
  name?: string;
  purpose?: string;
  status?: string;
};

type GreenhouseUpdateOptions = {
  name?: string;
  purpose?: string;
  status?: string;
};

type AirlockCreateOptions = {
  name: string;
  pressureLevel: string;
  locked: string;
};

type AirlockUpdateOptions = {
  name?: string;
  pressureLevel?: string;
  locked?: string;
};

const program = new Command();
const zoneCommand = program
  .command("zone")
  .description("Create, list, show, update, and delete zones.");
const doorCommand = program
  .command("door")
  .description("Create, list, show, update, and delete doors.");
const sensorCommand = program
  .command("sensor")
  .description("Create, list, show, update, and delete sensors.");
const roverCommand = program
  .command("rover")
  .description("Create, list, show, update, and delete rovers.");
const greenhouseCommand = program
  .command("greenhouse")
  .description("Create, show, update, and delete greenhouses.");
const airlockCommand = program
  .command("airlock")
  .description("Create, list, show, update, delete, and connect airlocks.");

program
  .name("habitat")
  .description("Habitat CLI for managing local habitat resources in .habitat/data.json.")
  .version(packageJson.version)
  .showSuggestionAfterError()
  .exitOverride();

program.addHelpText(
  "after",
  `
Overview:
  This CLI stores data locally in .habitat/data.json.
  Use resource commands to create, inspect, update, and delete records.
  Use "show" to inspect one record by name.
  Use "list" where available to inspect all records of a type.

Command groups:
  zone        Resource with: create, list, show, update, delete
  door        Resource with: create, list, show, update, delete
  sensor      Resource with: create, list, show, update, delete
  rover       Resource with: create, list, show, update, delete
  greenhouse  Resource with: create, show, update, delete
  airlock     Resource with: create, list, show, update, delete, add-door

Common patterns:
  habitat <resource> create --name <name> [resource-specific options]
  habitat <resource> show <name>
  habitat <resource> update <name> [fields to change]
  habitat <resource> delete <name>

Examples:
  habitat zone create --name kitchen --purpose storage --status active
  habitat sensor show temp-1
  habitat rover update scout-1 --status standby
  habitat airlock add-door cargo inner

Inspect subcommand help:
  habitat zone --help
  habitat door --help
  habitat sensor --help
  habitat rover --help
  habitat greenhouse --help
  habitat airlock --help
`,
);

zoneCommand.addHelpText(
  "after",
  `
Fields:
  name, purpose, status

Actions:
  create   Create a new zone
  list     List all zones
  show     Show one zone by name
  update   Update one zone by name
  delete   Delete one zone by name

Examples:
  habitat zone create --name kitchen --purpose storage --status active
  habitat zone list
  habitat zone show kitchen
  habitat zone update kitchen --purpose cooking --status ready
  habitat zone delete kitchen
`,
);

doorCommand.addHelpText(
  "after",
  `
Fields:
  name, status, locked

Actions:
  create   Create a new door
  list     List all doors
  show     Show one door by name
  update   Update one door by name
  delete   Delete one door by name

Examples:
  habitat door create --name alpha --status closed --locked true
  habitat door list
  habitat door show alpha
  habitat door update alpha --status open --locked false
  habitat door delete alpha
`,
);

sensorCommand.addHelpText(
  "after",
  `
Fields:
  name, purpose, status

Actions:
  create   Create a new sensor
  list     List all sensors
  show     Show one sensor by name
  update   Update one sensor by name
  delete   Delete one sensor by name

Examples:
  habitat sensor create --name temp-1 --purpose monitoring --status active
  habitat sensor list
  habitat sensor show temp-1
  habitat sensor update temp-1 --purpose safety --status standby
  habitat sensor delete temp-1
`,
);

roverCommand.addHelpText(
  "after",
  `
Fields:
  name, purpose, status

Actions:
  create   Create a new rover
  list     List all rovers
  show     Show one rover by name
  update   Update one rover by name
  delete   Delete one rover by name

Examples:
  habitat rover create --name scout-1 --purpose exploration --status active
  habitat rover list
  habitat rover show scout-1
  habitat rover update scout-1 --purpose transport --status standby
  habitat rover delete scout-1
`,
);

greenhouseCommand.addHelpText(
  "after",
  `
Fields:
  name, purpose, status

Actions:
  create   Create a new greenhouse
  show     Show one greenhouse by name
  update   Update one greenhouse by name
  delete   Delete one greenhouse by name

Examples:
  habitat greenhouse create --name dome-1 --purpose food --status active
  habitat greenhouse show dome-1
  habitat greenhouse update dome-1 --purpose research --status standby
  habitat greenhouse delete dome-1
`,
);

airlockCommand.addHelpText(
  "after",
  `
Fields:
  name, pressureLevel, locked
  Relationships:
    add-door attaches an existing door to an existing airlock

Actions:
  create     Create a new airlock
  list       List all airlocks
  show       Show one airlock by name
  update     Update one airlock by name
  delete     Delete one airlock by name
  add-door   Attach a door to an airlock

Examples:
  habitat airlock create --name main --pressureLevel high --locked true
  habitat airlock list
  habitat airlock show main
  habitat airlock update main --pressureLevel medium --locked false
  habitat airlock add-door main alpha
  habitat airlock delete main
`,
);

zoneCommand
  .command("create")
  .description("Create a zone.")
  .requiredOption("--name <name>", "Zone name")
  .requiredOption("--purpose <purpose>", "Zone purpose")
  .requiredOption("--status <status>", "Zone status")
  .action((options: Zone) => {
    const data = readData();

    if (data.zones.some((zone) => zone.name === options.name)) {
      console.error(`Zone "${options.name}" already exists.`);
      process.exit(1);
    }

    data.zones.push({
      name: options.name,
      purpose: options.purpose,
      status: options.status,
    });
    writeData(data);

    console.log(`Created zone "${options.name}".`);
    console.log(`Stored in ${getDataFilePath()}`);
  });

zoneCommand
  .command("list")
  .description("List zones.")
  .action(() => {
    const data = readData();

    if (data.zones.length === 0) {
      console.log("No zones found.");
      console.log(`Data file: ${getDataFilePath()}`);
      return;
    }

    for (const zone of data.zones) {
      console.log(`${zone.name} | purpose: ${zone.purpose} | status: ${zone.status}`);
    }
  });

zoneCommand
  .command("show")
  .description("Show one zone.")
  .argument("<name>", "Zone name")
  .action((name: string) => {
    const zone = readData().zones.find((item) => item.name === name);

    if (!zone) {
      console.error(`Zone "${name}" was not found.`);
      process.exit(1);
    }

    console.log(JSON.stringify(zone, null, 2));
  });

zoneCommand
  .command("update")
  .description("Update a zone.")
  .argument("<name>", "Zone name")
  .option("--name <newName>", "New zone name")
  .option("--purpose <purpose>", "New zone purpose")
  .option("--status <status>", "New zone status")
  .action((name: string, options: ZoneUpdateOptions) => {
    const data = readData();
    const zoneIndex = data.zones.findIndex((item) => item.name === name);

    if (zoneIndex === -1) {
      console.error(`Zone "${name}" was not found.`);
      process.exit(1);
    }

    if (!options.name && !options.purpose && !options.status) {
      console.error("Provide at least one field to update.");
      process.exit(1);
    }

    if (options.name && options.name !== name && data.zones.some((zone) => zone.name === options.name)) {
      console.error(`Zone "${options.name}" already exists.`);
      process.exit(1);
    }

    const currentZone = data.zones[zoneIndex];
    data.zones[zoneIndex] = {
      name: options.name ?? currentZone.name,
      purpose: options.purpose ?? currentZone.purpose,
      status: options.status ?? currentZone.status,
    };

    writeData(data);
    console.log(`Updated zone "${data.zones[zoneIndex].name}".`);
  });

zoneCommand
  .command("delete")
  .description("Delete a zone.")
  .argument("<name>", "Zone name")
  .action((name: string) => {
    const data = readData();
    const remainingZones = data.zones.filter((zone) => zone.name !== name);

    if (remainingZones.length === data.zones.length) {
      console.error(`Zone "${name}" was not found.`);
      process.exit(1);
    }

    data.zones = remainingZones;
    writeData(data);
    console.log(`Deleted zone "${name}".`);
  });

doorCommand
  .command("create")
  .description("Create a door.")
  .requiredOption("--name <name>", "Door name")
  .requiredOption("--status <status>", "Door status")
  .requiredOption("--locked <locked>", "Whether the door is locked")
  .action((options: Door) => {
    const data = readData();

    if (data.doors.some((door) => door.name === options.name)) {
      console.error(`Door "${options.name}" already exists.`);
      process.exit(1);
    }

    data.doors.push({
      name: options.name,
      status: options.status,
      locked: options.locked,
    });
    writeData(data);

    console.log(`Created door "${options.name}".`);
    console.log(`Stored in ${getDataFilePath()}`);
  });

doorCommand
  .command("list")
  .description("List doors.")
  .action(() => {
    const data = readData();

    if (data.doors.length === 0) {
      console.log("No doors found.");
      console.log(`Data file: ${getDataFilePath()}`);
      return;
    }

    for (const door of data.doors) {
      console.log(`${door.name} | status: ${door.status} | locked: ${door.locked}`);
    }
  });

doorCommand
  .command("show")
  .description("Show one door.")
  .argument("<name>", "Door name")
  .action((name: string) => {
    const door = readData().doors.find((item) => item.name === name);

    if (!door) {
      console.error(`Door "${name}" was not found.`);
      process.exit(1);
    }

    console.log(JSON.stringify(door, null, 2));
  });

doorCommand
  .command("update")
  .description("Update a door.")
  .argument("<name>", "Door name")
  .option("--name <newName>", "New door name")
  .option("--status <status>", "New door status")
  .option("--locked <locked>", "New door locked value")
  .action((name: string, options: DoorUpdateOptions) => {
    const data = readData();
    const doorIndex = data.doors.findIndex((item) => item.name === name);

    if (doorIndex === -1) {
      console.error(`Door "${name}" was not found.`);
      process.exit(1);
    }

    if (!options.name && !options.status && !options.locked) {
      console.error("Provide at least one field to update.");
      process.exit(1);
    }

    if (options.name && options.name !== name && data.doors.some((door) => door.name === options.name)) {
      console.error(`Door "${options.name}" already exists.`);
      process.exit(1);
    }

    const currentDoor = data.doors[doorIndex];
    const updatedDoorName = options.name ?? currentDoor.name;

    data.doors[doorIndex] = {
      name: updatedDoorName,
      status: options.status ?? currentDoor.status,
      locked: options.locked ?? currentDoor.locked,
    };

    if (updatedDoorName !== name) {
      data.airlocks = data.airlocks.map((airlock) => ({
        ...airlock,
        doorNames: airlock.doorNames.map((doorName) =>
          doorName === name ? updatedDoorName : doorName,
        ),
      }));
    }

    writeData(data);
    console.log(`Updated door "${updatedDoorName}".`);
  });

doorCommand
  .command("delete")
  .description("Delete a door.")
  .argument("<name>", "Door name")
  .action((name: string) => {
    const data = readData();
    const remainingDoors = data.doors.filter((door) => door.name !== name);

    if (remainingDoors.length === data.doors.length) {
      console.error(`Door "${name}" was not found.`);
      process.exit(1);
    }

    data.doors = remainingDoors;
    data.airlocks = data.airlocks.map((airlock) => ({
      ...airlock,
      doorNames: airlock.doorNames.filter((doorName) => doorName !== name),
    }));

    writeData(data);
    console.log(`Deleted door "${name}".`);
  });

sensorCommand
  .command("create")
  .description("Create a sensor.")
  .requiredOption("--name <name>", "Sensor name")
  .requiredOption("--purpose <purpose>", "Sensor purpose")
  .requiredOption("--status <status>", "Sensor status")
  .action((options: Sensor) => {
    const data = readData();

    if (data.sensors.some((sensor) => sensor.name === options.name)) {
      console.error(`Sensor "${options.name}" already exists.`);
      process.exit(1);
    }

    data.sensors.push({
      name: options.name,
      purpose: options.purpose,
      status: options.status,
    });
    writeData(data);

    console.log(`Created sensor "${options.name}".`);
    console.log(`Stored in ${getDataFilePath()}`);
  });

sensorCommand
  .command("list")
  .description("List sensors.")
  .action(() => {
    const data = readData();

    if (data.sensors.length === 0) {
      console.log("No sensors found.");
      console.log(`Data file: ${getDataFilePath()}`);
      return;
    }

    for (const sensor of data.sensors) {
      console.log(`${sensor.name} | purpose: ${sensor.purpose} | status: ${sensor.status}`);
    }
  });

sensorCommand
  .command("show")
  .description("Show one sensor.")
  .argument("<name>", "Sensor name")
  .action((name: string) => {
    const sensor = readData().sensors.find((item) => item.name === name);

    if (!sensor) {
      console.error(`Sensor "${name}" was not found.`);
      process.exit(1);
    }

    console.log(JSON.stringify(sensor, null, 2));
  });

sensorCommand
  .command("update")
  .description("Update a sensor.")
  .argument("<name>", "Sensor name")
  .option("--name <newName>", "New sensor name")
  .option("--purpose <purpose>", "New sensor purpose")
  .option("--status <status>", "New sensor status")
  .action((name: string, options: SensorUpdateOptions) => {
    const data = readData();
    const sensorIndex = data.sensors.findIndex((item) => item.name === name);

    if (sensorIndex === -1) {
      console.error(`Sensor "${name}" was not found.`);
      process.exit(1);
    }

    if (!options.name && !options.purpose && !options.status) {
      console.error("Provide at least one field to update.");
      process.exit(1);
    }

    if (
      options.name &&
      options.name !== name &&
      data.sensors.some((sensor) => sensor.name === options.name)
    ) {
      console.error(`Sensor "${options.name}" already exists.`);
      process.exit(1);
    }

    const currentSensor = data.sensors[sensorIndex];
    data.sensors[sensorIndex] = {
      name: options.name ?? currentSensor.name,
      purpose: options.purpose ?? currentSensor.purpose,
      status: options.status ?? currentSensor.status,
    };

    writeData(data);
    console.log(`Updated sensor "${data.sensors[sensorIndex].name}".`);
  });

sensorCommand
  .command("delete")
  .description("Delete a sensor.")
  .argument("<name>", "Sensor name")
  .action((name: string) => {
    const data = readData();
    const remainingSensors = data.sensors.filter((sensor) => sensor.name !== name);

    if (remainingSensors.length === data.sensors.length) {
      console.error(`Sensor "${name}" was not found.`);
      process.exit(1);
    }

    data.sensors = remainingSensors;
    writeData(data);
    console.log(`Deleted sensor "${name}".`);
  });

roverCommand
  .command("create")
  .description("Create a rover.")
  .requiredOption("--name <name>", "Rover name")
  .requiredOption("--purpose <purpose>", "Rover purpose")
  .requiredOption("--status <status>", "Rover status")
  .action((options: Rover) => {
    const data = readData();

    if (data.rovers.some((rover) => rover.name === options.name)) {
      console.error(`Rover "${options.name}" already exists.`);
      process.exit(1);
    }

    data.rovers.push({
      name: options.name,
      purpose: options.purpose,
      status: options.status,
    });
    writeData(data);

    console.log(`Created rover "${options.name}".`);
    console.log(`Stored in ${getDataFilePath()}`);
  });

roverCommand
  .command("list")
  .description("List rovers.")
  .action(() => {
    const data = readData();

    if (data.rovers.length === 0) {
      console.log("No rovers found.");
      console.log(`Data file: ${getDataFilePath()}`);
      return;
    }

    for (const rover of data.rovers) {
      console.log(`${rover.name} | purpose: ${rover.purpose} | status: ${rover.status}`);
    }
  });

roverCommand
  .command("show")
  .description("Show one rover.")
  .argument("<name>", "Rover name")
  .action((name: string) => {
    const rover = readData().rovers.find((item) => item.name === name);

    if (!rover) {
      console.error(`Rover "${name}" was not found.`);
      process.exit(1);
    }

    console.log(JSON.stringify(rover, null, 2));
  });

roverCommand
  .command("update")
  .description("Update a rover.")
  .argument("<name>", "Rover name")
  .option("--name <newName>", "New rover name")
  .option("--purpose <purpose>", "New rover purpose")
  .option("--status <status>", "New rover status")
  .action((name: string, options: RoverUpdateOptions) => {
    const data = readData();
    const roverIndex = data.rovers.findIndex((item) => item.name === name);

    if (roverIndex === -1) {
      console.error(`Rover "${name}" was not found.`);
      process.exit(1);
    }

    if (!options.name && !options.purpose && !options.status) {
      console.error("Provide at least one field to update.");
      process.exit(1);
    }

    if (
      options.name &&
      options.name !== name &&
      data.rovers.some((rover) => rover.name === options.name)
    ) {
      console.error(`Rover "${options.name}" already exists.`);
      process.exit(1);
    }

    const currentRover = data.rovers[roverIndex];
    data.rovers[roverIndex] = {
      name: options.name ?? currentRover.name,
      purpose: options.purpose ?? currentRover.purpose,
      status: options.status ?? currentRover.status,
    };

    writeData(data);
    console.log(`Updated rover "${data.rovers[roverIndex].name}".`);
  });

roverCommand
  .command("delete")
  .description("Delete a rover.")
  .argument("<name>", "Rover name")
  .action((name: string) => {
    const data = readData();
    const remainingRovers = data.rovers.filter((rover) => rover.name !== name);

    if (remainingRovers.length === data.rovers.length) {
      console.error(`Rover "${name}" was not found.`);
      process.exit(1);
    }

    data.rovers = remainingRovers;
    writeData(data);
    console.log(`Deleted rover "${name}".`);
  });

greenhouseCommand
  .command("create")
  .description("Create a greenhouse.")
  .requiredOption("--name <name>", "Greenhouse name")
  .requiredOption("--purpose <purpose>", "Greenhouse purpose")
  .requiredOption("--status <status>", "Greenhouse status")
  .action((options: Greenhouse) => {
    const data = readData();

    if (data.greenhouses.some((greenhouse) => greenhouse.name === options.name)) {
      console.error(`Greenhouse "${options.name}" already exists.`);
      process.exit(1);
    }

    data.greenhouses.push({
      name: options.name,
      purpose: options.purpose,
      status: options.status,
    });
    writeData(data);

    console.log(`Created greenhouse "${options.name}".`);
    console.log(`Stored in ${getDataFilePath()}`);
  });

greenhouseCommand
  .command("show")
  .description("Show one greenhouse.")
  .argument("<name>", "Greenhouse name")
  .action((name: string) => {
    const greenhouse = readData().greenhouses.find((item) => item.name === name);

    if (!greenhouse) {
      console.error(`Greenhouse "${name}" was not found.`);
      process.exit(1);
    }

    console.log(JSON.stringify(greenhouse, null, 2));
  });

greenhouseCommand
  .command("update")
  .description("Update a greenhouse.")
  .argument("<name>", "Greenhouse name")
  .option("--name <newName>", "New greenhouse name")
  .option("--purpose <purpose>", "New greenhouse purpose")
  .option("--status <status>", "New greenhouse status")
  .action((name: string, options: GreenhouseUpdateOptions) => {
    const data = readData();
    const greenhouseIndex = data.greenhouses.findIndex((item) => item.name === name);

    if (greenhouseIndex === -1) {
      console.error(`Greenhouse "${name}" was not found.`);
      process.exit(1);
    }

    if (!options.name && !options.purpose && !options.status) {
      console.error("Provide at least one field to update.");
      process.exit(1);
    }

    if (
      options.name &&
      options.name !== name &&
      data.greenhouses.some((greenhouse) => greenhouse.name === options.name)
    ) {
      console.error(`Greenhouse "${options.name}" already exists.`);
      process.exit(1);
    }

    const currentGreenhouse = data.greenhouses[greenhouseIndex];
    data.greenhouses[greenhouseIndex] = {
      name: options.name ?? currentGreenhouse.name,
      purpose: options.purpose ?? currentGreenhouse.purpose,
      status: options.status ?? currentGreenhouse.status,
    };

    writeData(data);
    console.log(`Updated greenhouse "${data.greenhouses[greenhouseIndex].name}".`);
  });

greenhouseCommand
  .command("delete")
  .description("Delete a greenhouse.")
  .argument("<name>", "Greenhouse name")
  .action((name: string) => {
    const data = readData();
    const remainingGreenhouses = data.greenhouses.filter(
      (greenhouse) => greenhouse.name !== name,
    );

    if (remainingGreenhouses.length === data.greenhouses.length) {
      console.error(`Greenhouse "${name}" was not found.`);
      process.exit(1);
    }

    data.greenhouses = remainingGreenhouses;
    writeData(data);
    console.log(`Deleted greenhouse "${name}".`);
  });

airlockCommand
  .command("create")
  .description("Create an airlock.")
  .requiredOption("--name <name>", "Airlock name")
  .requiredOption("--pressureLevel <pressureLevel>", "Airlock pressure level")
  .requiredOption("--locked <locked>", "Whether the airlock is locked")
  .action((options: AirlockCreateOptions) => {
    const data = readData();

    if (data.airlocks.some((airlock) => airlock.name === options.name)) {
      console.error(`Airlock "${options.name}" already exists.`);
      process.exit(1);
    }

    data.airlocks.push({
      name: options.name,
      pressureLevel: options.pressureLevel,
      locked: options.locked,
      doorNames: [],
    });
    writeData(data);

    console.log(`Created airlock "${options.name}".`);
    console.log(`Stored in ${getDataFilePath()}`);
  });

airlockCommand
  .command("list")
  .description("List airlocks.")
  .action(() => {
    const data = readData();

    if (data.airlocks.length === 0) {
      console.log("No airlocks found.");
      console.log(`Data file: ${getDataFilePath()}`);
      return;
    }

    for (const airlock of data.airlocks) {
      console.log(
        `${airlock.name} | pressureLevel: ${airlock.pressureLevel} | locked: ${airlock.locked} | doors: ${airlock.doorNames.join(", ") || "none"}`,
      );
    }
  });

airlockCommand
  .command("show")
  .description("Show one airlock.")
  .argument("<name>", "Airlock name")
  .action((name: string) => {
    const data = readData();
    const airlock = data.airlocks.find((item) => item.name === name);

    if (!airlock) {
      console.error(`Airlock "${name}" was not found.`);
      process.exit(1);
    }

    const doors = airlock.doorNames
      .map((doorName) => data.doors.find((door) => door.name === doorName))
      .filter((door): door is Door => door !== undefined);

    console.log(
      JSON.stringify(
        {
          ...airlock,
          doors,
        },
        null,
        2,
      ),
    );
  });

airlockCommand
  .command("update")
  .description("Update an airlock.")
  .argument("<name>", "Airlock name")
  .option("--name <newName>", "New airlock name")
  .option("--pressureLevel <pressureLevel>", "New airlock pressure level")
  .option("--locked <locked>", "New airlock locked value")
  .action((name: string, options: AirlockUpdateOptions) => {
    const data = readData();
    const airlockIndex = data.airlocks.findIndex((item) => item.name === name);

    if (airlockIndex === -1) {
      console.error(`Airlock "${name}" was not found.`);
      process.exit(1);
    }

    if (!options.name && !options.pressureLevel && !options.locked) {
      console.error("Provide at least one field to update.");
      process.exit(1);
    }

    if (
      options.name &&
      options.name !== name &&
      data.airlocks.some((airlock) => airlock.name === options.name)
    ) {
      console.error(`Airlock "${options.name}" already exists.`);
      process.exit(1);
    }

    const currentAirlock = data.airlocks[airlockIndex];
    data.airlocks[airlockIndex] = {
      ...currentAirlock,
      name: options.name ?? currentAirlock.name,
      pressureLevel: options.pressureLevel ?? currentAirlock.pressureLevel,
      locked: options.locked ?? currentAirlock.locked,
    };

    writeData(data);
    console.log(`Updated airlock "${data.airlocks[airlockIndex].name}".`);
  });

airlockCommand
  .command("delete")
  .description("Delete an airlock.")
  .argument("<name>", "Airlock name")
  .action((name: string) => {
    const data = readData();
    const remainingAirlocks = data.airlocks.filter((airlock) => airlock.name !== name);

    if (remainingAirlocks.length === data.airlocks.length) {
      console.error(`Airlock "${name}" was not found.`);
      process.exit(1);
    }

    data.airlocks = remainingAirlocks;
    writeData(data);
    console.log(`Deleted airlock "${name}".`);
  });

airlockCommand
  .command("add-door")
  .description("Attach a door to an airlock.")
  .argument("<airlockName>", "Airlock name")
  .argument("<doorName>", "Door name")
  .action((airlockName: string, doorName: string) => {
    const data = readData();
    const airlockIndex = data.airlocks.findIndex((item) => item.name === airlockName);

    if (airlockIndex === -1) {
      console.error(`Airlock "${airlockName}" was not found.`);
      process.exit(1);
    }

    if (!data.doors.some((door) => door.name === doorName)) {
      console.error(`Door "${doorName}" was not found.`);
      process.exit(1);
    }

    const airlock = data.airlocks[airlockIndex];

    if (airlock.doorNames.includes(doorName)) {
      console.error(`Door "${doorName}" is already attached to airlock "${airlockName}".`);
      process.exit(1);
    }

    data.airlocks[airlockIndex] = {
      ...airlock,
      doorNames: [...airlock.doorNames, doorName],
    };

    writeData(data);
    console.log(`Attached door "${doorName}" to airlock "${airlockName}".`);
  });

try {
  program.parse(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version"
    ) {
      process.exit(0);
    }

    if (
      error.code === "commander.unknownCommand" ||
      error.code === "commander.excessArguments"
    ) {
      console.error("That command is not available yet.");
      console.error("Run `habitat --help` to see the supported options.");
      process.exit(1);
    }

    process.exit(error.exitCode);
  }

  throw error;
}
