import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// `herdr` exists only inside the app: point it at the in-memory stub.
const stub = new URL("./herdr-stub.mjs", import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => (spec === "herdr" ? { url: stub, shortCircuit: true } : next(spec, ctx)) });
const { state } = await import("./herdr-stub.mjs");
const poll = await import("../mods/runners/poll.js");
const model = await import("../mods/runners/model.js");
const lanes = await import("../mods/runners/lanesource.js");

const MIN = 60000, now = Date.UTC(2026, 10, 1, 12);
const CONFIG = "/home/test/.config/herdr-app/runners.json";
const read = async () => {
  state.shared.clear();
  const cx = { spawn: (f) => f(cx), notify() {} };
  await poll.tick(cx);
  for (let i = 0; i < 100 && !poll.snapshot(); i++) await new Promise((r) => setTimeout(r, 5));
  return poll.snapshot();
};

test("without a config the panel asks for one and reads nothing", async () => {
  state.files.clear();
  const calls = [];
  state.exec = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  const s = await read();
  assert.equal(s.error, null);
  assert.equal(s.missing, true);
  assert.deepEqual(calls, []);
});

test("demo mode needs no programs and fills every view", async () => {
  state.files.set(CONFIG, JSON.stringify({ demo: true }));
  state.exec = async () => { throw new Error("demo must not run programs"); };
  const s = await read();
  assert.equal(s.demo, true);
  assert.ok(model.waiting(s).length > 0 && model.running(s).length > 0);
  const p = model.plan(s, Date.now());
  assert.equal(p.unplaced.length, 0);
});

test("GitHub jobs, runner status, lanes and ssh load make one snapshot", async () => {
  state.files.set(CONFIG, JSON.stringify({
    repos: [{ repo: "acme/web", short: "WEB" }],
    machines: [{ name: "Build 1", ssh: "me@build-1", lanes: "b1", runners: ["web-1"] }],
    lanes: { name: "game", short: "GAME", command: ["status-cmd"], cwd: "/repo" },
  }));
  const t = new Date(Date.now() - 3 * MIN).toISOString();
  state.exec = async (cmd, args) => {
    if (cmd === "gh" && args[1].endsWith("actions/runs?per_page=30")) return { code: 0, stdout: JSON.stringify({ id: 7, workflow: "CI", title: "x", status: "in_progress", branch: "main", updated: t }) + "\n", stderr: "" };
    if (cmd === "gh" && args[1].includes("/runs/7/jobs")) return { code: 0, stdout: [
      { id: 1, name: "e2e", status: "in_progress", labels: ["self-hosted"], runner: "web-1", created: t, started: t },
      { id: 2, name: "lint", status: "queued", labels: ["ubuntu-latest"], runner: null, created: t },
      { id: 3, name: "e2e", status: "queued", labels: ["self-hosted"], runner: null, created: t },
    ].map((j) => JSON.stringify(j)).join("\n"), stderr: "" };
    if (cmd === "gh" && args[1].includes("actions/runners")) return { code: 0, stdout: JSON.stringify({ name: "web-1", status: "online", busy: true }), stderr: "" };
    if (cmd === "ssh") return { code: 0, stdout: "{ 6.50 5.00 4.00 }\n8\n", stderr: "" };
    if (cmd === "status-cmd") return { code: 0, stdout: "b1 unity: free\nb1 core: core core args:  branch: main commit: abc worktree: w 30s logs: /tmp/l1\nWaiting callers:\n  waiting: unity build args:  branch: feat commit: def worktree: w2 10s logs: /tmp/l2\n", stderr: "" };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
  const s = await read();
  assert.equal(s.error, null);
  const m = s.machines[0];
  assert.deepEqual([m.load, m.cores], [6.5, 8]);
  assert.deepEqual(m.runners.map((r) => [r.label, r.status, Boolean(r.job)]),
    [["unity lane", "online", false], ["core lane", "online", true], ["web-1", "online", true]]);
  // ubuntu-latest is not watched; the self-hosted queued job and the lanes caller are.
  assert.deepEqual(model.waiting(s).map((j) => j.short).sort(), ["GAME", "WEB"]);
  assert.equal(model.running(s).length, 2);
});

test("lanes status and history parse into jobs", () => {
  const cfg = { name: "game", short: "GAME", hosts: { "build-1.local": "b1" } };
  const st = lanes.parseStatus(cfg, "b1 unity: unreachable\nb1 warm: idle 3 min\nlocal core: busy (no details)\nJoined callers:\n  joined: core core args:  branch: m commit: a worktree: w 5s logs: /tmp/j\n", now);
  assert.deepEqual(st.lanes, { "b1 unity": { state: "unreachable", job: null }, "local core": { state: "busy", job: null } });
  assert.equal(st.warm.b1, "idle 3 min");
  assert.equal(st.jobs[0].status, "joined");
  const sec = now / 1000;
  const h = lanes.parseHistory(cfg, [
    JSON.stringify({ token: "t1", job: "tests", lane: "unity", host: "build-1.local", outcome: "pass", times: { request: sec - 600, lock: sec - 500, end: sec - 400 } }),
    "not json",
    JSON.stringify({ token: "t2", job: "core", lane: "core", host: null, outcome: "skipped", times: { request: sec, lock: null, end: sec } }),
  ].join("\n"), now);
  assert.equal(h.length, 1);
  assert.equal(h[0].runner, "b1 unity");
  assert.equal(h[0].completed - h[0].started, 100000);
});

test("the plan puts waiting jobs on the slot of their pool that frees first", () => {
  const J = (o) => ({ repo: "o/g", short: "G", workflow: "tests", name: "", labels: ["g-ci"], branch: "b", ...o });
  const s = {
    typical: { "o/g:tests:": 3 * MIN },
    machines: [{ name: "A", runners: [{ name: "a", status: "online", job: 1 }, { name: "x", status: "offline", job: null }] },
               { name: "B", runners: [{ name: "b", status: "online", job: null }] }],
    jobs: [J({ id: 1, status: "in_progress", runner: "a", started: now - 2 * MIN, created: now - 3 * MIN }),
           J({ id: 2, status: "completed", conclusion: "success", runner: "b", started: now - 20 * MIN, completed: now - 17 * MIN }),
           J({ id: 3, status: "queued", created: now - 4 * MIN }), J({ id: 4, status: "queued", created: now - 2 * MIN }),
           J({ id: 5, status: "queued", labels: ["other"], created: now - MIN })],
  };
  const p = model.plan(s, now);
  assert.deepEqual(p.placed.map((x) => [x.job.id, x.slot, (x.start - now) / MIN]), [[3, "b", 0], [4, "a", 1]]);
  assert.deepEqual(p.unplaced.map((j) => j.id), [5]);
});
