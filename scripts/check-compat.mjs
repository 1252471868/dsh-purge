#!/usr/bin/env node
// Read-only host check. ASAR contents are extracted only into a temporary fixture.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractAsar } from "../lib/extract-asar.js";
import { versionSupported } from "../lib/compatibility.js";

export async function checkCompatibility({ app, base } = {}) {
  if (Boolean(app) === Boolean(base)) throw new Error("Specify exactly one of --app or --base");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-check-"));
  const saved = Object.fromEntries(["DSH_HOME", "DSH_SURFACE", "DSH_DESKTOP_INSTALL", "DSH_BASE"]
    .map((key) => [key, process.env[key]]));
  try {
    process.env.DSH_HOME = path.join(tmp, "home");
    process.env.DSH_SURFACE = app ? "desktop" : "web";
    delete process.env.DSH_BASE;
    delete process.env.DSH_DESKTOP_INSTALL;
    fs.mkdirSync(path.join(tmp, "home", "profiles", "desktop"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "home", "profiles", "desktop", "package.json"),
      '{"name":"dsh-profile-desktop"}');
    let allowed;
    if (app) {
      const bundle = path.join(tmp, "DeepSeek Harness.app");
      const dest = path.join(bundle, "Contents", "Resources", "app");
      const resources = path.join(path.resolve(app), "Contents", "Resources");
      const asar = path.join(resources, "app.asar");
      if (fs.existsSync(asar)) extractAsar(asar, dest);
      else fs.cpSync(path.join(resources, "app"), dest, { recursive: true });
      const exe = path.join(bundle, "Contents", "MacOS", "DeepSeek Harness");
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, "");
      process.env.DSH_DESKTOP_INSTALL = bundle;
      base = path.join(dest, "dsh", "node_modules", "@deepseek-ai");
      allowed = bundle;
    } else {
      base = path.resolve(base);
      allowed = base;
    }
    const core = await import("../lib/core.js");
    core.resetPathMemo();
    core.clearDesktopLocateCache();
    const files = core.targetFiles(base);
    const packageJson = JSON.parse(fs.readFileSync(path.join(base, "dsh-system-prompt", "package.json"), "utf8"));
    const texts = new Map();
    const originals = new Map();
    const report = [];
    const errors = [];
    const patches = core.ALL_PATCHES.filter((patch) => core.patchAppliesHere(patch));
    for (const patch of patches) {
      const paths = [...new Set((Array.isArray(patch.file) ? patch.file : [patch.file])
        .flatMap((key) => files[key] || []))];
      let changed = 0;
      for (const file of paths) {
        const relative = path.relative(allowed, file);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unexpected target outside fixture: ${file}`);
        if (!originals.has(file)) originals.set(file, fs.readFileSync(file, "utf8"));
        const text = texts.get(file) ?? originals.get(file);
        const next = core.applyReplacementsToText(text, patch, file);
        if (next.changed) { changed++; texts.set(file, next.text); }
      }
      report.push({ id: patch.id, name: patch.name, targets: paths.length, changed,
        status: paths.length ? (changed ? "matched" : "unchanged") : "absent" });
    }
    for (const [file, text] of texts) {
      if (/\.[cm]?js$/.test(file)) {
        const checked = spawnSync(process.execPath, ["--input-type=module", "--check"],
          { input: text, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
        if (checked.status !== 0) errors.push({ file: path.relative(allowed, file),
          error: checked.error?.message || checked.stderr.slice(0, 1200) });
      }
      let twice = text;
      for (const patch of patches) {
        const paths = (Array.isArray(patch.file) ? patch.file : [patch.file]).flatMap((key) => files[key] || []);
        if (paths.includes(file)) twice = core.applyReplacementsToText(twice, patch, file).text;
      }
      if (twice !== text) errors.push({ file: path.relative(allowed, file), error: "Second Apply changes the file again" });
    }
    // These patches are necessary for the plugin to keep prompts and its settings UI.
    for (const id of [4, 40, 42]) {
      const patch = patches.find((p) => p.id === id);
      const paths = (Array.isArray(patch.file) ? patch.file : [patch.file]).flatMap((key) => files[key] || []);
      if (!paths.length || !paths.some((file) => core.filePatchOutcome(texts.get(file) ?? originals.get(file), patch, file) === "applied")) {
        errors.push({ patch: id, error: "Required patch does not match this host" });
      }
    }
    const supported = versionSupported(packageJson.version);
    return { version: packageJson.version, surface: app ? "macOS desktop archive" : "published host packages",
      validation: "source transforms, JavaScript syntax and repeat Apply; no GUI or restart test",
      supported, ok: supported && errors.length === 0, patchCount: report.length, matched: report.filter((r) => r.changed).length,
      changedFiles: texts.size, absent: report.filter((r) => r.status === "absent").map((r) => r.id),
      unchanged: report.filter((r) => r.status === "unchanged").map((r) => r.id), errors, report };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
    const result = await checkCompatibility({
      app: value("--app") || (!args.includes("--base") && process.platform === "darwin" ? "/Applications/DeepSeek Harness.app" : undefined),
      base: value("--base"),
    });
    if (!args.includes("--json")) delete result.report;
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
