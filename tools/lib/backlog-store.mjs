import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Overridable so mutating commands can be verified end-to-end against an
// isolated working copy before ever touching the real backlog.json.
const BACKLOG_PATH = process.env.BACKLOG_STORE_PATH
  ? path.resolve(process.env.BACKLOG_STORE_PATH)
  : path.join(REPO_ROOT, "backlog.json");
const BACKUP_DIR = path.join(path.dirname(BACKLOG_PATH), ".backlog-backups");

export function fail(message, code = 1) {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n");
  process.exit(code);
}

export function loadBacklog() {
  let raw;
  try {
    raw = readFileSync(BACKLOG_PATH, "utf8");
  } catch (err) {
    fail(`ERROR: cannot read ${BACKLOG_PATH}: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail(`ERROR: ${BACKLOG_PATH} is not valid JSON: ${err.message}`);
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.tasks)) {
    fail(`ERROR: ${BACKLOG_PATH} has no top-level "tasks" array.`);
  }
  const sha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  return { raw, data, sha256 };
}

export function sourceInfo({ raw, data, sha256 }) {
  return {
    file: path.relative(REPO_ROOT, BACKLOG_PATH).replace(/\\/g, "/"),
    sha256,
    sha256_short: sha256.slice(0, 12),
    bytes: Buffer.byteLength(raw, "utf8"),
    schema_version: data.$schema_version ?? null,
    meta_updated: data.meta?.updated ?? null,
    task_count: data.tasks.length,
  };
}

export function schemaInfo(data) {
  return {
    schema_version: data.$schema_version ?? null,
    enums: data.enums ?? {},
    meta: data.meta ?? {},
  };
}

export function indexById(tasks) {
  const map = new Map();
  const dupes = [];
  for (const t of tasks) {
    if (t && t.id !== undefined) {
      if (map.has(t.id)) dupes.push(t.id);
      map.set(t.id, t);
    }
  }
  return { map, dupes };
}

export function validateBacklog(loaded) {
  const { data } = loaded;
  const errors = [];
  const enums = data.enums || {};
  const validStatus = new Set(enums.status || []);
  const validCategory = new Set(enums.category || []);
  const validPriority = new Set((enums.priority || []).map((p) => (p === null ? " null" : p)));
  const { map, dupes } = indexById(data.tasks);
  for (const id of dupes) errors.push(`duplicate task id: ${id}`);
  for (const t of data.tasks) {
    if (!t || t.id === undefined) {
      errors.push(`task missing "id": ${JSON.stringify(t)}`);
      continue;
    }
    if (validStatus.size && !validStatus.has(t.status)) {
      errors.push(`task ${t.id}: invalid status '${t.status}'`);
    }
    if (validCategory.size && !validCategory.has(t.category)) {
      errors.push(`task ${t.id}: invalid category '${t.category}'`);
    }
    if (validPriority.size) {
      const key = t.priority === null || t.priority === undefined ? " null" : t.priority;
      if (!validPriority.has(key)) errors.push(`task ${t.id}: invalid priority '${t.priority}'`);
    }
    if (t.parent !== null && t.parent !== undefined && !map.has(t.parent)) {
      errors.push(`task ${t.id}: parent references unknown id '${t.parent}'`);
    }
    for (const d of t.deps || []) {
      if (!map.has(d)) errors.push(`task ${t.id}: deps references unknown id '${d}'`);
    }
  }
  return { errors, map };
}

// Validates newData, backs it up, and writes it atomically only if every
// check passes. On any failure the real file on disk is left untouched:
// nothing is written until the temp file has been validated, and the final
// step is a single rename (not an in-place overwrite).
export function writeBacklogAtomic(newData, { expectSha256, actor }) {
  const current = loadBacklog();
  if (expectSha256 && current.sha256 !== expectSha256) {
    throw new Error(
      `version mismatch: expected sha256 ${expectSha256} but backlog.json is now ${current.sha256}. ` +
        `Someone else changed it since you queried; re-run a read-only query and retry with the new sha256.`
    );
  }
  const probe = { data: newData };
  const { errors } = validateBacklog(probe);
  if (errors.length > 0) {
    throw new Error(`refusing to write: new content fails schema/reference validation:\n` + errors.map((e) => " - " + e).join("\n"));
  }
  const raw = JSON.stringify(newData, null, 2) + "\n";
  try {
    JSON.parse(raw);
  } catch (err) {
    throw new Error(`refusing to write: serialized content is not valid JSON: ${err.message}`);
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `backlog.${stamp}.${current.sha256.slice(0, 12)}.bak.json`);
  writeFileSync(backupPath, current.raw, "utf8");

  const tmpPath = BACKLOG_PATH + `.tmp-${stamp}`;
  try {
    writeFileSync(tmpPath, raw, "utf8");
    // Re-read+re-validate the temp file itself (not just the in-memory
    // object) so a serialization bug can't slip a broken file past us.
    const reread = JSON.parse(readFileSync(tmpPath, "utf8"));
    const { errors: postErrors } = validateBacklog({ data: reread });
    if (postErrors.length > 0) {
      throw new Error("post-write validation failed:\n" + postErrors.map((e) => " - " + e).join("\n"));
    }
    renameSync(tmpPath, BACKLOG_PATH);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // tmp file never got created; nothing to clean up
    }
    throw err;
  }

  const written = loadBacklog();
  return { ...sourceInfo(written), backup: path.relative(path.dirname(BACKLOG_PATH), backupPath).replace(/\\/g, "/"), actor: actor ?? null };
}
