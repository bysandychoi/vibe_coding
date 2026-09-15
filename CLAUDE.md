# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 프로젝트 안내 (problem.md 기준)
> 이 섹션은 사용자 요청에 따라 `problem.md`의 문제 정의서 초안을 그대로 반영한 프로젝트 설명이다. 아래 "⚠ 실제 저장소 상태" 섹션을 함께 읽을 것.

이 프로젝트는 **REINFORCE 기반 강화학습(RL) 스케줄러의 학습 이상을 조기에 자동 감지**하는 문제를 다룬다.

## 배경
개인 개발 PC에서 REINFORCE 스케줄러를 학습시키는 중이며, 현재는 사람이 로그(entropy, reward)를 주기적으로 눈으로 확인하거나, 가끔 로그를 GPT에 붙여넣어 비정기적으로 판단하는 방식뿐이다. 자동화된 점검 체계는 없다.

- **누가/언제/무엇을**: 개발자 본인(단독 작업)이, 학습을 돌려놓은 뒤 주기적으로 entropy/reward 로그를 확인.
- **겪는 문제**: GPU 자원 제약으로 학습이 느려 문제 발생을 반나절 이상 지나서야 인지하는 경우가 많음, 사람이 눈으로 보다 이상 신호를 놓침, RL 지식이 필요한 판단이라 인수인계가 어려움, 원인이 "망 설계 문제"인지 "파라미터 설정 문제"인지 구분하기 어려움.

## 확인된 사실
- 알고리즘: REINFORCE. Loss는 단일 policy loss. Gradient norm은 전체 망 기준 단일 스칼라.
- 현재 로깅: entropy, reward만 텍스트로 기록됨. loss/gradient norm은 미로깅(기술적 제약 없이 추가 가능).
- 과거 사례: (A) batch 내 reward 값이 전부 0. (B) reward 값이 비정상적으로 커져 loss 변환 과정에서 gradient explosion 발생(단, 당시 gradient norm이 로깅되지 않아 수치로 직접 확인된 것은 아니고 loss 발산 양상으로 추정).
- reward 정체 상태는 최소 50 epoch까지 지켜보는 관행. 환경(env)은 하나로 고정 운용.

## 범위
- **포함**: 학습 망 자체의 수치적 이상 감지 — NaN/Inf loss, gradient explosion, gradient vanishing, entropy collapse, loss-reward 불일치(두 지표가 다른 방향으로 움직이는 경우).
- **제외**: "reward가 결국 오르는지"와 같은 성능/수렴 판단(기존처럼 최대 50 epoch까지 기다려 판단해도 무방).

## 결정된 사항

| 항목 | 결정 |
|---|---|
| 대상 환경 | 단일 env 고정 |
| 목표 감지 시간 | 문제 발생 시 늦어도 50 epoch 또는 2시간 이내 인지 |
| 로깅 지표 | entropy, reward, policy loss, gradient norm(전체망) — epoch 단위 |
| 감지 방식 | 하이브리드: 규칙 기반 + AI(Codex CLI) 판단 |
| 규칙 기반 대상 | NaN/Inf loss, gradient explosion → 로컬에서 즉시 판단 |
| AI 판단 대상 | gradient vanishing, entropy collapse, loss-reward 불일치 → Codex CLI가 판단(수 초~수십 초 지연 허용) |
| Gradient explosion 임계치 | 정상 학습 5회를 baseline으로 관찰 후 고정 임계치 설정(현재 미정) |
| 체크 주기 | 기본값은 매 epoch, 조절 가능해야 함 |
| Codex 판단 입력 범위 | 고정 N epoch이 아니라 Codex가 로그 파일에 접근해 스스로 필요한 만큼 과거 이력을 읽음 |
| 알림 채널 | 이메일 + 텍스트 파일 생성 |
| 알림 내용 | 이상 여부 결과 + (Codex 판단 시) 판단 근거 설명 |
| 알림 수신자 | 본인만 |
| 개입 수준 | 알림만 발송, 학습 자동 중단은 하지 않음 |

