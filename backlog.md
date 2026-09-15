# Backlog 개요

_source: `backlog.json` sha256=`3780ee2ab823`… , schema=1.1, task_count=13 (as of this doc's generation via `node tools/backlog-cli.mjs list --json`)_

> `backlog.json`은 이 저장소의 PreToolUse Hook(`.claude/settings.json`)에 의해 Read/Grep 직접 접근이 차단되어 있습니다.
> 원본을 확인하려면 `node tools/backlog-cli.mjs show <id>` 또는 `list`/`ready`/`walk`를 사용하세요.
> 이 파일은 그 조회 결과를 스냅샷으로 정리한 색인이며, `backlog.json`이 바뀌면 최신이 아닐 수 있습니다.

각 태스크의 목적·수행 순서·done_when 확인법 등 상세 설명은 `docs/backlog/<id>.md` 문서를 참고하세요(전부 `backlog-explainer` 서브에이전트로 생성됨).

## T1 — 저장소 실습: 점검 기록/Hook 미구현 항목

| id | 상태 | 분류 | owner | parent | deps | 상세 문서 |
|---|---|---|---|---|---|---|
| [T1](docs/backlog/T1.md) | todo | infra | - | - | - | [T1.md](docs/backlog/T1.md) |
| [T1-1](docs/backlog/T1-1.md) | todo | test | - | T1 | - | [T1-1.md](docs/backlog/T1-1.md) |
| [T1-2](docs/backlog/T1-2.md) | todo | feature | - | T1 | - | [T1-2.md](docs/backlog/T1-2.md) |
| [T1-3](docs/backlog/T1-3.md) | todo | feature | - | T1 | - | [T1-3.md](docs/backlog/T1-3.md) |
| [T1-4](docs/backlog/T1-4.md) | todo | feature | - | T1 | T1-1 | [T1-4.md](docs/backlog/T1-4.md) |

## T2 — problem.md: RL 스케줄러 이상 감지 시스템 설계

| id | 상태 | 분류 | owner | parent | deps | 상세 문서 |
|---|---|---|---|---|---|---|
| [T2](docs/backlog/T2.md) | todo | spike | - | - | - | [T2.md](docs/backlog/T2.md) |
| [T2-1](docs/backlog/T2-1.md) | todo | decision | **user** | T2 | - | [T2-1.md](docs/backlog/T2-1.md) |
| [T2-2](docs/backlog/T2-2.md) | todo | decision | **user** | T2 | - | [T2-2.md](docs/backlog/T2-2.md) |
| [T2-3](docs/backlog/T2-3.md) | todo | decision | **user** | T2 | - | [T2-3.md](docs/backlog/T2-3.md) |
| [T2-4](docs/backlog/T2-4.md) | todo | decision | **user** | T2 | - | [T2-4.md](docs/backlog/T2-4.md) |
| [T2-5](docs/backlog/T2-5.md) | todo | docs | - | T2 | T2-1, T2-2 | [T2-5.md](docs/backlog/T2-5.md) |
| [T2-6](docs/backlog/T2-6.md) | todo | decision | **user** | T2 | - | [T2-6.md](docs/backlog/T2-6.md) |
| [T2-7](docs/backlog/T2-7.md) | todo | test | - | T2 | - | [T2-7.md](docs/backlog/T2-7.md) |

## 갱신 방법

`backlog.json`이 바뀌면 이 파일도 다시 만들어야 합니다:

```bash
node tools/backlog-cli.mjs list --json
```

위 명령의 `source.sha256`이 이 문서 상단의 값과 다르면 내용이 오래된 것이니, 표와 `docs/backlog/*.md`를 함께 갱신하세요.
