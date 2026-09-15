#!/usr/bin/env node
// Stop hook (full check): runs lint + build (syntax) + length across the
// whole repo before the agent is allowed to finish. Reads the hook payload
// (including stop_hook_active) from stdin per Claude Code's Stop hook
// contract.
//
// Internal timeout budget (must stay under the outer hook `timeout` in
// .claude/settings.json, which is currently 120s):
//   lint: 45s, build: 45s, length: 10s  => 100s worst case, 20s buffer.
// Each step's timeout is enforced here via child_process spawnSync's own
// `timeout` option (which kills the child itself), not by assuming the
// outer hook timeout will do it. A timed-out step is reported as TIMEOUT
// and always counts as a failure, never as a pass.
//
// stop_hook_active handling: on first failure we exit 2 to block stopping
// and ask for a fix. If checks are STILL failing on the re-entrant Stop
// call (stop_hook_active === true), we do not loop forever -- but we also
// do not treat the re-entry itself as success. We let the turn end while
// printing an explicit, hard-to-miss "still failing" message so the
// unresolved failure stays visible instead of being silently swallowed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function run(label, cmd, args, timeoutMs) {
  const res = spawnSync(cmd, args, { timeout: timeoutMs, encoding: "utf8", cwd: REPO_ROOT });
  if (res.error && res.error.code === "ETIMEDOUT") {
    return { label, ok: false, timedOut: true, output: `TIMEOUT after ${timeoutMs}ms (treated as failing, not passing)` };
  }
  const ok = res.status === 0;
  const output = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
  return { label, ok, timedOut: false, output };
}

function main() {
  const input = readStdin();
  const stopHookActive = input?.stop_hook_active === true;

  const results = [
    run("lint", process.execPath, [path.join(__dirname, "lint-check.mjs")], 45000),
    run("build (syntax)", process.execPath, [path.join(__dirname, "build-check.mjs")], 45000),
    run("length", process.execPath, [path.join(__dirname, "length-check.mjs")], 10000),
  ];

  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) {
    process.stdout.write("OK: lint, build, and length checks all passed.\n");
    process.exit(0);
  }

  const report = failures
    .map((f) => `--- ${f.label} [${f.timedOut ? "TIMEOUT" : "FAIL"}] ---\n${f.output}`)
    .join("\n\n");

  if (!stopHookActive) {
    process.stderr.write(`BLOCKED: full check failed, cannot finish yet. Fix and retry:\n\n${report}\n`);
    process.exit(2);
  }

  // Re-entrant Stop call and still failing: don't loop forever, but do not
  // report this as passing either. Surface it loudly and let the turn end.
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        `Stop hook: checks are STILL FAILING after one retry (stop_hook_active). ` +
        `Not blocking again to avoid an infinite loop, but this is NOT a pass -- ` +
        `unresolved: ${failures.map((f) => f.label).join(", ")}.`,
    }) + "\n"
  );
  process.stderr.write(`UNRESOLVED after retry (allowing stop to avoid a loop, this is not a pass):\n\n${report}\n`);
  process.exit(0);
}

main();
