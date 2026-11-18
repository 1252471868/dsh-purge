import path from "node:path";
import { hostFs, readAsarJson } from "./extract-asar.js";

export const CHECKED_HOST_VERSIONS = Object.freeze(["0.2.1-rc.2", "0.2.1-rc.5"]);

export function hostVersion(aiBase, asar) {
  if (asar) return readAsarJson(asar).version || "";
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
  const version = hostVersion(aiBase, asar);
  if (!versionSupported(version)) {
    throw new Error(`DSH ${version || "unknown"} 的宿主补丁尚未适配。已验证的预发布版本为 ${CHECKED_HOST_VERSIONS.join("、")}。`);
  }
  return version;
}
