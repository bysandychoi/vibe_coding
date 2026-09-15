export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function normNullable(v) {
  if (v === undefined) return undefined;
  return v === "null" ? null : v;
}

export function matchesFilter(task, flags) {
  if (flags.status !== undefined && task.status !== flags.status) return false;
  if (flags.category !== undefined && task.category !== flags.category) return false;
  if (flags.priority !== undefined && task.priority !== normNullable(flags.priority)) return false;
  if (flags.owner !== undefined && task.owner !== normNullable(flags.owner)) return false;
  if (flags.parent !== undefined && task.parent !== normNullable(flags.parent)) return false;
  if (flags.dep !== undefined && !(Array.isArray(task.deps) && task.deps.includes(flags.dep))) return false;
  if (flags.search !== undefined) {
    const needle = String(flags.search).toLowerCase();
    const haystack = `${task.title || ""} ${task.summary || ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}
