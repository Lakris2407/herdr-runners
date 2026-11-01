// The lock outlives a slow read (a lanes status command may ask several machines) but not one a hot reload cut off.
// One snapshot in shared state for every copy (chip, panel, popup, timeline): whichever copy finds it
// due takes a short lock and reads, so the status bar and the panel never ask GitHub twice.
import { shared, setShared, notify } from "herdr";
import { loadConfig } from "./config.js";
import { loadJobs, machineLoad } from "./load.js";
import { loadLanes } from "./lanesource.js";
import { demoSnapshot } from "./demo.js";
import { jobKey, median, label } from "./model.js";

export const KEY = "runners.v1";
const LOCK = "runners.lock", REFRESH = "runners.refresh";
const BUSY_MS = 20000, IDLE_MS = 60000, LOAD_MS = 60000, LOCK_MS = 45000;

export const snapshot = () => shared(KEY) ?? null;
export const refresh = () => setShared(REFRESH, Date.now());

function due(s, now) {
  if (!s) return true;
  if ((shared(REFRESH) ?? 0) > s.at) return true;
  const busy = s.jobs.some((j) => j.status !== "completed");
  return now - s.at >= (busy ? BUSY_MS : IDLE_MS);
}

export function tick(cx) {
  const now = Date.now(), s = snapshot();
  if (!due(s, now) || (shared(LOCK) ?? 0) > now) return;
  setShared(LOCK, now + LOCK_MS);
  cx.spawn(async (cx) => {
    let next;
    try {
      next = await read(s, now);
    } catch (e) {
      next = { ...(s ?? { jobs: [], machines: [], done: {}, typical: {} }), at: now, error: String(e.message ?? e) };
    } finally {
      setShared(LOCK, 0);
    }
    announce(s, next, now);
    setShared(KEY, next);
    cx.notify();
  });
}

async function read(prev, now) {
  const config = await loadConfig();
  if (config.demo) return demoSnapshot(now);
  const fresh = (shared(REFRESH) ?? 0) > (prev?.at ?? 0);
  const loadDue = fresh || !prev || now - (prev.loadAt ?? 0) >= LOAD_MS;
  const [gh, ln, loads] = await Promise.all([
    loadJobs(config, prev?.done ?? {}, now),
    // The lanes runner is its own source: when it fails, GitHub's slots still show.
    config.lanes ? loadLanes(config.lanes, now).catch((e) => ({ error: String(e.message ?? e), lanes: {}, warm: {}, jobs: [] })) : null,
    loadDue ? Promise.all(config.machines.map((m) => (m.ssh ? machineLoad(m.ssh) : null))) : null,
  ]);
  const { done, runners } = gh, jobs = [...gh.jobs, ...(ln?.jobs ?? [])];
  const busyOn = new Map(jobs.filter((j) => j.status === "in_progress" && j.runner).map((j) => [j.runner, j.id]));
  const slot = (name) => ({
    name, label: name, job: busyOn.get(name) ?? null,
    status: runners[name]?.status ?? (busyOn.has(name) ? "online" : "unknown"),
  });
  // A machine's lanes are the ones the status command reports for its name.
  const laneSlots = (key) => Object.entries(ln?.lanes ?? {}).filter(([name]) => name.startsWith(`${key} `)).map(([name, l]) => ({
    name, label: `${name.slice(key.length + 1)} lane`, job: busyOn.get(name) ?? null,
    status: l.state === "unreachable" ? "offline" : "online",
  }));
  const machines = config.machines.map((m, i) => {
    const old = prev?.machines?.find((p) => p.name === m.name);
    const l = loads ? loads[i] : old;
    const lanes = m.lanes ? laneSlots(m.lanes) : [];
    return { name: m.name, ssh: m.ssh ?? null, load: l?.load ?? null, cores: l?.cores ?? null, loadError: l?.error ?? l?.loadError ?? null,
      warm: m.lanes ? ln?.warm[m.lanes] ?? null : null, runners: [...lanes, ...(m.runners ?? []).map(slot)] };
  });
  // A slot no machine lists still shows, so a new runner is never invisible.
  const listed = new Set(machines.flatMap((m) => m.runners.map((r) => r.name)));
  const extra = [...new Set([...Object.keys(runners), ...gh.jobs.map((j) => j.runner).filter(Boolean)])].filter((n) => !listed.has(n) && !n.startsWith("GitHub Actions"));
  if (extra.length) machines.push({ name: config.machines.length ? "Other runners" : "Runners", ssh: null, load: null, cores: null, loadError: null, warm: null, runners: extra.map(slot) });

  // How long each job usually takes, from the last two hours, kept across restarts.
  const typical = { ...(prev?.typical ?? {}) }, groups = {};
  for (const j of jobs) if (j.status === "completed" && j.conclusion === "success" && j.started && j.completed) (groups[jobKey(j)] ??= []).push(j.completed - j.started);
  for (const [k, list] of Object.entries(groups)) typical[k] = median(list);

  const waiting = new Set(jobs.filter((j) => j.status === "queued").map((j) => j.id));
  const alerted = (prev?.alerted ?? []).filter((id) => waiting.has(id));
  return { at: now, loadAt: loadDue ? now : prev.loadAt, error: ln?.error ?? null, missing: Boolean(config.missing), jobs, done, machines, typical, alerted,
    alertAfter: config.waitAlertMinutes * 60000 };
}

// Toasts: a job waiting too long (once each), a slot that drops offline.
function announce(prev, next, now) {
  if (!prev || next.demo) return;
  for (const j of next.jobs) {
    if (j.status !== "queued" || next.alerted.includes(j.id) || now - j.created < next.alertAfter) continue;
    next.alerted.push(j.id);
    notify({ title: `Waiting ${Math.round((now - j.created) / 60000)}m for a runner`, body: `${j.short} · ${label(j)} · ${j.branch} · needs ${j.labels.join(", ")}`, level: "warning", timeout: 10000 });
  }
  const was = new Map(prev.machines.flatMap((m) => m.runners.map((r) => [r.name, r.status])));
  for (const m of next.machines) for (const r of m.runners) {
    if (r.status === "offline" && was.get(r.name) === "online") notify({ title: `${r.name} went offline`, body: `${m.name} · its jobs wait for another slot`, level: "error" });
  }
}
