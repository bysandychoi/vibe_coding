#!/usr/bin/env node
// Verifies logs/samples/*.csv against the T2-7 log format design (problem.md §8-1):
// header: run_id,epoch,timestamp,entropy,reward,reward_all_zero,policy_loss,gradient_norm
// entropy/reward/policy_loss/gradient_norm may be "nan"/"inf"/"-inf" (lowercase) instead
// of a number -- those are valid encoded values, not parse errors.
//
// Usage:
//   node tools/verify-log-format.mjs <file.csv> [file2.csv ...]
//   node tools/verify-log-format.mjs --rules <file.csv>   (also evaluates §6/§9 thresholds
//                                                           on the last 10-epoch window)

import { readFileSync } from "node:fs";

const HEADER = ["run_id", "epoch", "timestamp", "entropy", "reward", "reward_all_zero", "policy_loss", "gradient_norm"];
const NUMERIC_COLS = new Set(["entropy", "reward", "policy_loss", "gradient_norm"]);
const SPECIAL = new Set(["nan", "inf", "-inf"]);

function parseCell(name, raw) {
  if (NUMERIC_COLS.has(name)) {
    const lower = raw.toLowerCase();
    if (SPECIAL.has(lower)) return { ok: true, special: lower, value: null };
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n)) return { ok: false };
    return { ok: true, special: null, value: n };
  }
  if (name === "epoch") return /^\d+$/.test(raw) ? { ok: true, value: Number(raw) } : { ok: false };
  if (name === "reward_all_zero") return raw === "true" || raw === "false" ? { ok: true, value: raw === "true" } : { ok: false };
  if (name === "timestamp") return Number.isNaN(Date.parse(raw)) ? { ok: false } : { ok: true, value: raw };
  return { ok: true, value: raw };
}

function verifyFile(path) {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const headerOk = HEADER.length === header.length && HEADER.every((h, i) => h === header[i]);
  console.log(`\n=== ${path} ===`);
  console.log(`header: ${headerOk ? "OK" : "MISMATCH"} (${header.join("|")})`);

  const rows = [];
  let errors = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    if (cells.length !== HEADER.length) {
      console.log(`  line ${i + 1}: COLUMN COUNT MISMATCH (${cells.length} vs ${HEADER.length})`);
      errors++;
      continue;
    }
    const row = {};
    let rowOk = true;
    const specials = [];
    HEADER.forEach((name, idx) => {
      const parsed = parseCell(name, cells[idx]);
      if (!parsed.ok) { rowOk = false; return; }
      if (parsed.special) specials.push(`${name}=${parsed.special}`);
      row[name] = parsed.special ? parsed.special : parsed.value;
    });
    if (!rowOk) {
      console.log(`  line ${i + 1}: PARSE ERROR (${lines[i]})`);
      errors++;
      continue;
    }
    if (specials.length) console.log(`  line ${i + 1}: OK, special values: ${specials.join(", ")}`);
    rows.push(row);
  }
  console.log(`rows parsed: ${lines.length - 1}, errors: ${errors}`);
  return { rows, errors };
}

function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function std(a) { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); }
function linregSlope(ys) {
  const xs = ys.map((_, i) => i);
  const xm = mean(xs), ym = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < ys.length; i++) { num += (xs[i] - xm) * (ys[i] - ym); den += (xs[i] - xm) ** 2; }
  return num / den;
}

function evalRules(rows) {
  const numeric = rows.filter((r) => typeof r.gradient_norm === "number" && typeof r.entropy === "number");
  const win = numeric.slice(-10);
  const gAll = numeric.map((r) => r.gradient_norm);
  const gMean = mean(gAll), gStd = std(gAll);
  const explosionThresh = gMean + 5 * gStd;
  const eAll = numeric.map((r) => r.entropy);
  const eMean = mean(eAll);
  const bThresh = Math.min(eMean * 0.1, 0.05);
  const eWin = win.map((r) => r.entropy);
  const monotonic = eWin.every((v, i) => i === 0 || v <= eWin[i - 1]);
  const belowB = eWin[eWin.length - 1] < bThresh;
  const dropWin = numeric.slice(-12);
  const dropRatio = (dropWin[0].entropy - dropWin[dropWin.length - 1].entropy) / dropWin[0].entropy;
  const rewardSlope = linregSlope(win.map((r) => r.reward));
  const lossSlope = linregSlope(win.map((r) => r.policy_loss));

  console.log("\n--- §6 gradient explosion (규칙 기반) ---");
  console.log(`baseline mean=${gMean.toFixed(3)} std=${gStd.toFixed(3)} threshold(mean+5std)=${explosionThresh.toFixed(3)}`);
  console.log(`최근값=${win[win.length - 1].gradient_norm} -> ${win[win.length - 1].gradient_norm > explosionThresh ? "EXPLOSION" : "정상"}`);

  console.log("\n--- §9.1 gradient vanishing ---");
  const vanishThresh = gMean * 0.01;
  console.log(`임계치(mean*1%)=${vanishThresh.toFixed(4)}, window 최솟값=${Math.min(...win.map((r) => r.gradient_norm))}`);
  console.log(win.every((r) => r.gradient_norm < vanishThresh) ? "-> 이상 의심" : "-> 정상(조건 A 불충족)");

  console.log("\n--- §9.2 entropy collapse ---");
  console.log(`baseline mean=${eMean.toFixed(3)}, B 임계치=${bThresh.toFixed(4)}, A(단조감소)=${monotonic}, B(현재<임계치)=${belowB}`);
  console.log(`C(12ep 낙폭)=${(dropRatio * 100).toFixed(1)}% (임계치 80%)`);
  console.log((monotonic && belowB) || dropRatio >= 0.8 ? "-> 이상" : "-> 정상");

  console.log("\n--- §9.3 loss-reward 불일치 ---");
  console.log(`reward slope=${rewardSlope.toFixed(3)}/ep, policy_loss slope=${lossSlope.toFixed(3)}/ep`);
  console.log(Math.sign(rewardSlope) === Math.sign(lossSlope) ? "-> 이상(부호 동일)" : "-> 정상(기대되는 역상관 유지)");
}

const args = process.argv.slice(2);
const rulesMode = args.includes("--rules");
const files = args.filter((a) => a !== "--rules");
if (files.length === 0) {
  console.log("Usage: node tools/verify-log-format.mjs [--rules] <file.csv> [file2.csv ...]");
  process.exit(1);
}
let totalErrors = 0;
for (const f of files) {
  const { rows, errors } = verifyFile(f);
  totalErrors += errors;
  if (rulesMode) evalRules(rows);
}
process.exit(totalErrors > 0 ? 1 : 0);