## 미결 질문 (사용자가 결정해야 함, problem.md §8)
- gradient explosion 임계치를 baseline 5회 관찰 후 어떤 통계량(평균+표준편차/최댓값/percentile 등)으로 산출할지 — 미정
- "정상 run" 5회를 어떻게 정의/판별할지 — 미정
- 텍스트 파일 알림의 저장 위치/파일명 규칙/포맷 — 미논의
- 이메일 발송 설정(발신 계정, 인증 방식) — 미논의
- Codex CLI가 gradient vanishing/entropy collapse/loss-reward 불일치를 판단할 구체적 기준 — 미정의(전적으로 위임하기로만 결정됨)
- 체크 주기 조절 방식(실행 인자 vs 설정 파일 등) — 미논의
- 기존 entropy/reward 텍스트 로그의 정확한 포맷(구분자, 컬럼 구조)이 파싱 가능한 형태인지 — 미확인

---

## ⚠ 실제 저장소 상태 (중요)
`problem.md`가 설명하는 RL 이상 감지 시스템(로깅 확장, 규칙 기반 체크, Codex CLI 연동, 이메일/파일 알림)은 아직 **코드로 구현되어 있지 않다** — `problem.md`는 문제 정의서 초안이고, 결정이 필요한 항목은 `backlog.json`의 T2 트랙(`T2-1`~`T2-6`, `category=decision`은 `owner=user`)으로 관리된다.

이 저장소에는 그 위에 **백로그 기반 작업 관리 체계**가 실제로 구축되어 있다:

- `backlog.json` — 작업 백로그(schema 1.1). 직접 Read/Grep은 Hook으로 차단되어 있으므로 반드시 `node tools/backlog-cli.mjs`로 조회한다(`list`/`show <id>`/`ready --explain`/`walk`/`schema`/`validate`). enum·meta 전체 목록은 `node tools/backlog-cli.mjs schema`로 확인한다(여기 복사하지 않음).
- `tools/backlog-cli.mjs` — 조회는 자유, 변경(`add`/`set-status`/`set-field`)은 직전 조회의 `sha256`을 `--expect-sha256`으로 요구해 버전 충돌을 막고, `.backlog-backups/`에 백업 후 원자적으로 쓴다. `category=decision` 작업은 `set-status ... done`을 CLI 스스로 거부한다.
- `.claude/agents/critical-reviewer.md` — 읽기 전용(Read/Grep/Glob) 비판 검토 subagent(opus). `backlog.json`을 직접 읽을 수 없으므로 호출 측이 CLI로 조회한 태스크 데이터를 프롬프트에 넣어줘야 한다.
- `.claude/agents/backlog-explainer.md` — 문서화 subagent(haiku, Read/Grep/Glob/Write). `docs/backlog/<id>.md`만 새로 쓰며 JSON·코드는 건드리지 않는다. 마찬가지로 태스크 데이터는 프롬프트로 전달받는다.
- `docs/backlog/*.md` — 위 subagent가 생성한 태스크별 설명 문서(각 문서 상단에 생성 당시 `sha256` 기록). 태스크가 바뀌어도 자동 갱신되지 않는다.
- `backlog-dashboard.html` — 정적 읽기 전용 대시보드. `backlog.json`을 자동 fetch하지 않고 파일 선택창으로 수동 로드한다(자동 새로고침 없음).
- `.claude/settings.json`의 Hook: (1) `data/inspection.csv` Edit/Write·삭제성 명령 차단, (2) `backlog.json` Edit/Write 결과의 schema/enum·decision-done 정책 검사, (3) `backlog.json` 직접 Read/Grep/Bash 읽기 차단, (4) PostToolUse로 `tools/checks/post-edit-check.mjs`(length/build/lint) 실행, (5) Stop으로 `tools/checks/stop-check.mjs`(전체 재검사) + TTS 완료 알림.
- `.claude/rules/data-handling.md` — 점검 데이터(`data/inspection.csv`) 취급 규칙(기존 유지, NG인데 action_note 공백이면 메모 누락, OK 행은 메모 필수 규칙 미적용, 허용 값 외 result는 임의로 바꾸지 않고 질문).
- `.claude/rules/backlog-workflow.md` — 백로그 변경 주체·상태 전이·역할 분리·문서 갱신 규칙(신규, 아래 "작업 절차"에서 사용).
- `npm run check`(`lint`+`build`+`check:length`)로 Stop Hook과 동일한 검사를 수동 재현할 수 있다.

`.claude/rules/*.md`는 CLAUDE.md와 함께 세션 시작 시 프로젝트 지침으로 자동 로드된다(이 세션에서 직접 확인됨) — 별도 `@import` 없이 파일만 두면 적용된다.

README.md가 언급하는 `/inspection-check`, `problem-reader` 서브에이전트, `/hooks` 실습은 여전히 미구현이며 `backlog.json`의 T1 트랙(`T1-1`~`T1-4`)으로 추적된다.

