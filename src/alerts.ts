import { randomUUID } from "node:crypto";
import { openHabitatDatabase } from "./habitat-state-db";
import { readRegistration } from "./habitat-store";

export type AlertStatus = "open" | "acknowledged" | "resolved";
export type HabitatAlert = {
  id: string;
  condition: string;
  message: string;
  severity: string;
  status: AlertStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  occurrenceCount: number;
  subject?: { humanId?: string; moduleId?: string };
};

function contract(cwd: string) {
  const alerts = readRegistration(cwd)?.contracts?.alerts;
  if (!alerts) throw new Error("No registered contracts.alerts definition is available.");
  return alerts;
}

function readAlerts(cwd = process.cwd()): HabitatAlert[] {
  const database = openHabitatDatabase(cwd);
  try { return (database.query("SELECT payload_json FROM alerts ORDER BY last_observed_at DESC").all() as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json)); }
  finally { database.close(); }
}

export function listAlerts(cwd = process.cwd()) { contract(cwd); return readAlerts(cwd); }

export function observeAlert(condition: string, details: Omit<HabitatAlert, "id" | "condition" | "createdAt" | "updatedAt" | "lastObservedAt" | "occurrenceCount" | "status">, cwd = process.cwd()) {
  contract(cwd);
  const now = new Date().toISOString();
  const database = openHabitatDatabase(cwd);
  try {
    const existing = (database.query("SELECT id, condition_key, payload_json, status, occurrence_count FROM alerts").all() as Array<{ id: string; condition_key: string; payload_json: string; status: AlertStatus; occurrence_count: number }>).find((row) => row.condition_key === condition) ?? null;
    const alert: HabitatAlert = existing
      ? { ...JSON.parse(existing.payload_json), ...details, status: existing.status, updatedAt: now, lastObservedAt: now, occurrenceCount: existing.occurrence_count + 1 }
      : { id: `alert_${randomUUID()}`, condition, ...details, status: "open", createdAt: now, updatedAt: now, lastObservedAt: now, occurrenceCount: 1 };
    database.run(`INSERT INTO alerts (id, condition_key, payload_json, status, last_observed_at, occurrence_count) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(condition_key) DO UPDATE SET payload_json = excluded.payload_json, status = excluded.status, last_observed_at = excluded.last_observed_at, occurrence_count = excluded.occurrence_count`, [alert.id, condition, JSON.stringify(alert), alert.status, now, alert.occurrenceCount]);
    return alert;
  } finally { database.close(); }
}

export function acknowledgeAlert(id: string, cwd = process.cwd()) {
  contract(cwd);
  const database = openHabitatDatabase(cwd);
  try {
    const row = (database.query("SELECT id, payload_json FROM alerts").all() as Array<{ id: string; payload_json: string }>).find((item) => item.id === id) ?? null;
    if (!row) throw new Error(`Alert "${id}" was not found.`);
    const alert = { ...JSON.parse(row.payload_json), status: "acknowledged", updatedAt: new Date().toISOString() } as HabitatAlert;
    database.run("UPDATE alerts SET payload_json = ?, status = ? WHERE id = ?", [JSON.stringify(alert), alert.status, id]);
    return alert;
  } finally { database.close(); }
}

export function resolveAlert(condition: string, cwd = process.cwd()) {
  contract(cwd);
  const database = openHabitatDatabase(cwd);
  try {
    const row = (database.query("SELECT id, payload_json FROM alerts").all() as Array<{ id: string; payload_json: string }>).find((item) => (JSON.parse(item.payload_json) as HabitatAlert).condition === condition);
    if (!row) return undefined;
    const alert = { ...JSON.parse(row.payload_json), status: "resolved", updatedAt: new Date().toISOString() } as HabitatAlert;
    database.run("UPDATE alerts SET payload_json = ?, status = ? WHERE id = ?", [JSON.stringify(alert), alert.status, row.id]);
    return alert;
  } finally { database.close(); }
}

export function formatAlertList(alerts: HabitatAlert[]) {
  if (!alerts.length) return "No alerts found.";
  return alerts.map((alert) => `${alert.id} | ${alert.severity} | ${alert.status} | ${alert.message} | occurrences: ${alert.occurrenceCount}`).join("\n");
}
