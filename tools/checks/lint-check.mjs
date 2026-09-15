#!/usr/bin/env node
// Dispatches lint by file extension: .js/.mjs/.cjs -> ESLint, .py -> pylint
// (run from the project-local .venv, same idea as node_modules for JS).
// A language with zero matching files is reported as INFO (nothing to lint
// yet), never silently skipped as if it passed -- this repo is expected to
// grow .py files over time and this makes that state visible.
//
// Usage:
//   node tools/checks/lint-check.mjs              -> lint the whole repo
//   node tools/checks/lint-check.mjs <file> [...]  -> lint only these files
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const JS_EXT = new Set([".js", ".mjs", ".cjs"]);
const PY_EXT = new Set([".py"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "data", ".claude", ".venv", "__pycache__"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else {
      const ext = path.extname(entry.name);
      if (JS_EXT.has(ext)) out.js.push(full);
      else if (PY_EXT.has(ext)) out.py.push(full);
    }
  }
  return out;
}

function classifyArgFiles(argFiles) {
  const out = { js: [], py: [] };
  for (const f of argFiles) {
    if (!statSync(f, { throwIfNoEntry: false })?.isFile()) continue;
    const ext = path.extname(f);
    if (JS_EXT.has(ext)) out.js.push(f);
    else if (PY_EXT.has(ext)) out.py.push(f);
  }
  return out;
}

function venvPython() {
  const bin = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python3"];
  return path.join(REPO_ROOT, ".venv", ...bin);
}

// If .venv is ever recreated on a Windows machine whose console codepage is
// not UTF-8 (chcp != 65001) and the repo path contains non-ASCII characters,
// `python -m venv` / `pip install` can silently duplicate every package's
// files into the .venv root itself (alongside the correct copy under
// .venv/Lib/site-packages). Since .venv itself ends up on sys.path, that
// stray copy shadows the real one and breaks pylint at import time (isort's
// version metadata reads back as None -> TypeError). Fix: recreate .venv
// with PYTHONUTF8=1 and PYTHONIOENCODING=utf-8 set before `python -m venv`
// and `pip install`, then confirm `ls .venv` has no stray top-level package
// dirs besides Scripts/Lib/Include/pyvenv.cfg.

function run(cmd, args, timeoutMs) {
  const res = spawnSync(cmd, args, { timeout: timeoutMs, encoding: "utf8", cwd: REPO_ROOT });
  if (res.error && res.error.code === "ETIMEDOUT") {
    return { ok: false, timedOut: true, output: `TIMEOUT after ${timeoutMs}ms` };
  }
  if (res.error) {
    return { ok: false, timedOut: false, output: res.error.message };
  }
  const ok = res.status === 0;
  const output = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
  return { ok, timedOut: false, output };
}

function lintJs(files, timeoutMs) {
  if (files.length === 0) return { lang: "eslint (js/mjs/cjs)", info: "no JS source files to lint yet" };
  const eslintBin = path.join(REPO_ROOT, "node_modules", "eslint", "bin", "eslint.js");
  const r = run(process.execPath, [eslintBin, "--no-warn-ignored", ...files], timeoutMs);
  return { lang: "eslint (js/mjs/cjs)", ...r };
}

function lintPy(files, timeoutMs) {
  if (files.length === 0) return { lang: "pylint (py)", info: "no Python source files to lint yet" };
  const python = venvPython();
  if (!statSync(python, { throwIfNoEntry: false })?.isFile()) {
    return {
      lang: "pylint (py)",
      ok: false,
      timedOut: false,
      output:
        `FAIL: .venv Python not found at ${python}. Set it up with:\n` +
        `  python -m venv .venv\n` +
        `  ${process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python3"} -m pip install -r requirements-dev.txt`,
    };
  }
  const r = run(python, ["-m", "pylint", ...files], timeoutMs);
  return { lang: "pylint (py)", ...r };
}

function main() {
  const argFiles = process.argv.slice(2);
  const { js, py } = argFiles.length ? classifyArgFiles(argFiles) : walk(REPO_ROOT, { js: [], py: [] });

  const results = [lintJs(js, 30000), lintPy(py, 30000)];
  const failures = results.filter((r) => r.ok === false);
  const infos = results.filter((r) => r.info);

  for (const i of infos) process.stdout.write(`INFO: ${i.lang}: ${i.info}\n`);

  if (failures.length === 0) {
    const checked = results.filter((r) => r.ok !== undefined);
    process.stdout.write(`OK: ${checked.map((r) => r.lang).join(", ") || "nothing to lint"} passed.\n`);
    return 0;
  }

  process.stderr.write(`FAIL: ${failures.length} linter(s) reported problems:\n\n`);
  for (const f of failures) {
    process.stderr.write(`--- ${f.lang} [${f.timedOut ? "TIMEOUT" : "FAIL"}] ---\n${f.output}\n\n`);
  }
  return 1;
}

process.exitCode = main();
