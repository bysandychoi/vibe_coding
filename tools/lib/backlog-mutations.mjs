// Mutating backlog-cli commands (add / set-status / set-field). Split out of
// backlog-cli.mjs to keep that file under the repo's line-length check; all
// three go through writeBacklogAtomic for schema validation, backup, and
// atomic write, so moving them here changes no behavior.
import { readFileSync } from "node:fs";
import { fail, indexById, writeBacklogAtomic } from "./backlog-store.mjs";

const TASK_FIELD_DEFAULTS = {
  priority: null,
  where: null,
  deps: [],
  doc: null,
  est_min: null,
  gate: null,
  owner: null,
  claimed_at: null,
  log: [],
  done_at: null,
  evidence: null,
};
const REQUIRED_TASK_FIELDS = ["id", "status", "category", "title", "summary", "done_when"];
const SET_FIELD_BLOCKED_FIELDS = new Set(["id", "status"]);

export function requireExpectSha(flags) {
  const expect = flags["expect-sha256"];
  if (!expect) {
    fail(
      "ERROR: this command mutates backlog.json and requires --expect-sha256 <hash> " +
        "(from a prior list/show/validate/schema --json call's source.sha256) so a stale write is refused instead of silently clobbering a newer version."
    );
  }
  return expect;
}

export function cmdAdd(loaded, flags) {
  const expectSha256 = requireExpectSha(flags);
  const filePath = flags.file;
  if (!filePath) fail("ERROR: add requires --file <path-to-task.json>. Usage: backlog-cli add --file <path> --expect-sha256 <hash>");
  let incoming;
  try {
    incoming = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    fail(`ERROR: cannot read/parse --file ${filePath}: ${err.message}`);
  }
  const missing = REQUIRED_TASK_FIELDS.filter((f) => incoming[f] === undefined);
  if (missing.length) fail(`ERROR: task JSON is missing required field(s): ${missing.join(", ")}`);
  const { map } = indexById(loaded.data.tasks);
  if (map.has(incoming.id)) fail(`ERROR: task id '${incoming.id}' already exists.`);
  const now = new Date().toISOString();
  const task = { ...TASK_FIELD_DEFAULTS, ...incoming, updated_at: incoming.updated_at ?? now };
  const newData = {
    ...loaded.data,
    meta: loaded.data.meta ? { ...loaded.data.meta, updated: now.slice(0, 10) } : loaded.data.meta,
    tasks: [...loaded.data.tasks, task],
  };
  let result;
  try {
    result = writeBacklogAtomic(newData, { expectSha256, actor: flags.actor ?? null });
  } catch (err) {
    fail(`ERROR: add failed, backlog.json left untouched: ${err.message}`);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, added: task.id, source: result }, null, 2) + "\n");
  } else {
    process.stdout.write(`OK: added task '${task.id}'. new sha256=${result.sha256_short}… backup=${result.backup}\n`);
  }
}

