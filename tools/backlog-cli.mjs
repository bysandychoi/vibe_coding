#!/usr/bin/env node
import { fail, loadBacklog, sourceInfo, schemaInfo, indexById, validateBacklog } from "./lib/backlog-store.mjs";
import { parseArgs, matchesFilter } from "./lib/args.mjs";
import { printTable, showTask, printSourceText } from "./lib/format.mjs";
import { cmdAdd, cmdSetStatus, cmdSetField } from "./lib/backlog-mutations.mjs";

function cmdList(loaded, flags) {
  const { data } = loaded;
  const tasks = data.tasks.filter((t) => matchesFilter(t, flags));
  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ source: sourceInfo(loaded), count: tasks.length, tasks }, null, 2) + "\n"
    );
    return;
  }
  printSourceText(sourceInfo(loaded));
  printTable(tasks);
  process.stdout.write(`\n${tasks.length} task(s)\n`);
}

function cmdShow(loaded, flags, positional) {
  const id = positional[0];
  if (!id) fail("ERROR: show requires a task id. Usage: backlog-cli show <id>");
  const { map } = indexById(loaded.data.tasks);
  const t = map.get(id);
  if (!t) {
    const known = [...map.keys()].slice(0, 20).join(", ");
    fail(`ERROR: no task with id '${id}'. Known ids (first 20): ${known}`);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ source: sourceInfo(loaded), task: t }, null, 2) + "\n");
    return;
  }
  printSourceText(sourceInfo(loaded));
  showTask(t);
}

function cmdReady(loaded, flags) {
  const { errors, map } = validateBacklog(loaded);
  const depErrors = errors.filter((e) => e.includes("deps references unknown id"));
  if (depErrors.length) {
    fail(
      `ERROR: cannot compute ready candidates, backlog.json has invalid dependency references:\n` +
        depErrors.map((e) => " - " + e).join("\n")
    );
  }
  const ready = [];
  const blocked = [];
  for (const t of loaded.data.tasks) {
    if (t.status !== "todo") continue;
    const deps = t.deps || [];
    const unmet = deps.filter((d) => map.get(d)?.status !== "done");
    if (unmet.length === 0) ready.push(t);
    else blocked.push({ task: t, unmet });
  }
  const filteredReady = ready.filter((t) => matchesFilter(t, flags));
  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          source: sourceInfo(loaded),
          ready: filteredReady,
          blocked: flags.explain ? blocked.map((b) => ({ id: b.task.id, title: b.task.title, unmet_deps: b.unmet })) : undefined,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }
  printSourceText(sourceInfo(loaded));
  process.stdout.write("== ready candidates (status=todo, all deps done) ==\n");
  printTable(filteredReady);
  process.stdout.write(`\n${filteredReady.length} candidate(s)\n`);
  if (flags.explain && blocked.length) {
    process.stdout.write("\n== blocked (status=todo, unmet deps) ==\n");
    for (const b of blocked) {
      process.stdout.write(`${b.task.id}: waiting on ${b.unmet.join(", ")}\n`);
    }
  }
}

function cmdWalk(loaded, flags) {
  const tasks = loaded.data.tasks;
  if (flags.pretty) {
    process.stdout.write(JSON.stringify({ source: sourceInfo(loaded), tasks }, null, 2) + "\n");
  } else {
    for (const t of tasks) {
      process.stdout.write(JSON.stringify(t) + "\n");
    }
  }
  process.stderr.write(`# walked ${tasks.length} task(s), source sha256=${sourceInfo(loaded).sha256_short}…\n`);
}

function cmdSchema(loaded, flags) {
  const info = schemaInfo(loaded.data);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ source: sourceInfo(loaded), ...info }, null, 2) + "\n");
    return;
  }
  printSourceText(sourceInfo(loaded));
  process.stdout.write("enums:\n" + JSON.stringify(info.enums, null, 2) + "\n");
  process.stdout.write("meta:\n" + JSON.stringify(info.meta, null, 2) + "\n");
}

function cmdValidate(loaded, flags) {
  const { errors } = validateBacklog(loaded);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ source: sourceInfo(loaded), ok: errors.length === 0, errors }, null, 2) + "\n");
  } else {
    printSourceText(sourceInfo(loaded));
    if (errors.length === 0) {
      process.stdout.write("OK: no schema/reference errors found.\n");
    } else {
      process.stdout.write(`FOUND ${errors.length} issue(s):\n`);
      for (const e of errors) process.stdout.write(" - " + e + "\n");
    }
  }
  if (errors.length > 0) process.exitCode = 1;
}

const HELP = `backlog-cli - query and (for add/set-status/set-field only) mutate backlog.json

Read-only commands (never modify the file):
  node tools/backlog-cli.mjs list [--status S] [--category C] [--priority P|null]
                                   [--owner O|null] [--parent ID|null] [--dep ID]
                                   [--search TEXT] [--json]
  node tools/backlog-cli.mjs show <id> [--json]
  node tools/backlog-cli.mjs ready [--status ...filters] [--explain] [--json]
  node tools/backlog-cli.mjs walk [--pretty]
  node tools/backlog-cli.mjs validate [--json]
  node tools/backlog-cli.mjs schema [--json]

Mutating commands (schema-validated, backed up, version-checked, atomic write):
  node tools/backlog-cli.mjs add --file <task.json> --expect-sha256 <hash> [--json]
  node tools/backlog-cli.mjs set-status <id> <status> --expect-sha256 <hash> [--note TEXT]
                                        [--user-confirmed] [--json]
  node tools/backlog-cli.mjs set-field <id> <field> --value <value> --expect-sha256 <hash>
                                        [--json-value] [--json]

  All three require --expect-sha256 from a prior read's "source.sha256" (list/
  show/validate/schema --json) and refuse to write if the file changed since.
  All three write a full backup to .backlog-backups/ next to backlog.json
  before writing, validate the new content (schema + id/parent/dep references)
  both before and after the write, and use a temp-file-then-rename so a failed
  write never leaves backlog.json partially written or corrupted. set-status
  refuses to mark category=decision tasks as done UNLESS both (a) --user-confirmed
  is passed -- an explicit acknowledgment that the user, not the assistant, made
  the decision -- and (b) the task's "evidence" field is already non-empty (record
  the decision there first via set-field). Both conditions are logged verbatim in
  the task's log entry for audit. set-field refuses to touch "id" or "status" (use
  set-status for status) and passes --value through JSON.parse when --json-value is
  given (otherwise it's stored as a plain string).
  Set BACKLOG_STORE_PATH=<path> to point any command at an isolated copy of
  backlog.json instead of the real file (for testing or scripted dry runs).

Every command prints a "source" block (relative path + sha256 + task count) so
you can confirm two queries ran against the same backlog.json content.
This tool never executes any string found inside backlog.json (e.g. the
"gate" field is displayed as plain text, never run as a command).
`;

function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }
  const { flags, positional } = parseArgs(rest);
  const loaded = loadBacklog();
  switch (cmd) {
    case "list":
      return cmdList(loaded, flags);
    case "show":
      return cmdShow(loaded, flags, positional);
    case "ready":
      return cmdReady(loaded, flags);
    case "walk":
      return cmdWalk(loaded, flags);
    case "validate":
      return cmdValidate(loaded, flags);
    case "schema":
      return cmdSchema(loaded, flags);
    case "add":
      return cmdAdd(loaded, flags);
    case "set-status":
      return cmdSetStatus(loaded, flags, positional);
    case "set-field":
      return cmdSetField(loaded, flags, positional);
    default:
      fail(`ERROR: unknown command '${cmd}'.\n\n${HELP}`);
  }
}

main();
