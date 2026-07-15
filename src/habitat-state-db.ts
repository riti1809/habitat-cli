import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

export function getHabitatDirectory(cwd = process.cwd()) {
  return join(cwd, ".habitat");
}

export function getStateDatabaseFilePath(cwd = process.cwd()) {
  return join(getHabitatDirectory(cwd), "state.sqlite");
}

export function getLegacyRegistrationFilePath(cwd = process.cwd()) {
  return join(getHabitatDirectory(cwd), "registration.json");
}

export function getLegacyModulesFilePath(cwd = process.cwd()) {
  return join(getHabitatDirectory(cwd), "modules.json");
}

export function ensureHabitatStateDirectory(cwd = process.cwd()) {
  mkdirSync(getHabitatDirectory(cwd), { recursive: true });
}

export function ensureHabitatDatabaseSchema(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS registration (
      habitat_uuid TEXT PRIMARY KEY,
      habitat_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      starter_modules_json TEXT NOT NULL,
      starter_humans_json TEXT,
      blueprints_json TEXT NOT NULL,
      contracts_json TEXT,
      last_status_json TEXT
    );

    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL UNIQUE,
      blueprint_id TEXT NOT NULL,
      module_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      connected_to_json TEXT NOT NULL,
      runtime_attributes_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      construction_status TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      construction_job_json TEXT
    );

    CREATE TABLE IF NOT EXISTS exploration_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      deployed_human_id TEXT,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      carried_resources_json TEXT NOT NULL,
      max_carrying_capacity_kg REAL NOT NULL
    );
  `);

  const columns = new Set(
    (database.query("PRAGMA table_info(registration)").all() as Array<{ name: string }>)
      .map((column) => column.name),
  );

  if (!columns.has("starter_humans_json")) {
    database.exec("ALTER TABLE registration ADD COLUMN starter_humans_json TEXT");
  }

  if (!columns.has("contracts_json")) {
    database.exec("ALTER TABLE registration ADD COLUMN contracts_json TEXT");
  }
}

export function openHabitatDatabase(cwd = process.cwd()) {
  ensureHabitatStateDirectory(cwd);
  const database = new Database(getStateDatabaseFilePath(cwd), {
    create: true,
    strict: true,
  });
  ensureHabitatDatabaseSchema(database);
  return database;
}
