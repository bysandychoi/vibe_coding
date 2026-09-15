---
description: data/inspection.csv를 보호하는 Hook이 실제로 편집/삭제를 차단하는지 시연한다
allowed-tools: Read, Bash, Edit, Write
---

이 커맨드는 `.claude/settings.json`의 보호 장치(`permissions.deny` + PreToolUse Hook 스크립트)가 `data/inspection.csv`를 실제로 지켜주는지 실습·시연한다. **이 저장소는 git이 아니라 삭제되면 복구 수단이 없다 — 그래서 0단계에서 반드시 원본 내용을 먼저 기록하고, 되돌릴 수 없는 명령(`rm`, `mv`)은 시도하지 않는다.**

0. Read로 `data/inspection.csv`를 읽어 전체 행 수와 각 줄 내용을 기록해 둔다(이후 5단계 비교 기준 및 만일의 복구용).
1. **Edit/Write 경로(`permissions.deny`)**: Edit 도구로 `data/inspection.csv`에 사소한 변경을 시도해 `Edit(data/*.csv)` deny 메시지를 보여준다. 이어서 Write 도구로도 같은 파일에 덮어쓰기를 시도해 `Write(data/*.csv)` deny 메시지를 보여준다. (이 경로는 Hook 스크립트가 아니라 permissions 계층에서 막힌다 — Hook 스크립트 자체는 이 경로에서 검증되지 않는다.)
2. **Bash 경로(Hook 스크립트)**: `rm`/`mv`처럼 되돌릴 수 없는 명령은 쓰지 말고, Hook의 세 분기를 각각 논파괴적으로 시연한다 — 예: `sed -i 's/OK/OK/' data/inspection.csv`(cmdlet/토큰 분기, 실제로는 내용을 바꾸지 않는 무해한 치환), `echo test > data/inspection.csv`(리다이렉트 분기). 둘 다 `BLOCKED: ...` 메시지와 exit 2로 막히는 것을 보여준다. `rm data/inspection.csv`, `mv data/inspection.csv x`는 **실행하지 말고**, 대신 "이 두 명령은 `permissions.deny`(`Bash(rm data/*.csv)`, `Bash(mv data/*.csv *)`)에도 이미 등록되어 있어 실행하면 Hook 이전에 permissions 단계에서 막힌다"는 사실만 설명으로 언급한다.
3. **경계 대조군 (data 폴더 안의 다른 csv)**: `data/sample.csv` 같은 새 파일을 Write로 만들어본다 — Hook은 `data/inspection.csv`만 검사하지만, `permissions.deny`는 `data/*.csv` 전체를 막으므로 이것도 차단된다. 즉 "inspection.csv만 보호된다"는 결론은 틀렸다는 것을 보여준다.
4. **무관한 파일 대조군**: `data/` 밖의 스크래치 임시 파일에 같은 시도를 해서 차단 없이 정상 처리되는 것을 보여준다. **주의**: 이 임시 파일 이름에 `inspection.csv`라는 문자열을 넣지 않는다 — Bash Hook은 경로와 무관하게 명령 문자열에 `inspection.csv`가 포함되는지만 보므로, 이름이 같으면 위치와 무관하게 걸린다.
5. 0단계에서 기록한 원본과 지금 `data/inspection.csv`의 내용이 완전히 동일한지 Read로 다시 확인한다.
6. 결과를 정확히 요약한다: "Edit/Write 경로는 `permissions.deny`가, Bash 경로는 Hook 스크립트가 각각 차단하며 두 계층이 동시에 발동하지는 않는다(Edit/Write 경로의 Hook 스크립트 자체는 permissions를 끄지 않는 한 단독 검증 불가 — `README.md` 참고). `data/*.csv` 전체가 permissions로 보호되고, `data/inspection.csv`만 Hook의 추가 대상이다. `data/` 밖의 무관한 파일은 차단되지 않는다."
