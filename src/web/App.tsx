import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  BatteryCharging,
  Check,
  ChevronRight,
  CircleHelp,
  CloudSun,
  Cpu,
  Gauge,
  Leaf,
  LoaderCircle,
  Moon,
  Power,
  RefreshCw,
  Server,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";

type Module = {
  id: string;
  alias: string;
  moduleType: string;
  displayName: string;
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

type Registration = { displayName: string; habitatId: string; registeredAt: string } | null;
type Solar = { wPerM2: number; condition: "clear" | "dust" | "storm" | "night" } | null;
type Power = {
  powerGenerationKw: number;
  powerConsumptionKw: number;
  netPowerKw: number;
  batteryEnergyKwh: number;
  batteryCapacityKwh: number;
  solarIrradiance: Solar;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `${response.status} ${response.statusText}`);
  return body as T;
}

function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function statusOf(module: Module) {
  return typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : "unknown";
}

function powerDrawOf(module: Module) {
  const powerDraw = module.runtimeAttributes.powerDrawKw;
  const status = statusOf(module);
  return typeof powerDraw === "object" && powerDraw !== null && typeof (powerDraw as Record<string, unknown>)[status] === "number"
    ? (powerDraw as Record<string, number>)[status]
    : 0;
}

function IconBadge({ children, tone = "blue" }: { children: ReactNode; tone?: string }) {
  return <span className={`icon-badge ${tone}`}>{children}</span>;
}

function MetricCard({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note: string; tone: string }) {
  return <article className="metric-card"><IconBadge tone={tone}>{icon}</IconBadge><div><p className="eyebrow">{label}</p><strong>{value}</strong><span className="metric-note">{note}</span></div></article>;
}

