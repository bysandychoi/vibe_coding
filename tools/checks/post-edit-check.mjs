#!/usr/bin/env node
// PostToolUse hook (fast path): checks only the file that was just
// Written/Edited -- length, syntax ("build"), and lint. Reads the hook
// payload from stdin per Claude Code's hook JSON contract.
//
// Internal timeout budget (must stay under the outer hook `timeout` in
// .claude/settings.json, which is currently 30s):
//   length check: 5s, syntax check: 5s, lint (eslint or pylint): 18s
//   => 28s worst case. A timed-out step is reported as TIMEOUT, never
// silently treated as pass.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_EXT = new Set([".js", ".mjs", ".cjs", ".py"]);
const EXCLUDE_DIRS = ["node_modules", ".git", "data", ".claude", ".venv", "__pycache__"];

function readStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isCheckable(filePath) {
  if (!filePath) return false;
  if (!SOURCE_EXT.has(path.extname(filePath))) return false;
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  if (rel.startsWith("..")) return false; // outside repo
  if (EXCLUDE_DIRS.some((d) => rel === d || rel.startsWith(d + "/"))) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function run(cmd, args, timeoutMs) {
  const res = spawnSync(cmd, args, { timeout: timeoutMs, encoding: "utf8" });
  if (res.error && res.error.code === "ETIMEDOUT") {
    return { ok: false, timedOut: true, output: `TIMEOUT after ${timeoutMs}ms` };
  }
  const ok = res.status === 0;
  const output = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
  return { ok, timedOut: false, output };
}

function main() {
  const input = readStdin();
  const filePath = input?.tool_input?.file_path;
  if (!filePath || !isCheckable(filePath)) {
    process.exit(0); // nothing to check for this tool call
  }
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
  const failures = [];

  const length = run(process.execPath, [path.join(__dirname, "length-check.mjs"), abs], 5000);
  if (!length.ok) failures.push({ check: "length", ...length });

  const build = run(process.execPath, [path.join(__dirname, "build-check.mjs"), abs], 5000);
  if (!build.ok) failures.push({ check: "build (syntax)", ...build });

  const lint = run(process.execPath, [path.join(__dirname, "lint-check.mjs"), abs], 18000);
  if (!lint.ok) failures.push({ check: "lint", ...lint });

  if (failures.length === 0) process.exit(0);

  const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, "/");
  process.stderr.write(`BLOCKED: ${rel} failed post-edit checks. Fix before continuing:\n\n`);
  for (const f of failures) {
    const tag = f.timedOut ? "TIMEOUT (unverified, treat as failing)" : "FAIL";
    process.stderr.write(`--- ${f.check} [${tag}] ---\n${f.output}\n\n`);
  }
  process.exit(2);
}

main();
