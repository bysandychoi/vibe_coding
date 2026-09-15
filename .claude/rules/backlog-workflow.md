# 백로그 작업 규칙 (backlog.json 기반)

`CLAUDE.md`의 "작업 절차"에서 쓰는 세부 규칙이다. 대상: `backlog.json`, `tools/backlog-cli.mjs`, `.claude/agents/critical-reviewer.md`, `.claude/agents/backlog-explainer.md`, `docs/backlog/*.md`, `backlog-dashboard.html`.

## 백로그 변경 주체

- `backlog.json`을 바꿀 수 있는 것은 **메인 세션(사용자와 직접 대화하는 Claude)**뿐이다. subagent는 바꾸지 않는다: `critical-reviewer`는 Read/Grep/Glob만 가지고 있어 애초에 쓸 수 없고, `backlog-explainer`는 Write가 있어도 `docs/backlog/`만 쓰도록 지시돼 있다.
- 변경은 항상 `node tools/backlog-cli.mjs add|set-status|set-field ... --expect-sha256 <hash>`로 한다. Edit/Write 도구로 `backlog.json`을 직접 고쳐도 schema/enum만 맞으면 Hook은 통과하지만, `--expect-sha256` 버전 검사·`.backlog-backups/` 백업·원자적 쓰기를 건너뛰게 되므로 쓰지 않는다.
- **동시 실행 규칙**: `critical-reviewer`/`backlog-explainer`를 병렬로 돌리는 동안에는 그 입력이 된 태스크(들)의 `backlog.json`을 갱신하지 않는다. 두 subagent는 실행 시점에 고정해 전달한 태스크 데이터만 보므로, 그 사이 메인 세션이 같은 태스크를 바꾸면 결과가 어느 시점 기준인지 알 수 없게 된다. 병렬 실행이 끝나고 결과를 반영한 뒤에 상태를 바꾼다.

## 상태 전이

`enums.status`(조회: `node tools/backlog-cli.mjs schema`): `todo → in_progress → in_review → (done | needs_info | blocked | cancelled)`.

- `todo → in_progress`: 착수 시 기록.
- `in_progress → in_review`: 구현 완료 + Hook 검사(post-edit 또는 `npm run check`) 통과 + `critical-reviewer` 검토 대기.
- `in_review → done`: 아래 세 조건을 **모두** 만족할 때만.
  1. `done_when`이 충족됐다는 구체적 근거(파일 경로, 명령 출력 등)가 있다.
  2. 관련 Hook 검사가 실제로 실행되어 통과했다(미실행·실패·대상 없음은 근거로 인정하지 않는다).
  3. `critical-reviewer`가 confirmed로 남긴 Critical/High 지적이 없다(또는 모두 해소됨).
  - `category=decision` 작업은 `owner=user`이며, `done` 전이는 기본적으로 CLI(`set-status`)와 Edit/Write Hook 둘 다 자동 거부한다. **다만 이 시스템은 "사용자가 직접 타이핑했다"와 "메인 세션이 사용자 대신 CLI를 실행했다"를 기술적으로 구분할 방법이 없다** — 항상 메인 세션이 CLI를 실행하는 경로뿐이다. 그래서 사용자가 대화 중 실제로 결정을 내렸을 때(AskUserQuestion 등으로 명시적으로 확인된 경우)는, `set-field`로 결정 내용을 `evidence`에 먼저 기록한 뒤 `set-status <id> done --user-confirmed --expect-sha256 <hash>`로 명시적 override 플래그를 써서 완료 처리할 수 있다. `--user-confirmed` 없이, 또는 `evidence`가 비어있는 채로는 여전히 거부된다. 이 플래그는 신원을 암호학적으로 증명하지 않는다 — "사용자의 실제 결정을 근거 없이 대신 내리지 않았다"는 것을 로그(`log` 배열의 `note`에 자동 기록됨)로 남기는 감사 장치일 뿐이므로, 실제로 사용자가 명시적으로 선택하지 않은 내용에 이 플래그를 쓰지 않는다.
- **`needs_info`**: 사람의 판단이 필요한 모호한 지점(요구사항 불명확, `decision` 태스크의 선행 조건 등)을 만나면 임의로 정하지 않고 `set-status <id> needs_info --note "<질문>"`으로 전이한다. 질문은 `note`에 남기고, 해당 태스크의 `docs/backlog/<id>.md` "확인 질문" 절에도 반영한다.
- `blocked`: deps가 아직 `done`이 아니거나(`ready --explain`의 blocked 목록) 외부 요인으로 진행이 불가할 때.

