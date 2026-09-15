#!/usr/bin/env node
// Flags source files whose line count exceeds a configurable limit.
// Usage:
//   node tools/checks/length-check.mjs              -> scan the whole repo
//   node tools/checks/length-check.mjs <file> [...]  -> check only these files (fast path for hooks)
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const LIMIT = Number(process.env.CODE_LENGTH_LIMIT || 300);
const SOURCE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".py"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "data", ".claude", ".venv", "__pycache__"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function lineCount(file) {
  // Matches `wc -l` semantics: counts newline characters, not split() length,
  // so a trailing newline doesn't inflate the count by one.
  const text = readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  const newlines = (text.match(/\n/g) || []).length;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

function main() {
  const argFiles = process.argv.slice(2);
  const files = argFiles.length
    ? argFiles.filter((f) => SOURCE_EXT.has(path.extname(f)) && statSync(f, { throwIfNoEntry: false })?.isFile())
    : walk(REPO_ROOT, []);

  const violations = [];
  for (const file of files) {
    const n = lineCount(file);
    if (n > LIMIT) {
      violations.push({ file: path.relative(REPO_ROOT, file).replace(/\\/g, "/"), lines: n });
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`OK: ${files.length} source file(s) checked, all <= ${LIMIT} lines.\n`);
    return 0;
  }

  process.stderr.write(`FAIL: ${violations.length} file(s) exceed the ${LIMIT}-line limit:\n`);
  for (const v of violations) {
    process.stderr.write(`  - ${v.file}: ${v.lines} lines (limit ${LIMIT})\n`);
  }
  return 1;
}

process.exitCode = main();