export function cmdSetStatus(loaded, flags, positional) {
  const expectSha256 = requireExpectSha(flags);
  const [id, newStatus] = positional;
  if (!id || !newStatus) fail("ERROR: set-status requires <id> <newStatus>. Usage: backlog-cli set-status <id> <status> --expect-sha256 <hash>");
  const { map } = indexById(loaded.data.tasks);
  const task = map.get(id);
  if (!task) fail(`ERROR: no task with id '${id}'.`);
  const validStatus = new Set((loaded.data.enums?.status || []));
  if (validStatus.size && !validStatus.has(newStatus)) {
    fail(`ERROR: '${newStatus}' is not in enums.status (${[...validStatus].join(", ")}).`);
  }
  let decisionConfirmedNote = null;
  if (task.category === "decision" && newStatus === "done") {
    if (!flags["user-confirmed"]) {
      fail(
        `ERROR: task '${id}' has category=decision (owner=user). Marking it done requires --user-confirmed ` +
          `-- an explicit acknowledgment that the user actually made this decision (not the assistant deciding ` +
          `on its own). Usage: set-status ${id} done --user-confirmed --expect-sha256 <hash> [--note TEXT]`
      );
    }
    if (!task.evidence || String(task.evidence).trim() === "") {
      fail(
        `ERROR: task '${id}' has category=decision and no 'evidence' recorded yet. Record what the user decided ` +
          `first via 'set-field ${id} evidence --value "..."', then retry set-status with --user-confirmed.`
      );
    }
    decisionConfirmedNote = "[user-confirmed: decision category, done via explicit override]";
  }
  const now = new Date().toISOString();
  const fromStatus = task.status;
  const combinedNote = [decisionConfirmedNote, flags.note].filter((v) => v != null && v !== "").join(" ") || null;
  const updatedTask = {
    ...task,
    status: newStatus,
    updated_at: now,
    done_at: newStatus === "done" ? now : newStatus === fromStatus ? task.done_at : null,
    log: [...(task.log || []), { at: now, from: fromStatus, to: newStatus, note: combinedNote }],
  };
  const newData = {
    ...loaded.data,
    meta: loaded.data.meta ? { ...loaded.data.meta, updated: now.slice(0, 10) } : loaded.data.meta,
    tasks: loaded.data.tasks.map((t) => (t.id === id ? updatedTask : t)),
  };
  let result;
  try {
    result = writeBacklogAtomic(newData, { expectSha256, actor: flags.actor ?? null });
  } catch (err) {
    fail(`ERROR: set-status failed, backlog.json left untouched: ${err.message}`);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, id, from: fromStatus, to: newStatus, source: result }, null, 2) + "\n");
  } else {
    process.stdout.write(`OK: ${id} ${fromStatus} -> ${newStatus}. new sha256=${result.sha256_short}… backup=${result.backup}\n`);
  }
}

// Generic single-field setter for anything set-status/add don't cover (e.g.
// attaching a detail_doc path). Refuses id (immutable) and status (has its
// own command with the decision/done policy check) -- everything else still
// goes through writeBacklogAtomic's post-write schema/reference validation,
// so an invalid category/priority is still caught there.
export function cmdSetField(loaded, flags, positional) {
  const expectSha256 = requireExpectSha(flags);
  const [id, field] = positional;
  if (!id || !field) {
    fail(
      "ERROR: set-field requires <id> <field> --value <value> --expect-sha256 <hash>. " +
        "Usage: backlog-cli set-field <id> <field> --value <value> [--json-value] --expect-sha256 <hash>"
    );
  }
  if (SET_FIELD_BLOCKED_FIELDS.has(field)) {
    fail(`ERROR: field '${field}' cannot be changed with set-field (id is immutable; use set-status for status).`);
  }
  if (flags.value === undefined) fail("ERROR: set-field requires --value <value>.");
  const { map } = indexById(loaded.data.tasks);
  const task = map.get(id);
  if (!task) fail(`ERROR: no task with id '${id}'.`);
  let value = flags.value;
  if (flags["json-value"]) {
    try {
      value = JSON.parse(value);
    } catch (err) {
      fail(`ERROR: --value is not valid JSON (pass a plain string without --json-value instead): ${err.message}`);
    }
  }
  const now = new Date().toISOString();
  const updatedTask = { ...task, [field]: value, updated_at: now };
  const newData = {
    ...loaded.data,
    meta: loaded.data.meta ? { ...loaded.data.meta, updated: now.slice(0, 10) } : loaded.data.meta,
    tasks: loaded.data.tasks.map((t) => (t.id === id ? updatedTask : t)),
  };
  let result;
  try {
    result = writeBacklogAtomic(newData, { expectSha256, actor: flags.actor ?? null });
  } catch (err) {
    fail(`ERROR: set-field failed, backlog.json left untouched: ${err.message}`);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, id, field, value, source: result }, null, 2) + "\n");
  } else {
    process.stdout.write(`OK: ${id}.${field} set. new sha256=${result.sha256_short}… backup=${result.backup}\n`);
  }
}
