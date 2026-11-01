// The parts of Herdr's `herdr` module the data code uses, in memory, for tests.
export const state = { shared: new Map(), files: new Map(), notes: [], exec: async () => ({ code: 0, stdout: "", stderr: "" }) };
export const exec = (cmd, args, opts) => state.exec(cmd, args, opts);
export const shared = (k) => state.shared.get(k);
export const setShared = (k, v) => state.shared.set(k, v);
export const notify = (n) => state.notes.push(n);
export const appHome = () => "/home/test/.config/herdr-app";
export const readTextFile = async (p) => state.files.get(p) ?? null;
