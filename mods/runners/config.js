// What the mod watches. Everything comes from ~/.config/herdr-app/runners.json; nothing is built in.
//   { "repos": [{ "repo": "owner/name", "short": "APP", "color": "ansi6" }],
//     "machines": [{ "name": "Build mini", "ssh": "me@build-mini.local", "lanes": "build1", "runners": ["app-mini-1"] }],
//     "labels": ["app-ci"],
//     "lanes": { "name": "my-game", "short": "GAME", "command": ["bash", "scripts/run-on-mini.sh", "status"],
//                "cwd": "/path/to/repo", "history": "/path/to/repo/.git/runner-history.jsonl", "hosts": { "build-mini.local": "build1" } },
//     "waitAlertMinutes": 5 }
// A machine without "ssh" shows no load; "lanes" is its name in the lanes command's output.
// A job is watched when it asks for "self-hosted" or one of "labels", or runs on a listed runner.
// Runners no machine lists go under "Other runners".
import { readTextFile, appHome } from "herdr";

export const DEFAULTS = { repos: [], machines: [], labels: [], lanes: null, waitAlertMinutes: 5 };

export const configPath = () => `${appHome()}/runners.json`;

export async function loadConfig() {
  const text = await readTextFile(configPath()).catch(() => null);
  if (!text) return { ...DEFAULTS, missing: true };
  try {
    return { ...DEFAULTS, ...JSON.parse(text) };
  } catch {
    throw new Error(`${configPath()} is not valid JSON`);
  }
}