export function App() {
  const [registration, setRegistration] = useState<Registration>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [power, setPower] = useState<Power | null>(null);
  const [displayName, setDisplayName] = useState("Orbital Habitat");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customTicks, setCustomTicks] = useState(120);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [registrationResponse, modulesResponse, powerResponse] = await Promise.all([
        api<{ registration: Registration }>("/registration"),
        api<{ modules: Module[] }>("/modules"),
        api<Power>("/power"),
      ]);
      setRegistration(registrationResponse.registration);
      setModules(modulesResponse.modules);
      setPower(powerResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect to the Habitat API.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onlineCount = useMemo(() => modules.filter((module) => statusOf(module) === "online").length, [modules]);
  const batteryPercent = power && power.batteryCapacityKwh > 0 ? Math.round((power.batteryEnergyKwh / power.batteryCapacityKwh) * 100) : 0;

  async function register() {
    setBusy("register");
    try { const response = await api<{ registration: Registration }>("/registration", { method: "POST", body: JSON.stringify({ displayName }) }); setRegistration(response.registration); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Registration failed."); }
    finally { setBusy(null); }
  }

  async function unregister() {
    if (!window.confirm("Unregister this Habitat? This removes the remote registration and local module state.")) return;
    setBusy("unregister");
    try { await api<void>("/registration", { method: "DELETE" }); setRegistration(null); setModules([]); setPower(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unregister failed."); }
    finally { setBusy(null); }
  }

  async function toggleModule(module: Module) {
    const nextStatus = statusOf(module) === "online" ? "offline" : "online";
    setBusy(module.id);
    try { await api(`/modules/${encodeURIComponent(module.id)}`, { method: "PUT", body: JSON.stringify({ module: { ...module, runtimeAttributes: { ...module.runtimeAttributes, status: nextStatus } } }) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Module update failed."); }
    finally { setBusy(null); }
  }

  async function tick(ticks: number) {
    setBusy(`tick-${ticks}`);
    try { await api("/tick", { method: "POST", body: JSON.stringify({ ticks }) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not advance the simulation."); }
    finally { setBusy(null); }
  }

  if (loading) return <main className="shell centered"><LoaderCircle className="spin" size={28} /><p>Connecting to Habitat API…</p></main>;

  return <main className={`shell ${theme}`}>
    <header className="topbar"><div className="brand"><div className="brand-mark"><Leaf size={20} /></div><div><strong>Habitat</strong><span>Control center</span></div></div><div className="top-actions"><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh"><RefreshCw size={18} /></button><button className="theme-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}><Sun size={16} /> {theme === "light" ? "Light" : "Dark"}</button><div className="avatar">OP</div></div></header>
    <section className="hero"><div><div className="breadcrumb">Operations <ChevronRight size={14} /> Habitat overview</div><h1>{registration?.displayName || "Habitat overview"}</h1><p className="subtitle">A live view of station health, power, and module operations.</p></div><div className={`registration-pill ${registration ? "registered" : "unregistered"}`}><span className="status-dot" />{registration ? "Registered" : "Not registered"}</div></section>
    {error && <div className="alert error"><CircleHelp size={18} /><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    {!registration ? <section className="empty-state"><div className="empty-icon"><Server size={28} /></div><h2>Register this Habitat</h2><p>Connect this local control center to a Habitat through the existing REST API.</p><div className="register-form"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Habitat display name" /><button className="primary" disabled={!displayName.trim() || busy === "register"} onClick={() => void register()}>{busy === "register" ? "Registering…" : "Register Habitat"}</button></div></section> : <>
      <section className="metrics-grid"><MetricCard icon={<Zap size={19} />} label="Net power" value={`${power ? formatNumber(power.netPowerKw) : "—"} kW`} note={power && power.netPowerKw >= 0 ? "Surplus available" : "Drawing from battery"} tone="purple" /><MetricCard icon={<Power size={19} />} label="Generation" value={`${power ? formatNumber(power.powerGenerationKw) : "—"} kW`} note="Active solar output" tone="amber" /><MetricCard icon={<Activity size={19} />} label="Consumption" value={`${power ? formatNumber(power.powerConsumptionKw) : "—"} kW`} note={`${onlineCount} of ${modules.length} modules online`} tone="blue" /><MetricCard icon={<BatteryCharging size={19} />} label="Battery state" value={`${power ? formatNumber(power.batteryEnergyKwh) : "—"} kWh`} note={`${batteryPercent}% charged`} tone="green" /></section>
      <div className="content-grid"><section className="panel modules-panel"><div className="panel-heading"><div><p className="eyebrow">Systems</p><h2>Current modules</h2></div><span className="count-pill">{modules.length} total</span></div>{modules.length === 0 ? <div className="panel-empty">No modules have been returned by the Habitat API.</div> : <div className="module-list">{modules.map((module) => { const online = statusOf(module) === "online"; return <div className="module-row" key={module.id}><IconBadge tone={online ? "green" : "gray"}>{online ? <Wifi size={17} /> : <WifiOff size={17} />}</IconBadge><div className="module-info"><strong>{module.displayName}</strong><span>{module.alias} · {module.moduleType}</span></div><div className="module-power"><strong>{formatNumber(powerDrawOf(module), 2)} kW</strong><span>power draw</span></div><button className={`toggle ${online ? "on" : ""}`} onClick={() => void toggleModule(module)} disabled={busy === module.id} aria-label={`Set ${module.displayName} ${online ? "offline" : "online"}`}><span /></button></div>; })}</div>}</section>
        <aside className="side-column"><section className="panel solar-card"><div className="panel-heading"><div><p className="eyebrow">Environment</p><h2>Solar conditions</h2></div><CloudSun size={23} className="muted" /></div><div className="solar-reading"><div className="sun-orbit"><Sun size={31} /></div><div><strong>{power?.solarIrradiance ? formatNumber(power.solarIrradiance.wPerM2, 0) : "—"} <small>W/m²</small></strong><span>{power?.solarIrradiance?.condition || "Unavailable"}</span></div></div><div className="condition-row"><span>Current condition</span><strong>{power?.solarIrradiance?.condition || "Unknown"}</strong></div></section><section className="panel ticks-card"><div className="panel-heading"><div><p className="eyebrow">Simulation</p><h2>Advance time</h2></div><Gauge size={22} className="muted" /></div><p className="panel-copy">Run the server-side power simulation and refresh the station view.</p><div className="tick-grid">{[[1, "1 tick"], [60, "1 minute"], [600, "10 minutes"], [3600, "1 hour"]].map(([value, label]) => <button key={value} onClick={() => void tick(value as number)} disabled={busy !== null}>{busy === `tick-${value}` ? <LoaderCircle className="spin" size={15} /> : label}</button>)}</div><div className="custom-tick"><input type="number" min="1" step="1" value={customTicks} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setCustomTicks(Math.max(1, Math.floor(value))); }} /><button className="primary" disabled={busy !== null} onClick={() => void tick(customTicks)}>Run custom ticks</button></div></section></aside></div>
      <section className="footer-bar"><span><Check size={15} /> REST API connected</span><span>Habitat ID: {registration.habitatId}</span><button className="danger-button" onClick={() => void unregister()} disabled={busy === "unregister"}><Trash2 size={15} /> {busy === "unregister" ? "Unregistering…" : "Unregister Habitat"}</button></section>
    </>}
  </main>;
}
