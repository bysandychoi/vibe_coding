function truncate(s, n) {
  if (s === null || s === undefined) return "";
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

export function printTable(tasks) {
  const cols = [
    ["id", 8],
    ["status", 12],
    ["category", 9],
    ["priority", 8],
    ["owner", 6],
    ["title", 42],
  ];
  const header = cols.map(([k, w]) => k.toUpperCase().padEnd(w)).join(" ");
  process.stdout.write(header + "\n");
  process.stdout.write(cols.map(([, w]) => "-".repeat(w)).join(" ") + "\n");
  for (const t of tasks) {
    const row = [
      truncate(t.id, 8).padEnd(8),
      truncate(t.status, 12).padEnd(12),
      truncate(t.category, 9).padEnd(9),
      truncate(t.priority === null || t.priority === undefined ? "-" : t.priority, 8).padEnd(8),
      truncate(t.owner === null || t.owner === undefined ? "-" : t.owner, 6).padEnd(6),
      truncate(t.title, 42),
    ].join(" ");
    process.stdout.write(row + "\n");
  }
}

function printKV(label, value) {
  process.stdout.write(`${label.padEnd(12)}: ${value}\n`);
}

function fmtScalar(v) {
  if (v === null || v === undefined) return "null";
  return String(v);
}

export function showTask(t) {
  printKV("id", fmtScalar(t.id));
  printKV("status", fmtScalar(t.status));
  printKV("priority", fmtScalar(t.priority));
  printKV("category", fmtScalar(t.category));
  printKV("title", fmtScalar(t.title));
  printKV("summary", fmtScalar(t.summary));
  printKV("where", fmtScalar(t.where));
  printKV("parent", fmtScalar(t.parent));
  printKV("deps", JSON.stringify(t.deps ?? []));
  printKV("doc", fmtScalar(t.doc));
  printKV("done_when", fmtScalar(t.done_when));
  printKV("est_min", fmtScalar(t.est_min));
  printKV("gate", fmtScalar(t.gate));
  printKV("owner", fmtScalar(t.owner));
  printKV("claimed_at", fmtScalar(t.claimed_at));
  printKV("updated_at", fmtScalar(t.updated_at));
  printKV("done_at", fmtScalar(t.done_at));
  printKV("log", JSON.stringify(t.log ?? []));
  printKV("evidence", JSON.stringify(t.evidence ?? null));
}

export function printSourceText(src) {
  process.stdout.write(
    `# source: ${src.file} sha256=${src.sha256_short}… (${src.bytes}B) schema=${src.schema_version} tasks=${src.task_count}\n`
  );
}
