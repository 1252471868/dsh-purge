# macOS compatibility — 1.1.72-macos.1

Working repository: [1252471868/dsh-purge](https://github.com/1252471868/dsh-purge).
This is an incremental update to the 1.1.71 fork. Its original prompt assets,
presets and skill library are retained. The reference repository is not the
installation or update source.

## Verified scope (2026-11-03)

| DSH version | Evidence | Status |
| --- | --- | --- |
| 0.2.1-rc.2, macOS arm64 | Installed official ASAR; 67 of 82 patches transform source, 53 changed files pass JavaScript syntax and repeat-Apply checks; 56 tools register through the real host API | Source and API checks pass; GUI, Apply/restart and model responses have not been tested |
| 0.2.1-rc.5 | 44 official npm packages; 64 of 77 applicable patches transform source, 51 changed files pass syntax and repeat-Apply checks | Host package compatibility checked; desktop app binary not tested |
| 0.2.2-alpha.3 | Official npm packages; required complete-prompt patch #40 no longer matches; other APIs also changed | Unsupported; Apply is blocked before modifying this host |
| 0.2.0 family | Original fork's supported line | Retained, not retested in this port |

Absent optional packages and older reversal patches need not transform files.
Match counts are not a claim that every feature works. No Windows or Intel Mac
runtime test was performed. The official [release list](https://github.com/deepseek-ai/deepseek-harness/releases)
was checked; alpha.3 is newer than rc.5 and is deliberately not called compatible.

## Install this local fork on Mac

1. From this checkout, run the read-only check (about 10 seconds):

   ```sh
   npm run check:compat -- --app "/Applications/DeepSeek Harness.app"
   ```

   A nonstandard application location can be supplied with `--app`. The command
   extracts into a temporary directory, simulates patches, checks syntax and
   repeats the patches. It does not write the installed app or your DSH profile.
   `node bin/dsh-purge.js --check` runs the same check.

2. Install the checkout into the desktop profile only:

   ```sh
   dsh plugin --profile desktop add "$PWD"
   ```

   Run that command from this repository, not its parent folder. Use this local
   checkout until the compatibility branch has been pushed to your fork. Do not
   use the upstream marketplace entry, the unscoped npm name, or the reference
   repository's download URL. Use profile `web` only when installing for `dsh web`.

3. Ensure registration, including when pnpm skipped the install hook:

   ```sh
   node scripts/ensure-profile-bundle.mjs --profile-dir "${DSH_HOME:-$HOME/.dsh}/profiles/desktop"
   ```

   This adds the bundle and one main plugin insertion, preserving other entries.
   Existing edited profile files are copied to timestamped
   `.dsh-purge-install-*.bak` siblings first. Repeating registration is a no-op.
   An unrecognized YAML document is left unchanged and reported as an error.

4. Fully quit and reopen DeepSeek Harness. Open **dsh-purge → 清洗 / Clean**.
   Review the status before choosing **应用 / Apply**. Apply unpacks and modifies
   `.app` resources and restarts the host; those modifications invalidate the
   vendor's original resource signature. This port does not re-sign the app or
   remove quarantine attributes. A full original `.app` copy is the most complete
   rollback for a first installation trial.

5. After Apply and restart, open a new session and run `/purge status`. Confirm
   the reported home and desktop installation are the intended ones. This final
   interactive verification remains to be performed on the installed app.

## What changed

- Preserve POSIX executable/private modes when replacing files atomically.
  Make CLI backup writes synchronous and select real ASAR files correctly from
  the shell launcher, both before and after extraction.
- Resolve outer `.app` bundles and their `Contents/Resources` directories,
  including Electron helper paths. Restart using the standalone Node bundled
  with DSH; address quit/relaunch by exact app path and preserve launch arguments.
- Preserve executable flags and archive-root-relative symlinks during ASAR
  extraction; reject paths escaping the extraction directory. File descriptor
  operations use the disk API without path probing.
- Port selected rc.2/rc.5 source anchors, retain steer behavior, avoid duplicate
  insertions on repeated Apply, preserve workspace literals without an unknown
  `{{cwd}}` variable, and normalize nested schemas for the current tools API.
- Register the body once through the profile install hook; keep updates and
  package download metadata on `1252471868/dsh-purge`. Block unverified host
  versions and provide a read-only compatibility command.

## Development checks

```sh
npm test
npm run check:compat
# Check a separately downloaded official package tree:
node scripts/check-compat.mjs --base "/path/to/node_modules/@deepseek-ai"
```

The test suite was also run with the installed app's bundled Node v24.21.0.
Official rc.2 `--dump-config` completed with exactly one main `dsh-purge` body
entry in an isolated profile. It emitted existing legacy-entry warnings; no
duplicate-queue error occurred. The real rc.2 prompt renderer accepted the
rewritten workspace path and preserved assembly metadata.

## Reference and attribution

Original author: YuJunZhiXue. Selected compatibility patterns and profile
registration helpers were adapted from
[commit 217d60d3d61881079ea95bbe2c174f338a02182b](https://github.com/YuJunZhiXue/dsh-purge/commit/217d60d3d61881079ea95bbe2c174f338a02182b).
The fork's original MIT [LICENSE](../LICENSE) remains. The incorporated newer
portions retain their [Apache-2.0 license](upstream-compat-LICENSE) and
[NOTICE](upstream-compat-NOTICE); the package metadata reflects both licenses.
