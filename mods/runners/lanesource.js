// A lock-based job runner of your own (a script that takes a lane lock on a build machine over ssh),
// read through its `status` command and, optionally, a history file of finished jobs.
//
// Status output, one line each (the format `scripts/run-on-mini.sh status`-style runners print):
//   <machine> <lane>: free | busy (no details) | unreachable
//   <machine> <lane>: <lane> <job> args: <args> branch: <branch> commit: <sha> worktree: <dir> <secs>s logs: <path>
//   <machine> warm: <free text shown under the machine>
//   Waiting callers:
//     waiting: <lane> <job> args: ... (same fields as a running job)
//     joined: ...                       (callers that wait for an identical job; not counted as waiting)
// History: JSON lines with { token, job, lane, host, branch, worktree, commit, args, outcome, logs,
//   times: { request, lock, end } } (epoch seconds); "host" maps to a machine through "hosts".
import { exec, readTextFile } from "herdr";

const INFO = /^(\S+) (\S+) args: (.*?) branch: (.*?) commit: (\S*) worktree: (.*?) (\d+)s logs: (.*)$/;
const HISTORY_LINES = 400, KEEP = 2 * 3600000;

const slotName = (machine, lane) => `${machine} ${lane}`;

function job(cfg, fields) {
  const { lane, kind, args, branch, commit, worktree, logs } = fields;
  return {
    id: `ln-${logs || `${lane}-${branch}-${commit}`}`, source: "lanes", key: `${cfg.short}:lanes:${kind}:${lane}`,
    repo: cfg.name ?? cfg.short, short: cfg.short, color: cfg.color, workflow: kind, name: args.trim(), title: "",
    branch, worktree, commit, logs: logs || null, labels: [`${lane} lane`], url: null,
    runner: null, status: "queued", conclusion: null, created: null, started: null, completed: null,
  };
}

function parseInfo(cfg, text, now) {
  const m = INFO.exec(text.trim());
  if (!m) return null;
  const [, lane, kind, args, branch, commit, worktree, secs, logs] = m;
  return { j: job(cfg, { lane, kind, args, branch, commit, worktree, logs }), since: now - Number(secs) * 1000 };
}

// { lanes: { "<machine> <lane>": { state, job } }, warm: { machine: text }, jobs }.
export function parseStatus(cfg, out, now) {
  const lanes = {}, warm = {}, jobs = [];
  for (const line of out.split("\n")) {
    let m;
    if ((m = /^ {2}(waiting|joined): (.*)$/.exec(line))) {
      const info = parseInfo(cfg, m[2], now);
      if (info) jobs.push({ ...info.j, status: m[1] === "waiting" ? "queued" : "joined", created: info.since });
    } else if ((m = /^(\S+) warm: (.*)$/.exec(line))) {
      warm[m[1]] = m[2].trim();
    } else if ((m = /^(\S+) (\S+): (.*)$/.exec(line))) {
      const [, machine, lane, rest] = m, name = slotName(machine, lane), info = parseInfo(cfg, rest, now);
      if (info) {
        jobs.push({ ...info.j, status: "in_progress", runner: name, started: info.since, created: info.since });
        lanes[name] = { state: "busy", job: info.j.id };
      } else lanes[name] = { state: rest === "free" ? "free" : rest === "unreachable" ? "unreachable" : "busy", job: null };
    }
  }
  return { lanes, warm, jobs };
}

// Finished jobs of the last two hours (one JSON record per line, newest last).
export function parseHistory(cfg, text, now) {
  const jobs = [], hosts = cfg.hosts ?? {};
  for (const line of (text ?? "").split("\n").slice(-HISTORY_LINES)) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const t = r?.times;
    if (!t?.lock || !t.end || now - t.end * 1000 > KEEP) continue;
    const machine = r.host ? hosts[r.host] ?? r.host : "local";
    const j = job(cfg, { lane: r.lane, kind: r.job, args: r.args ?? "", branch: r.branch ?? "", commit: r.commit ?? "", worktree: r.worktree ?? "", logs: r.logs });
    jobs.push({ ...j, id: `ln-${r.token}`, status: "completed", runner: slotName(machine, r.lane),
      conclusion: r.outcome === "pass" ? "success" : r.outcome === "fail" ? "failure" : "cancelled",
      created: t.request * 1000, started: t.lock * 1000, completed: t.end * 1000 });
  }
  return jobs;
}

// { lanes, warm, jobs } now. A running job that already has a history record is the same job finishing.
export async function loadLanes(cfg, now) {
  const [cmd, ...args] = cfg.command;
  const [status, history] = await Promise.all([
    exec(cmd, args, { cwd: cfg.cwd }).catch((e) => ({ code: -1, stdout: "", stderr: String(e) })),
    cfg.history ? readTextFile(cfg.history).catch(() => null) : null,
  ]);
  if (status.code !== 0) throw new Error(`${cfg.name ?? "lanes"} status: ${(status.stderr || `exit ${status.code}`).trim().split("\n")[0]}`);
  const live = parseStatus(cfg, status.stdout, now), done = parseHistory(cfg, history, now);
  const finishedLogs = new Set(done.map((j) => j.logs).filter(Boolean));
  return { ...live, jobs: [...live.jobs.filter((j) => !(j.logs && finishedLogs.has(j.logs))), ...done] };
}