## 작업 절차 (백로그 기반 실행 순서)
실제 작업(백로그의 T1/T2 태스크 구현)은 아래 순서를 따른다. 각 단계는 위에 나열된 실제 파일·명령만 사용한다.

1. **기준·백로그·규칙 확인**: `problem.md`(기준 요구사항, `backlog.json.meta.context_doc`) → `node tools/backlog-cli.mjs list`로 백로그 조회 → `.claude/rules/*.md`(`data-handling.md`, `backlog-workflow.md`)로 적용 규칙 확인.
2. **작업 선택**: `node tools/backlog-cli.mjs ready --explain`으로 `status=todo`이며 `deps`가 모두 `done`인 후보만 본다. `gate`가 있으면 실제로 통과 가능한지, `est_min`이 `meta.max_est_min`(현재 30분) 이내인지 확인해 작은 작업을 고른다. `category=decision`(owner=user) 작업은 선택하지 않는다.
3. **착수 기록**: `node tools/backlog-cli.mjs set-status <id> in_progress --expect-sha256 <hash>`. `owner`/`claimed_at` 등은 `set-field`로 실제 착수 시각·담당 기준 그대로 기록한다(하지 않은 것을 했다고 적지 않는다). `backlog.json`을 Edit 도구로 직접 고치지 않는다.
4. **구현 + Hook 검사**: 코드 구조 규칙(300줄 제한, ESLint/pylint, 문법 검사)을 지키며 구현 — 저장할 때마다 PostToolUse Hook(`post-edit-check.mjs`)이 자동 실행된다. 필요하면 `npm run check`로 전체 재현.
5. **입력 버전 고정 + 병렬 실행**: 대상 태스크를 `show`/`list --json`으로 다시 조회해 그 시점의 `sha256`을 기록해 고정한다. 그 데이터를 프롬프트에 넣어 `critical-reviewer`(비판)와 `backlog-explainer`(문서화)를 병렬로 실행한다. 두 subagent가 도는 동안에는 해당 태스크의 `backlog.json`을 갱신하지 않는다(입력이 흔들리지 않게).
6. **결과 반영**: `critical-reviewer`가 파일 확인까지 마친 "확인된 사실" 근거의 Critical/High 지적만 우선 수정하고(추측 항목은 직접 확인 후에만 반영), 수정한 만큼 4번의 Hook 검사를 다시 수행한다.
7. **완료 기록**: `done_when`이 실제로 충족됐다는 구체적 근거(파일/명령 출력) + Hook 검사 통과 + `critical-reviewer`의 confirmed 지적이 더 이상 없음, 세 가지가 모두 확인된 경우에만 `set-status <id> done --expect-sha256 <hash>`. 근거가 부족하면 `needs_info`로 전이하고 확인 질문을 남긴다. `category=decision` 작업은 CLI가 자동 `done`을 거부하므로 사용자가 직접 결정·기록한다.
8. **문서·대시보드 갱신 확인**: 상태를 바꾼 태스크는 `backlog-explainer`로 `docs/backlog/<id>.md`를 다시 생성해 `sha256`을 최신화한다. `backlog-dashboard.html`은 자동 새로고침되지 않으므로 브라우저에서 파일을 다시 선택해 확인한다.
9. **재개 가능한 상태 유지**: 상태가 바뀔 때마다(2~8단계 중 어느 시점이든) 바로 `set-status`/`set-field`로 `backlog.json`에 반영한다. `log` 배열에 `from`/`to`/`note`가 자동 기록되므로, 언제 멈췄다 다시 시작해도 `show <id>`로 이력을 보고 이어갈 수 있다.

세부 규칙(백로그 변경 주체, 상태 전이, 역할 분리, 문서 갱신 조건, 각 규칙의 적용 방식)은 `.claude/rules/backlog-workflow.md` 참고.

## 작업 원칙
- 파일의 내용을 답할 때는 실제 파일을 먼저 읽는다.
- 확인한 사실, 추정, 아직 모르는 점을 구분한다.
- 기능이나 업무 정책이 모호하면 임의로 결정하지 말고 질문한다.
- 실행하지 않은 검사나 테스트를 통과했다고 말하지 않는다.
- 결과에는 읽은 파일과 확인하지 못한 항목을 간단히 남긴다.
- 리뷰 미실행 / 검사 실패 / 미설정(대상 없음) 검사는 완료 근거로 쓰지 않는다.
