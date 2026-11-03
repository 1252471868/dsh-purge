import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicWriteSync, atomicWriteFile, applyReplacementsToText, ALL_PATCHES, applyPatches } from "../lib/core.js";
import { patchOfficialCliShimText, resourcesDirForExecutable, findDesktopAppExecutable, stageCleanupRestartHelper } from "../lib/desktop.js";
import { macAppBundle, macQuitArgs, macRelaunchArgs, restartHelperExecutable } from "../lib/macos.js";
import { hostFs, extractAsar, readAsarJson, renameAsarAside } from "../lib/extract-asar.js";
import { rewritePromptAssembly } from "../lib/identity.js";
import { sealObjectSchemas } from "../lib/tool-schema.js";
import { ensureProfileBodyInsert, ensureProfileBundles } from "../lib/profile-insert.js";
import { versionSupported } from "../lib/compatibility.js";
import { REPO } from "../lib/update.js";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("atomic writes preserve executable and private file modes", async (t) => {
  const dir = fixture(t);
  for (const mode of [0o755, 0o700, 0o600]) {
    const file = path.join(dir, String(mode));
    fs.writeFileSync(file, "original", { mode });
    atomicWriteSync(file, "sync");
    assert.equal(fs.statSync(file).mode & 0o777, mode);
    await atomicWriteFile(file, Buffer.from("async"));
    assert.equal(fs.statSync(file).mode & 0o777, mode);
    assert.equal(fs.readFileSync(file, "utf8"), "async");
  }
});

test("hostFs descriptor operations work without treating fd as a pathname", (t) => {
  const file = path.join(fixture(t), "file");
  const fd = hostFs.openSync(file, "w+");
  try {
    hostFs.writeSync(fd, Buffer.from("abc"));
    hostFs.fsyncSync(fd);
    assert.equal(hostFs.fstatSync(fd).size, 3);
    const bytes = Buffer.alloc(3);
    hostFs.readSync(fd, bytes, 0, 3, 0);
    assert.equal(bytes.toString(), "abc");
  } finally { hostFs.closeSync(fd); }
});

test("Mac helpers resolve the outer app and use the independent bundled Node", (t) => {
  const bundle = path.join(fixture(t), '应用 空格 "quoted".app');
  const exe = path.join(bundle, "Contents/MacOS/DeepSeek Harness");
  const helper = path.join(bundle, "Contents/Frameworks/DeepSeek Harness Helper.app/Contents/MacOS/Helper");
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, "", { mode: 0o755 });
  const node = path.join(bundle, "Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node");
  fs.mkdirSync(path.dirname(node), { recursive: true });
  fs.writeFileSync(node, "", { mode: 0o755 });
  assert.equal(macAppBundle(helper), bundle);
  assert.equal(resourcesDirForExecutable(exe), path.join(bundle, "Contents/Resources"));
  assert.equal(findDesktopAppExecutable({ execPath: helper, resourcesPath: "", argv: [], env: {} }), exe);
  assert.equal(restartHelperExecutable(exe, { platform: "darwin", execPath: helper }), node);
  assert.deepEqual(macRelaunchArgs(exe, ["--updated"]), ["-a", bundle, "--args", "--updated"]);
  const args = macQuitArgs(exe);
  assert.equal(args.at(-1), bundle);
  assert(!args.slice(0, -1).some((arg) => arg.includes(bundle)));
  assert.equal(restartHelperExecutable(exe, { platform: "win32", execPath: "node.exe" }), "node.exe");
});

