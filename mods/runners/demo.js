// Made-up machines and jobs for screenshots and for trying the mod: "demo": true in runners.json.
const MIN = 60000;
const REPOS = {
  web: { repo: "acme/web", short: "WEB", color: "ansi6" },
  game: { repo: "acme/game", short: "GAME", color: "ansi5" },
  api: { repo: "acme/api", short: "API", color: "ansi3" },
};
const BRANCHES = ["main", "feat/checkout", "fix/login-flicker", "feat/level-7", "chore/deps"];

let seq = 0;
function job(r, workflow, name, runner, status, { created, started, completed, conclusion = "success", branch } = {}) {
  return { id: `demo-${++seq}`, ...REPOS[r], workflow, name, title: "", branch: branch ?? BRANCHES[seq % BRANCHES.length],
    labels: [`${r}-ci`], runner, status, conclusion: status === "completed" ? conclusion : null,
    created, started, completed, url: `https://github.com/${REPOS[r].repo}/actions` };
}

export function demoSnapshot(now) {
  seq = 0;
  const ago = (m) => now - m * MIN;
  const jobs = [
    job("game", "tests", "unity", "mini-1 unity", "in_progress", { created: ago(5), started: ago(4), branch: "feat/level-7" }),
    job("api", "CI", "integration", "api-mini-2", "in_progress", { created: ago(7), started: ago(6), branch: "fix/login-flicker" }),
    job("web", "CI", "e2e", "web-mini-1", "in_progress", { created: ago(3), started: ago(2.5), branch: "feat/checkout" }),
    job("game", "build", "", null, "queued", { created: ago(4.2), branch: "feat/level-7" }),
    job("web", "CI", "e2e", null, "queued", { created: ago(1.5), branch: "chore/deps" }),
  ];
  // A finished history: lanes busy most of the last 30 minutes.
  const done = [
    ["game", "tests", "unity", "mini-1 unity", 28, 24], ["game", "tests", "unity", "mini-1 unity", 22, 17],
    ["game", "build", "", "mini-2 unity", 26, 18, "failure"], ["game", "tests", "unity", "mini-2 unity", 15, 11],
    ["game", "sim", "pace", "mini-1 core", 29, 14], ["game", "sim", "pace", "mini-2 core", 12, 4],
    ["web", "CI", "e2e", "web-mini-1", 25, 16], ["web", "CI", "e2e", "web-mini-2", 20, 11], ["web", "CI", "e2e", "web-mini-1", 10, 4],
    ["api", "CI", "integration", "api-mini-2", 24, 13], ["api", "CI", "integration", "api-mini-1", 9, 1, "failure"],
  ];
  for (const [r, wf, name, runner, from, to, conclusion] of done) {
    jobs.push(job(r, wf, name, runner, "completed", { created: ago(from + 1), started: ago(from), completed: ago(to), conclusion }));
  }
  const busy = new Map(jobs.filter((j) => j.status === "in_progress").map((j) => [j.runner, j.id]));
  const slot = (name, label) => ({ name, label, status: "online", job: busy.get(name) ?? null });
  return {
    at: now, loadAt: now, error: null, missing: false, demo: true, jobs, done: {}, alerted: [], alertAfter: 5 * MIN,
    typical: { "acme/game:tests:unity": 5 * MIN, "acme/api:CI:integration": 10 * MIN, "acme/web:CI:e2e": 8 * MIN, "acme/game:build:": 7 * MIN },
    machines: [
      { name: "Build mini 1", ssh: "demo", load: 7.6, cores: 8, loadError: null, warm: null,
        runners: [slot("mini-1 unity", "unity lane"), slot("mini-1 core", "core lane"), slot("web-mini-1"), slot("api-mini-1")] },
      { name: "Build mini 2", ssh: "demo", load: 3.1, cores: 8, loadError: null, warm: null,
        runners: [slot("mini-2 unity", "unity lane"), slot("mini-2 core", "core lane"), slot("web-mini-2"), slot("api-mini-2")] },
    ],
  };
}
