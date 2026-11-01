// One read of the runners: slots and their jobs from GitHub (`gh api`), load over ssh.
// Finished runs never change, so their jobs are read once and handed back in `done` for the next read.
import { exec } from "herdr";

const HOUR = 3600000, KEEP = 2 * HOUR;
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
// Jobs of finished runs read per repo per poll: the first read after a start catches up over a few polls.
const BACKFILL = 8;

async function run(cmd, args) {
  let r = await exec(cmd, args).catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
  // Apps started from the Dock can miss Homebrew on PATH: try its arm64 prefix.
  if (r.code === -1 && cmd === "gh") r = await exec("/opt/homebrew/bin/gh", args).catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
  return r;
}

async function api(path, jq) {
  const r = await run("gh", ["api", path, "--jq", jq]);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || "").trim().split("\n")[0];
    const err = new Error(/auth login|not logged/i.test(msg) ? "Run gh auth login first" : msg || `gh exit ${r.code}`);
    err.notFound = /HTTP 404|Not Found/.test(msg);
    throw err;
  }
  return r.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const RUN_JQ = ".workflow_runs[] | {id, workflow: .name, title: .display_title, status, branch: .head_branch, updated: .updated_at}";
const JOB_JQ = ".jobs[] | {id, name, status, conclusion, labels, runner: .runner_name, created: .created_at, started: .started_at, completed: .completed_at, url: .html_url}";

const time = (s) => (s ? Date.parse(s) : null);

function job(repo, r, j) {
  return {
    id: j.id, repo: repo.repo, short: repo.short, color: repo.color,
    workflow: r.workflow, title: r.title, branch: r.branch, name: j.name,
    status: j.status, conclusion: j.conclusion, labels: j.labels ?? [], runner: j.runner || null,
    created: time(j.created), started: time(j.started), completed: time(j.completed), url: j.url,
  };
}

// The repo's recent runs, then the jobs of each that runs now or finished lately and wasn't read before.
async function repoJobs(repo, done, now, isWatched) {
  const runs = await api(`repos/${repo.repo}/actions/runs?per_page=30`, RUN_JQ);
  const active = [], fresh = [];
  for (const r of runs) {
    if (ACTIVE.has(r.status)) active.push(r);
    else if (now - time(r.updated) < KEEP) fresh.push(r);
  }
  const todo = [...active, ...fresh.filter((r) => !done[r.id]).slice(0, BACKFILL)];
  const read = await Promise.all(todo.map(async (r) => [r, await api(`repos/${repo.repo}/actions/runs/${r.id}/jobs?per_page=100`, JOB_JQ)]));
  const jobs = [], newDone = {};
  // Finished runs read before still count, until they leave the two-hour window.
  for (const r of fresh) if (done[r.id]) newDone[r.id] = done[r.id];
  for (const [r, list] of read) {
    const mine = list.map((j) => job(repo, r, j)).filter(isWatched);
    if (ACTIVE.has(r.status)) jobs.push(...mine);
    else newDone[r.id] = { at: time(r.updated), jobs: mine };
  }
  for (const d of Object.values(newDone)) jobs.push(...d.jobs);
  return { jobs, done: newDone };
}

// { name: { status: "online" | "offline", busy } } for the repo, or null when the account can't list them.
async function repoRunners(repo) {
  try {
    const list = await api(`repos/${repo.repo}/actions/runners?per_page=100`, ".runners[] | {name, status, busy}");
    return Object.fromEntries(list.map((r) => [r.name, r]));
  } catch (e) {
    if (e.notFound) return null; // not a repo admin: busy comes from the jobs, online stays unknown
    throw e;
  }
}

// "{ 15.68 24.77 25.57 }\n8" from sysctl: the 1-minute load and the core count.
export async function machineLoad(host) {
  const r = await run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-T", "--", host, "sysctl -n vm.loadavg hw.ncpu"]);
  if (r.code !== 0) {
    const msg = (r.stderr || "").trim().split("\n").pop() ?? "";
    return { error: /Permission denied/.test(msg) ? "ssh key refused" : /resolve|timed out|No route/i.test(msg) ? "unreachable" : msg || `ssh exit ${r.code}` };
  }
  const [avg, cores] = r.stdout.trim().split("\n");
  const one = Number(/[\d.]+/.exec(avg)?.[0]);
  return { load: one, cores: Number(cores) || null };
}

export async function loadJobs(config, done, now) {
  const labels = new Set(config.labels);
  const known = new Set(config.machines.flatMap((m) => m.runners ?? []));
  const isWatched = (j) => j.labels.some((l) => l === "self-hosted" || labels.has(l)) || known.has(j.runner);
  const parts = await Promise.all(config.repos.map(async (repo) => {
    const [jobs, runners] = await Promise.all([repoJobs(repo, done, now, isWatched), repoRunners(repo)]);
    return { repo, ...jobs, runners };
  }));
  return {
    jobs: parts.flatMap((p) => p.jobs),
    done: Object.assign({}, ...parts.map((p) => p.done)),
    runners: Object.assign({}, ...parts.map((p) => p.runners ?? {})),
  };
}
