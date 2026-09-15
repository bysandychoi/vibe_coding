#!/usr/bin/env node
// This project has no bundler/compiler step (plain Node ESM scripts and,
// going forward, plain Python scripts -- no TypeScript, no build tool
// config anywhere in the repo). The closest real "build" verification
// available on this stack is a syntax check per language:
//   .js/.mjs/.cjs -> `node --check`
//   .py           -> `python -m py_compile` (via the project's .venv)
// Both catch real syntax errors a bundler/compiler would otherwise catch
// at build time. This is not a no-op: a broken file fails it for real.
//
// Usage:
//   node tools/checks/build-check.mjs              -> check the whole repo
//   node tools/checks/build-check.mjs <file> [...]  -> check only these files
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const JS_EXT = new Set([".js", ".mjs", ".cjs"]);
const PY_EXT = new Set([".py"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "data", ".claude", ".venv", "__pycache__"]);
const PER_FILE_TIMEOUT_MS = 5000;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else {
      const ext = path.extname(entry.name);
      if (JS_EXT.has(ext) || PY_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

function venvPython() {
  const bin = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python3"];
  return path.join(REPO_ROOT, ".venv", ...bin);
}

function checkFile(file) {
  const ext = path.extname(file);
  let res;
  if (PY_EXT.has(ext)) {
    const python = venvPython();
    if (!statSync(python, { throwIfNoEntry: false })?.isFile()) {
      return { file, status: "FAIL", detail: `.venv Python not found at ${python}; run: python -m venv .venv && ... pip install -r requirements-dev.txt` };
    }
    res = spawnSync(python, ["-m", "py_compile", file], { timeout: PER_FILE_TIMEOUT_MS, encoding: "utf8" });
  } else {
    res = spawnSync(process.execPath, ["--check", file], { timeout: PER_FILE_TIMEOUT_MS, encoding: "utf8" });
  }
  if (res.error && res.error.code === "ETIMEDOUT") {
    return { file, status: "TIMEOUT", detail: `syntax check exceeded ${PER_FILE_TIMEOUT_MS}ms` };
  }
  if (res.status !== 0) {
    return { file, status: "FAIL", detail: (res.stderr || res.error?.message || "unknown error").trim() };
  }
  return { file, status: "OK" };
}

function main() {
  const argFiles = process.argv.slice(2);
  const files = argFiles.length
    ? argFiles.filter((f) => (JS_EXT.has(path.extname(f)) || PY_EXT.has(path.extname(f))) && statSync(f, { throwIfNoEntry: false })?.isFile())
    : walk(REPO_ROOT, []);

  if (files.length === 0) {
    process.stdout.write("OK: no .js/.mjs/.cjs/.py source files to syntax-check.\n");
    return 0;
  }

  const results = files.map(checkFile);
  const bad = results.filter((r) => r.status !== "OK");

  if (bad.length === 0) {
    process.stdout.write(`OK: ${files.length} source file(s) passed the syntax build step (node --check / py_compile).\n`);
    return 0;
  }

  process.stderr.write(`FAIL: ${bad.length} of ${files.length} file(s) failed the syntax build step:\n`);
  for (const r of bad) {
    const rel = path.relative(REPO_ROOT, r.file).replace(/\\/g, "/");
    process.stderr.write(`  - ${rel} [${r.status}]: ${r.detail}\n`);
  }
  return 1;
}

process.exitCode = main();