test("shell CLI chooses the ASAR before unpack and the directory after unpack", (t) => {
  const dir = fixture(t);
  const resources = path.join(dir, "目录 with spaces");
  fs.mkdirSync(path.join(resources, "app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib"), { recursive: true });
  const source = 'resources="$1"\nprintf "%s\\n" "$resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"\n';
  // Include the official launcher's anchor but replace execution with printf.
  const launcher = source.replace('printf ', 'ELECTRON_RUN_AS_NODE=1 printf ');
  const patched = patchOfficialCliShimText(launcher).text;
  assert.equal(patchOfficialCliShimText(patched).text, patched);
  const script = path.join(dir, "dsh");
  fs.writeFileSync(script, patched);
  const run = () => {
    const r = spawnSync("/bin/sh", [script, resources], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const asar = path.join(resources, "app.asar");
  fs.writeFileSync(asar, "archive");
  assert.equal(run(), path.join(asar, "dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"));
  fs.unlinkSync(asar);
  const unpacked = path.join(resources, "app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js");
  fs.writeFileSync(unpacked, "");
  assert.equal(run(), unpacked);
});

test("Mac quit AppleScript compiles without executing an application event", { skip: process.platform !== "darwin" }, (t) => {
  const output = path.join(fixture(t), "quit.scpt");
  const args = macQuitArgs('/Applications/Quoted "Name".app/Contents/MacOS/App').slice(0, -1);
  const result = spawnSync("/usr/bin/osacompile", ["-o", output, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("uninstall helper loads after being staged outside the plugin directory", (t) => {
  const helper = stageCleanupRestartHelper(path.join(fixture(t), "uninstall"));
  // No restart payload: load imports, then stop before any process or file action.
  const result = spawnSync(process.execPath, [helper], {
    env: { ...process.env, DSH_PURGE_RESTART: "" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
});

function writeAsar(file, files, contents = "") {
  const json = Buffer.from(JSON.stringify({ files }));
  const headerSize = 8 + json.length;
  const header = Buffer.alloc(16);
  header.writeUInt32LE(4, 0); header.writeUInt32LE(headerSize, 4);
  header.writeUInt32LE(json.length + 4, 8); header.writeUInt32LE(json.length, 12);
  fs.writeFileSync(file, Buffer.concat([header, json, Buffer.from(contents)]));
}

test("ASAR extraction preserves executable mode and root-relative links", (t) => {
  const dir = fixture(t); const asar = path.join(dir, "app.asar");
  const metadata = '{"version":"0.2.1-rc.2"}';
  writeAsar(asar, {
    "package.json": { offset: "0", size: metadata.length },
    bin: { files: { run: { offset: String(metadata.length), size: 3, executable: true } } },
    nested: { files: { link: { link: "bin/run" } } },
  }, metadata + "run");
  assert.equal(readAsarJson(asar).version, "0.2.1-rc.2");
  const dest = path.join(dir, "out"); extractAsar(asar, dest);
  assert.equal(fs.statSync(path.join(dest, "bin/run")).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(dest, "nested/link"), "utf8"), "run");
  writeAsar(asar, { "../escape": { offset: "0", size: 3 } }, "bad");
  assert.throws(() => extractAsar(asar, dest), /escapes/);
  assert(!fs.existsSync(path.join(dir, "escape")));
  fs.symlinkSync(dir, path.join(dest, "outside"), "dir");
  writeAsar(asar, { outside: { files: { created: { files: { file: { offset: "0", size: 3 } } } } } }, "bad");
  assert.throws(() => extractAsar(asar, dest), /symlink/);
  assert(!fs.existsSync(path.join(dir, "created")));
});

test("repeated ASAR swaps preserve every original backup", (t) => {
  const asar = path.join(fixture(t), "app.asar");
  fs.writeFileSync(asar, "first"); const first = renameAsarAside(asar);
  fs.writeFileSync(asar, "second"); const second = renameAsarAside(asar);
  assert.notEqual(first.bak, second.bak);
  assert.equal(fs.readFileSync(first.bak, "utf8"), "first");
  assert.equal(fs.readFileSync(second.bak, "utf8"), "second");
});

test("0.2.1 cwd templates retain literal paths and host assembly metadata", () => {
  const input = { sections: [{ name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}." }],
    contexts: [], tools: [], variables: { provider: "test" }, toolFilter: { mode: "all" } };
  const copy = structuredClone(input);
  const result = rewritePromptAssembly(input, "Prompt in [cwd]", { capabilityProtocol: false,
    context: { agent: { session: { header: { cwd: "/Users/test/项目 $&" } } } } });
  assert.deepEqual(input, copy);
  assert.equal(result.toolFilter, input.toolFilter);
  assert.equal(result.variables.cwd, "/Users/test/项目 $&");
  assert(result.sections.some((s) => s.text === "Your working directory is /Users/test/项目 $&." && s.interpolate === false));
  const fallback = rewritePromptAssembly(input, "test", { capabilityProtocol: false });
  assert(!fallback.sections.some((s) => s.text.includes("{{cwd}}")));
  const moved = rewritePromptAssembly(result, "test", { capabilityProtocol: false,
    context: { session: { header: { cwd: "/new/workspace" } } } });
  assert(moved.sections.some((s) => s.text === "Your working directory is /new/workspace."));
});

test("nested object schemas become explicit without changing defaults or existing choices", () => {
  const original = { type: "array", items: { type: "object", properties: {
    free: { type: "object", additionalProperties: true }, value: { type: "object" },
  }, default: { type: "object", arbitrary: 1 } } };
  const fixed = sealObjectSchemas(original);
  assert.equal(fixed.items.additionalProperties, false);
  assert.equal(fixed.items.properties.free.additionalProperties, true);
  assert.equal(fixed.items.properties.value.additionalProperties, true);
  assert.deepEqual(fixed.items.default, original.items.default);
  assert.equal(original.items.additionalProperties, undefined);
});

test("profile installer handles empty YAML and preserves unrelated bundles", (t) => {
  const dir = fixture(t);
  const pkg = { name: "dsh-profile-desktop", dependencies: { existing: "1" },
    dsh: { profile: { bundles: ["existing"], patchReload: "live" } } };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  fs.writeFileSync(path.join(dir, "cordis.patch.yml"), "# keep\n[]\n");
  assert(ensureProfileBodyInsert(dir).wrote);
  assert(!ensureProfileBodyInsert(dir).wrote);
  assert(ensureProfileBundles(dir).wrote);
  assert(!ensureProfileBundles(dir).wrote);
  const after = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.deepEqual(after.dependencies, pkg.dependencies);
  assert.equal(after.dsh.profile.patchReload, "live");
  assert.deepEqual(after.dsh.profile.bundles, ["existing", "dsh-purge"]);
  assert(fs.readFileSync(path.join(dir, "cordis.patch.yml"), "utf8").startsWith("# keep\n- insert:"));
  fs.writeFileSync(path.join(dir, "cordis.patch.yml"), "custom: true\n");
  assert.equal(ensureProfileBodyInsert(dir).ok, false);
  assert.equal(fs.readFileSync(path.join(dir, "cordis.patch.yml"), "utf8"), "custom: true\n");
});

test("unverified newer hosts fail before creating backups or writing packages", async (t) => {
  const base = fixture(t); const pkg = path.join(base, "dsh-system-prompt");
  fs.mkdirSync(pkg); fs.writeFileSync(path.join(pkg, "package.json"), '{"version":"0.2.2-alpha.3"}');
  assert(versionSupported("0.2.1-rc.2")); assert(versionSupported("0.2.1-rc.5"));
  assert(!versionSupported("0.2.2-alpha.3"));
  await assert.rejects(applyPatches(base), /尚未适配/);
  assert.deepEqual(fs.readdirSync(pkg), ["package.json"]);
});

test("interacting hook patches are stable on the second Apply", () => {
  const patches = [30, 65].map((id) => ALL_PATCHES.find((p) => p.id === id));
  const apply = (text) => patches.reduce((value, p) => applyReplacementsToText(value, p).text, text);
  const once = apply('\t\tif (merged.decision === "deny") return { kind: "reject" };');
  assert.equal(apply(once), once);
});

test("installation and update metadata stay on the user's fork", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(REPO, "1252471868/dsh-purge");
  for (const url of Object.values(pkg.dsh.install).filter((s) => s.startsWith("https:"))) assert(url.includes(REPO));
});
