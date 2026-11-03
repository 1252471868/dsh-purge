import fs from "node:fs";
import path from "node:path";

/** Resolve the outer app, including when execPath is an Electron Helper app. */
export function macAppBundle(exe) {
  const normalized = String(exe || "").replace(/\\/g, "/");
  const match = normalized.match(/^(.*?\.app)\/Contents\//i);
  return match ? match[1] : "";
}

/** A standalone Node helper survives quitting Electron and its helper processes. */
export function restartHelperExecutable(exe, input = {}) {
  const platform = input.platform ?? process.platform;
  const current = input.execPath ?? process.execPath;
  if (platform !== "darwin") return current;
  const bundle = macAppBundle(exe);
  const node = bundle && path.join(bundle, "Contents", "Resources", "runtime",
    "primary-runtime", "dependencies", "node", "bin", "node");
  if (node) {
    try { fs.accessSync(node, fs.constants.X_OK); return node; } catch { /* older bundle */ }
  }
  if (/^node(?:js)?$/.test(path.basename(current))) return current;
  // Use the main executable, never Electron Helper (Plugin).app.
  return exe || current;
}

export function macRelaunchArgs(exe, argv = []) {
  const bundle = macAppBundle(exe);
  if (!bundle) return null;
  return ["-a", bundle, ...(argv.length ? ["--args", ...argv] : [])];
}

/** Shell-free argv prevents app names containing quotes from becoming AppleScript. */
export function macQuitArgs(exe) {
  const bundle = macAppBundle(exe);
  if (!bundle) return null;
  return ["-e", "on run argv", "-e", "set targetApp to item 1 of argv",
    "-e", "if application targetApp is running then tell application targetApp to quit",
    "-e", "end run", bundle];
}
