
(function () {
  "use strict";

  // ---- tiny safe-DOM helper (never uses innerHTML with data) ----
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") el.className = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") el.addEventListener(k.slice(2), attrs[k]);
        else el.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function text(s) { return document.createTextNode(s); }

  // ---- state ----
  const state = {
    fileName: null,
    fileSize: null,
    fileLastModified: null,
    loadedAt: null,
    handle: null,          // FileSystemFileHandle, when supported
    rawText: null,
    data: null,
    tasks: [],
    idSet: new Set(),
    enums: {},
    meta: {},
    refErrors: [],         // { taskId, field, ref }
    duplicateIds: [],
    unknownStatusTasks: [],
    filterStatus: "__all__",
    searchText: "",
    selectedIndex: -1,
    docDirHandle: null,     // FileSystemDirectoryHandle for docs/backlog, only set when the user explicitly connects it
    docCache: new Map(),    // task id -> { status: "loaded"|"not_found", content?, message? }
    pendingDocTaskId: null, // which task the manual doc-file picker result belongs to
  };

  const supportsFsAccess = typeof window.showOpenFilePicker === "function";
  const supportsDirPicker = typeof window.showDirectoryPicker === "function";

  const els = {
    btnPick: document.getElementById("btnPick"),
    btnReload: document.getElementById("btnReload"),
    btnDocDir: document.getElementById("btnDocDir"),
    fileInput: document.getElementById("fileInput"),
    docFileInput: document.getElementById("docFileInput"),
    docDirStatus: document.getElementById("docDirStatus"),
    fileMeta: document.getElementById("fileMeta"),
    notices: document.getElementById("notices"),
    summary: document.getElementById("summary"),
    mainArea: document.getElementById("mainArea"),
    statusFilter: document.getElementById("statusFilter"),
    searchBox: document.getElementById("searchBox"),
    resultCount: document.getElementById("resultCount"),
    taskTbody: document.getElementById("taskTbody"),
    detailPane: document.getElementById("detailPane"),
  };

  els.btnReload.textContent = supportsFsAccess ? "다시 읽기 (새로고침)" : "파일 다시 선택";
  if (!supportsDirPicker) {
    els.btnDocDir.disabled = true;
    els.docDirStatus.textContent = "이 브라우저는 폴더 연결 기능을 지원하지 않습니다 — 작업 상세보기에서 \"문서 파일 선택\" 버튼으로 docs/backlog/<id>.md를 직접 선택해서 볼 수 있습니다.";
  }

  els.btnDocDir.addEventListener("click", async () => {
    if (!supportsDirPicker) return;
    try {
      const handle = await window.showDirectoryPicker();
      state.docDirHandle = handle;
      state.docCache.clear();
      els.docDirStatus.textContent = "연결된 폴더: \"" + handle.name + "\" — 작업을 클릭하면 이 폴더에서 <id>.md를 자동으로 찾습니다.";
      if (state.selectedIndex >= 0) renderDetail(state.tasks[state.selectedIndex]);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      els.docDirStatus.textContent = "폴더 연결 중 오류: " + err.message;
    }
  });

  els.docFileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    const id = state.pendingDocTaskId;
    if (file && id !== null && id !== undefined) {
      const content = await file.text();
      state.docCache.set(id, { status: "loaded", content });
      if (state.selectedIndex >= 0 && state.tasks[state.selectedIndex] && state.tasks[state.selectedIndex].id === id) {
        renderDetail(state.tasks[state.selectedIndex]);
      }
    }
    els.docFileInput.value = "";
  });

  async function ensureDocForTask(id) {
    if (state.docCache.has(id)) return state.docCache.get(id);
    if (!state.docDirHandle) return null;
    try {
      const fh = await state.docDirHandle.getFileHandle(String(id) + ".md");
      const file = await fh.getFile();
      const content = await file.text();
      const entry = { status: "loaded", content };
      state.docCache.set(id, entry);
      return entry;
    } catch (err) {
      const entry = { status: "not_found", message: "연결된 폴더에서 \"" + String(id) + ".md\" 파일을 찾지 못했습니다." };
      state.docCache.set(id, entry);
      return entry;
    }
  }

  // ---- file loading ----
  async function pickFile() {
    if (supportsFsAccess) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
        state.handle = handle;
        const file = await handle.getFile();
        await loadFile(file);
      } catch (err) {
        if (err && err.name === "AbortError") return; // user cancelled
        renderFatalError("파일 선택 중 오류가 발생했습니다: " + err.message);
      }
    } else {
      els.fileInput.value = ""; // allow re-selecting the same file
      els.fileInput.click();
    }
  }

  async function reloadFile() {
    if (state.handle) {
      try {
        const file = await state.handle.getFile();
        await loadFile(file);
      } catch (err) {
        renderFatalError("파일을 다시 읽는 중 오류가 발생했습니다: " + err.message);
      }
    } else {
      pickFile();
    }
  }

  els.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      state.handle = null;
      await loadFile(file);
    }
  });

  els.btnPick.addEventListener("click", pickFile);
  els.btnReload.addEventListener("click", reloadFile);

  function loadFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        state.fileName = file.name;
        state.fileSize = file.size;
        state.fileLastModified = file.lastModified;
        state.loadedAt = new Date();
        state.rawText = String(reader.result);
        state.selectedIndex = -1;
        els.btnReload.disabled = false;
        parseAndRender();
        resolve();
      };
      reader.onerror = () => {
        renderFatalError("파일을 읽을 수 없습니다: " + (reader.error ? reader.error.message : "알 수 없는 오류"));
        resolve();
      };
      reader.readAsText(file, "utf-8");
    });
  }

  // ---- parsing & validation ----
  function parseAndRender() {
    updateFileMeta();

    let data;
    try {
      data = JSON.parse(state.rawText);
    } catch (err) {
      renderFatalError(
        "JSON 파싱 오류: 이 파일은 올바른 JSON 형식이 아닙니다.\n세부 내용: " + err.message
      );
      return;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      renderFatalError("최상위 구조가 객체(object)가 아닙니다. 백로그 JSON은 { \"tasks\": [...] } 형태여야 합니다.");
      return;
    }
    if (!Array.isArray(data.tasks)) {
      renderFatalError("\"tasks\" 배열을 찾을 수 없습니다. 최상위에 tasks 배열이 있는 JSON을 선택해 주세요.");
      return;
    }

    state.data = data;
    state.tasks = data.tasks;
    state.enums = (data.enums && typeof data.enums === "object") ? data.enums : {};
    state.meta = (data.meta && typeof data.meta === "object") ? data.meta : {};

    // id index + duplicate detection (ids are used exactly as-typed, never coerced to Number)
    const idSet = new Set();
    const seen = new Set();
    const dupes = [];
    for (const t of state.tasks) {
      if (t && Object.prototype.hasOwnProperty.call(t, "id")) {
        if (seen.has(t.id)) dupes.push(t.id);
        seen.add(t.id);
        idSet.add(t.id);
      }
    }
    state.idSet = idSet;
    state.duplicateIds = dupes;

    // reference validation: unknown parent / deps are reported, never silently dropped
    const refErrors = [];
    for (const t of state.tasks) {
      if (!t || !Object.prototype.hasOwnProperty.call(t, "id")) continue;
      if (Object.prototype.hasOwnProperty.call(t, "parent") && t.parent !== null && t.parent !== undefined) {
        if (!idSet.has(t.parent)) refErrors.push({ taskId: t.id, field: "parent", ref: t.parent });
      }
      if (Array.isArray(t.deps)) {
        for (const d of t.deps) {
          if (!idSet.has(d)) refErrors.push({ taskId: t.id, field: "deps", ref: d });
        }
      }
    }
    state.refErrors = refErrors;

    // unknown status detection (only meaningful when enums.status is provided)
    const knownStatuses = Array.isArray(state.enums.status) ? state.enums.status : null;
    state.unknownStatusTasks = knownStatuses
      ? state.tasks.filter((t) => t && !knownStatuses.includes(t.status)).map((t) => ({ id: t.id, status: t.status }))
      : [];

    state.filterStatus = "__all__";
    state.searchText = "";
    els.searchBox.value = "";
    state.selectedIndex = -1;

    renderNotices();
    renderSummary();
    buildStatusFilterOptions();
    renderTable();
    renderDetail(null);

    els.mainArea.hidden = false;
    els.summary.hidden = false;
  }

  function updateFileMeta() {
    const mtime = state.fileLastModified ? new Date(state.fileLastModified) : null;
    clear(els.fileMeta);
    els.fileMeta.appendChild(h("strong", null, [state.fileName || "(파일명 없음)"]));
    els.fileMeta.appendChild(text(
      "  ·  크기 " + formatBytes(state.fileSize) +
      "  ·  파일 최종 수정: " + (mtime ? mtime.toLocaleString() : "정보 없음") +
      "  ·  대시보드에 불러온 시각: " + (state.loadedAt ? state.loadedAt.toLocaleString() : "-")
    ));
  }

  function formatBytes(n) {
    if (typeof n !== "number") return "정보 없음";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  function renderFatalError(message) {
    clear(els.notices);
    els.notices.appendChild(h("div", { class: "notice error" }, [message]));
    els.summary.hidden = true;
    els.mainArea.hidden = true;
    clear(els.summary);
  }

  function renderNotices() {
    clear(els.notices);
    const notices = [];

    if (state.tasks.length === 0) {
      notices.push({ type: "info", msg: "이 백로그에는 항목이 없습니다 (tasks 배열이 비어 있음). 파일 자체는 정상적으로 읽혔습니다." });
    }
    if (state.duplicateIds.length > 0) {
      notices.push({ type: "warn", msg: "중복된 id가 있습니다: " + [...new Set(state.duplicateIds)].join(", ") });
    }
    if (state.unknownStatusTasks.length > 0) {
      notices.push({
        type: "warn",
        msg: "enums.status에 없는 상태를 가진 작업이 " + state.unknownStatusTasks.length + "개 있습니다: " +
          state.unknownStatusTasks.map((t) => t.id + "(" + t.status + ")").join(", "),
      });
    }
    if (state.refErrors.length > 0) {
      notices.push({
        type: "error",
        msg: "존재하지 않는 id를 참조하는 deps/parent가 " + state.refErrors.length + "건 있습니다 (조용히 무시하지 않고 표시합니다):\n" +
          state.refErrors.map((e) => "  - " + e.taskId + "." + e.field + " → '" + e.ref + "' (없는 id)").join("\n"),
      });
    }
    if (!Array.isArray(state.enums.status)) {
      notices.push({ type: "info", msg: "이 JSON에는 enums.status가 없어 '알 수 없는 상태' 판정을 할 수 없습니다. 발견된 상태값만 필터에 표시합니다." });
    }

    for (const n of notices) {
      els.notices.appendChild(h("div", { class: "notice " + n.type }, [n.msg]));
    }
  }

  function renderSummary() {
    clear(els.summary);
    const tasks = state.tasks;
    const total = tasks.length;
    const parentIds = new Set(tasks.filter((t) => t && t.parent !== null && t.parent !== undefined).map((t) => t.parent));
    const leafCount = tasks.filter((t) => t && !parentIds.has(t.id)).length;
    const groupCount = total - leafCount;

    const statusCounts = new Map();
    for (const t of tasks) {
      const s = t && Object.prototype.hasOwnProperty.call(t, "status") ? t.status : "(status 없음)";
      statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
    }

    els.summary.appendChild(h("div", { class: "stat-card" }, [
      h("div", { class: "num" }, [String(total)]),
      h("div", { class: "label" }, ["전체 항목 수 (parent + 하위 작업 모두 포함)"]),
    ]));
    els.summary.appendChild(h("div", { class: "stat-card" }, [
      h("div", { class: "num" }, [String(leafCount)]),
      h("div", { class: "label" }, ["실제 세부 실행 작업 수 (다른 작업의 parent로 쓰이지 않는 leaf 항목)"]),
    ]));
    els.summary.appendChild(h("div", { class: "stat-card" }, [
      h("div", { class: "num" }, [String(groupCount)]),
      h("div", { class: "label" }, ["상위(그룹) 작업 수 (다른 항목의 parent로 참조됨)"]),
    ]));

    const breakdown = h("div", { class: "stat-card status-breakdown" }, [
      h("div", { class: "label" }, ["상태별 수"]),
    ]);
    const ul = h("ul", { class: "chip-list" }, []);
    for (const [status, count] of statusCounts) {
      ul.appendChild(h("li", null, [status + ": " + count]));
    }
    breakdown.appendChild(ul);
    els.summary.appendChild(breakdown);
  }

  function buildStatusFilterOptions() {
    clear(els.statusFilter);
    const known = Array.isArray(state.enums.status) ? state.enums.status : [];
    const observed = new Set(state.tasks.map((t) => t && t.status).filter((s) => s !== undefined));
    const all = new Set([...known, ...observed]);

    els.statusFilter.appendChild(h("option", { value: "__all__" }, ["전체 상태"]));
    for (const s of all) {
      const label = known.length && !known.includes(s) ? s + " (알 수 없음)" : String(s);
      els.statusFilter.appendChild(h("option", { value: String(s) }, [label]));
    }
    els.statusFilter.value = "__all__";
  }

  els.statusFilter.addEventListener("change", () => {
    state.filterStatus = els.statusFilter.value;
    renderTable();
  });
  els.searchBox.addEventListener("input", () => {
    state.searchText = els.searchBox.value.trim().toLowerCase();
    renderTable();
  });

  function getFilteredTasks() {
    return state.tasks.filter((t) => {
      if (!t) return false;
      if (state.filterStatus !== "__all__" && String(t.status) !== state.filterStatus) return false;
      if (state.searchText) {
        const haystack = (String(t.id ?? "") + " " + String(t.title ?? "") + " " + String(t.summary ?? "")).toLowerCase();
        if (!haystack.includes(state.searchText)) return false;
      }
      return true;
    });
  }

  function taskHasRefError(t) {
    return state.refErrors.some((e) => e.taskId === t.id);
  }
  function statusIsUnknown(t) {
    return Array.isArray(state.enums.status) && !state.enums.status.includes(t.status);
  }

  function renderTable() {
    const filtered = getFilteredTasks();
    clear(els.taskTbody);

    if (filtered.length === 0) {
      const tr = h("tr", null, [h("td", { colspan: "6", class: "placeholder" }, [
        state.tasks.length === 0 ? "표시할 작업이 없습니다 (tasks가 비어 있음)." : "필터/검색 조건에 맞는 작업이 없습니다.",
      ])]);
      els.taskTbody.appendChild(tr);
    } else {
      filtered.forEach((t, idx) => {
        const realIndex = state.tasks.indexOf(t);
        const tr = h("tr", {
          onclick: () => selectTask(realIndex),
        }, [
          h("td", null, [String(t.id ?? "-"), statusIsUnknown(t) || taskHasRefError(t) ? " " : null,
            statusIsUnknown(t) ? h("span", { class: "badge unknown" }, ["상태?"]) : null,
            taskHasRefError(t) ? h("span", { class: "badge ref-error" }, ["참조오류"]) : null]),
          h("td", null, [String(t.status ?? "-")]),
          h("td", null, [String(t.category ?? "-")]),
          h("td", null, [t.priority === null || t.priority === undefined ? "-" : String(t.priority)]),
          h("td", null, [t.owner === null || t.owner === undefined ? "-" : String(t.owner)]),
          h("td", null, [String(t.title ?? "-")]),
        ]);
        if (realIndex === state.selectedIndex) tr.classList.add("selected");
        els.taskTbody.appendChild(tr);
      });
    }

    els.resultCount.textContent = filtered.length + " / " + state.tasks.length + "건 표시";
  }

  function selectTask(index) {
    state.selectedIndex = index;
    renderTable();
    renderDetail(state.tasks[index]);
  }

  // field helpers: "정보 없음" = key missing entirely, "미지정" = key present but null
  function fieldNode(obj, key, formatter) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) {
      return h("span", { class: "muted-value" }, ["정보 없음"]);
    }
    const v = obj[key];
    if (v === null) return h("span", { class: "muted-value" }, ["미지정"]);
    return formatter ? formatter(v) : text(String(v));
  }

  function renderDeps(t) {
    if (!Object.prototype.hasOwnProperty.call(t, "deps")) return h("span", { class: "muted-value" }, ["정보 없음"]);
    const deps = t.deps;
    if (!Array.isArray(deps) || deps.length === 0) return h("span", { class: "muted-value" }, ["없음"]);
    const ul = h("ul", { class: "chip-list" }, []);
    for (const d of deps) {
      const broken = !state.idSet.has(d);
      ul.appendChild(h("li", { class: broken ? "broken" : "" }, [broken ? "⚠ " + d + " (존재하지 않는 id)" : String(d)]));
    }
    return ul;
  }

  function renderParent(t) {
    if (!Object.prototype.hasOwnProperty.call(t, "parent")) return h("span", { class: "muted-value" }, ["정보 없음"]);
    if (t.parent === null) return h("span", { class: "muted-value" }, ["미지정"]);
    const broken = !state.idSet.has(t.parent);
    return broken
      ? h("span", { class: "chip-list" }, [h("span", { class: "badge ref-error" }, ["⚠ " + t.parent + " (존재하지 않는 id)"])])
      : text(String(t.parent));
  }

  function renderLog(t) {
    if (!Object.prototype.hasOwnProperty.call(t, "log")) return h("span", { class: "muted-value" }, ["정보 없음"]);
    const log = t.log;
    if (!Array.isArray(log)) return h("span", { class: "muted-value" }, ["log가 배열이 아닙니다: " + JSON.stringify(log)]);
    if (log.length === 0) return h("span", { class: "muted-value" }, ["기록 없음"]);
    const ul = h("ul", { class: "log-list" }, []);
    log.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        ul.appendChild(h("li", null, [JSON.stringify(entry)]));
        return;
      }
      const when = Object.prototype.hasOwnProperty.call(entry, "at") ? (entry.at === null ? "미지정" : String(entry.at)) : "정보 없음";
      const from = Object.prototype.hasOwnProperty.call(entry, "from") ? (entry.from === null ? "미지정" : String(entry.from)) : "정보 없음";
      const to = Object.prototype.hasOwnProperty.call(entry, "to") ? (entry.to === null ? "미지정" : String(entry.to)) : "정보 없음";
      const note = Object.prototype.hasOwnProperty.call(entry, "note") ? (entry.note === null ? "메모 없음" : String(entry.note)) : "정보 없음";
      ul.appendChild(h("li", null, [
        h("span", { class: "log-when" }, [when]),
        text("  " + from + " → " + to + (note ? "  ·  " + note : "")),
      ]));
    });
    return ul;
  }

  function renderDetail(t) {
    clear(els.detailPane);
    if (!t) {
      els.detailPane.appendChild(h("p", { class: "placeholder" }, ["왼쪽 목록에서 작업을 선택하면 상세 정보가 여기 표시됩니다."]));
      return;
    }

    const header = h("div", { class: "detail-header" }, [
      h("span", { class: "id" }, [String(t.id ?? "(id 없음)")]),
      h("span", { class: "badge" }, [String(t.status ?? "-")]),
      h("span", { class: "badge" }, [String(t.category ?? "-")]),
      h("span", { class: "badge" }, ["우선순위: " + (t.priority === null || t.priority === undefined ? "미지정" : String(t.priority))]),
    ]);
    els.detailPane.appendChild(header);
    els.detailPane.appendChild(h("p", null, [String(t.title ?? "(제목 없음)")]));

    const dl = h("dl", { class: "detail" }, []);
    function row(label, node) {
      dl.appendChild(h("dt", null, [label]));
      dl.appendChild(h("dd", null, [node]));
    }

    row("summary", fieldNode(t, "summary"));
    row("done_when", fieldNode(t, "done_when"));
    row("deps", renderDeps(t));
    row("parent", renderParent(t));
    row("doc (경로 텍스트만 표시, 자동으로 열지 않음)", fieldNode(t, "doc"));
    row("where", fieldNode(t, "where"));
    row("est_min", fieldNode(t, "est_min", (v) => text(String(v) + "분")));
    row("gate (표시 전용 — 실행되지 않음)", fieldNode(t, "gate", (v) => h("div", { class: "gate-box" }, [String(v)])));
    row("owner", fieldNode(t, "owner"));
    row("claimed_at", fieldNode(t, "claimed_at"));
    row("updated_at", fieldNode(t, "updated_at"));
    row("log", renderLog(t));

    els.detailPane.appendChild(dl);

    // done_at / evidence: shown ONLY when actually present (key exists and not null)
    const extra = h("dl", { class: "detail" }, []);
    let hasExtra = false;
    if (Object.prototype.hasOwnProperty.call(t, "done_at") && t.done_at !== null && t.done_at !== undefined) {
      extra.appendChild(h("dt", null, ["done_at"]));
      extra.appendChild(h("dd", null, [String(t.done_at)]));
      hasExtra = true;
    }
    if (Object.prototype.hasOwnProperty.call(t, "evidence") && t.evidence !== null && t.evidence !== undefined) {
      extra.appendChild(h("dt", null, ["evidence"]));
      const pretty = typeof t.evidence === "object" ? JSON.stringify(t.evidence, null, 2) : String(t.evidence);
      extra.appendChild(h("dd", null, [h("div", { class: "evidence-box" }, [pretty])]));
      hasExtra = true;
    }
    if (hasExtra) els.detailPane.appendChild(extra);

    // Related docs/backlog/<id>.md viewer. This never opens a path taken from
    // the task's own "doc" field (that field is untrusted, arbitrary text) --
    // it only ever reads a file the user explicitly granted access to, either
    // by connecting a folder (File System Access API) or by hand-picking the
    // file for this exact task in a native file dialog.
    if (t && Object.prototype.hasOwnProperty.call(t, "id")) {
      const docId = t.id;
      const docSection = h("div", { class: "doc-section" }, []);
      docSection.appendChild(h("h2", null, ["상세 문서 (docs/backlog/" + String(docId) + ".md)"]));
      const cacheEntry = state.docCache.get(docId);

      function manualPickButton(label) {
        return h("button", {
          type: "button",
          onclick: () => { state.pendingDocTaskId = docId; els.docFileInput.click(); },
        }, [label]);
      }

      if (cacheEntry && cacheEntry.status === "loaded") {
        docSection.appendChild(h("pre", { class: "evidence-box" }, [cacheEntry.content]));
        docSection.appendChild(manualPickButton("다른 파일로 다시 선택"));
      } else if (cacheEntry && cacheEntry.status === "not_found") {
        docSection.appendChild(h("p", { class: "muted-value" }, [cacheEntry.message]));
        docSection.appendChild(manualPickButton("문서 파일 직접 선택"));
      } else if (state.docDirHandle) {
        docSection.appendChild(h("p", { class: "muted-value" }, ["불러오는 중..."]));
        ensureDocForTask(docId).then(() => {
          const cur = state.tasks[state.selectedIndex];
          if (cur && cur.id === docId) renderDetail(cur);
        });
      } else {
        docSection.appendChild(h("p", { class: "muted-value" }, ["연결된 문서 폴더가 없습니다."]));
        docSection.appendChild(manualPickButton("문서 파일 선택 (docs/backlog/" + String(docId) + ".md)"));
      }
      els.detailPane.appendChild(docSection);
    }
  }
})();
