import path from "node:path";
import { hostFs, readAsarJson } from "./extract-asar.js";

export const CHECKED_HOST_VERSIONS = Object.freeze(["0.2.1-rc.2", "0.2.1-rc.5"]);

export function hostVersion(aiBase) {
  for (const name of ["dsh-system-prompt", "dsh"]) {
    try {
      return JSON.parse(hostFs.readFileSync(path.join(aiBase, name, "package.json"), "utf8")).version || "";
    } catch { /* next package */ }
  }
  return "";
}

export function versionSupported(version) {
  // Keep the fork's existing 0.2.0 support; newer builds need an explicit audit.
  return CHECKED_HOST_VERSIONS.includes(version) || /^0\.2\.0(?:-rc\.\d+)?$/.test(version);
}

export function assertSupportedHost({ aiBase, asar } = {}) {
  const version = asar ? readAsarJson(asar).version : hostVersion(aiBase);
  if (!versionSupported(version)) {
    throw new Error(`DSH ${version || "unknown"} 尚未适配，未写入宿主。已检查 rc.2 / rc.5；请先运行 npm run check:compat。`);
  }
  return version;
}