## 코드/역할 책임 분리

| 주체 | 권한 | 하는 일 | 하지 않는 일 |
|---|---|---|---|
| 메인 세션 | 전체 도구 | 구현, `backlog.json` 조회/변경(CLI로만), 최종 `done`/`needs_info` 판단 | `category=decision` 대신 결정 |
| `critical-reviewer` | Read/Grep/Glob | 근거 있는 비판(Critical/High/Medium) | 파일 수정, 승인/rubber-stamp, `backlog.json` 변경 |
| `backlog-explainer` | Read/Grep/Glob/Write(`docs/backlog/`만) | 태스크별 온보딩 문서 생성 | `backlog.json`·코드 수정, 요구사항/숫자 창작 |
| 사용자 | 모든 결정 권한 | `category=decision` 태스크 결정 | — |

## 문서 갱신 시점·경로·조건

- **언제**: 태스크 상태가 바뀌거나(특히 `done`/`needs_info`) 태스크 내용(`summary`/`done_when`/`deps` 등)이 바뀐 직후.
- **어떻게**: `backlog-explainer`를 그 태스크의 최신 데이터(방금 조회한 `sha256` 기준)로 다시 호출해 `docs/backlog/<id>.md`를 재생성한다. 기존 파일은 덮어써 `sha256`을 최신화한다 — 문서는 생성 시점 `sha256`을 기록할 뿐 자동 추적되지 않는다.
- **대시보드**: `backlog-dashboard.html`은 정적 파일이라 `backlog.json` 변경을 자동 반영하지 않는다. 최신 상태를 보려면 브라우저에서 파일 선택창으로 `backlog.json`(및 필요 시 갱신된 `docs/backlog/<id>.md`)을 다시 로드해야 한다.

## 완료 근거로 인정하지 않는 것

- 실행하지 않은 검사("돌렸을 것이다" 금지).
- 실패한 검사를 통과로 보고.
- 대상이 없어 스킵된 검사(예: `.py` 파일이 없어 pylint가 `INFO`만 낸 경우)를 그 언어의 통과로 간주.
- `critical-reviewer`를 부르지 않고 "리뷰 완료"로 기록.

위 중 하나라도 해당하면 `done`이 아니라 `in_review`를 유지하거나 `needs_info`로 남긴다.

## 규칙별 적용 방식

| 규칙 | 적용 방식 |
|---|---|
| `backlog.json` 직접 Read/Grep/Bash 읽기 금지 | **Hook** (`.claude/settings.json` PreToolUse: Read/Grep/Bash matcher) |
| `backlog.json` 변경 결과가 schema/enum을 만족해야 함 | **Hook** (PreToolUse Edit\|Write matcher) |
| `category=decision` 태스크는 자동 `done` 불가 | **Hook**(Edit/Write 결과 검사, override 없음) + **CLI**(`set-status`는 `--user-confirmed` + 비어있지 않은 `evidence` 둘 다 있어야만 허용) |
| `backlog.json` 변경은 CLI로만(버전/백업/원자적 쓰기) | **지침** (Hook은 schema만 보고, CLI 사용 자체는 강제하지 않는다) |
| `data/inspection.csv` 읽기 전용 | **Hook** (`.claude/rules/data-handling.md` 참고) |
| 코드 300줄 제한 · 문법 · lint | **Hook** (PostToolUse `post-edit-check.mjs`, Stop `stop-check.mjs`) |
| `ready`/`gate`/`est_min` 기준으로 작은 작업 선택 | **지침** (CLI는 후보를 보여줄 뿐, 선택 자체를 강제하지 않는다) |
| 동시 실행 중 입력 고정(메인만 JSON 갱신) | **지침** (subagent 도구 권한이 구조적으로 뒷받침하지만, "지금 갱신하지 않기" 판단은 강제되지 않는다) |
| Critical/High 지적 해소 여부 | **리뷰** (`critical-reviewer` 실행 결과로 확인) |
| `done_when` 실제 충족 여부 | **지침 + 리뷰** (자동 게이트가 없는 태스크는 사람/메인 세션 판단, `gate`가 설정되면 그 게이트로 검사) |
| `docs/backlog/*.md` 최신화 | **지침** (자동 트리거 없음, 재호출 여부는 메인 세션이 판단해 수행) |
