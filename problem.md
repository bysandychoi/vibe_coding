# 문제 정의서 (Draft) — 강화학습 스케줄러 학습 이상 조기 감지

> 본 문서는 인터뷰를 통해 정리한 **문제 정의서 초안**입니다. 구현/설정 관련 내용은 포함하지 않았습니다.

---

## 1. 배경

REINFORCE 기반 강화학습 스케줄러를 개인 개발 PC에서 학습시키고 있다. 학습이 정상적으로 진행되고 있는지는 현재 사람이 직접 로그(entropy, reward)를 주기적으로 눈으로 확인하거나, 가끔 로그를 GPT에 붙여넣어 비정기적으로 물어보는 방식으로 판단하고 있다. 자동화된 점검 체계는 없다.

## 2. 누가 / 언제 / 무엇을 하다가

- **누가:** 개발자 본인 (개인 개발 PC, 단독 작업)
- **언제:** 학습을 돌려놓은 뒤, 주기적으로 로그를 확인할 때
- **무엇을:** entropy, reward 로그를 텍스트로 확인 (때때로 GPT에 물어봄)
- **겪는 불편/손실:**
  - 자원(GPU 등) 제약으로 학습 진행 자체가 느려서, 문제가 있었다는 사실을 **반나절 이상 지나서야** 알게 되는 경우가 많음
  - 사람이 눈으로 보다 보니 이상 신호를 놓치는 경우가 있음
  - 강화학습 지식이 필요한 판단이라, 이 작업을 다른 사람이 새로 익히기 어려움
  - 문제를 발견해도 원인이 "망 설계 문제"인지 "파라미터 설정 문제"인지 구분하기 어려움

## 3. 확인한 사실 (Facts)

- 알고리즘: REINFORCE
- Loss: 단일 policy loss
- Gradient norm: 전체 망 기준 단일 스칼라 값
- 현재 로깅: entropy, reward만 텍스트로 기록됨. loss, gradient norm 등은 현재 로깅되지 않음 (기술적 제약 없이 추가 가능)
- 과거에 겪은 구체적 사례:
  - **사례 A:** batch 내 reward 값이 전부 0
  - **사례 B:** reward 값이 비정상적으로 커졌고, 이를 loss로 변환하는 과정에서 gradient explosion이 발생함
- reward가 오르지 않고 정체된 상태를 최소 50 epoch까지는 지켜보는 편임
- 환경(env)은 하나로 고정해서 운용

## 4. 원인 가설 (Hypotheses — 아직 계측으로 완전히 검증되지 않음)

- 사례 B(gradient explosion)는 "reward 값이 과도하게 큼 → loss 변환 시 값이 커짐 → gradient 폭발"이라는 인과관계로 추정하고 있으나, 당시 gradient norm 자체가 로깅되지 않아 **수치로 직접 확인된 것은 아님** (loss 급증/발산 양상을 보고 추정)
- "reward가 오르지 않는 정체"는 원인이 두 가지로 나뉠 수 있다고 봄:
  1. reward 설계/설정 자체의 문제 (확인까지 시간이 걸려도 괜찮다고 판단)
  2. 망 자체의 수치적 이상 (gradient vanishing, entropy collapse 등) — 이쪽은 빠르게 알고 싶음
  - 다만 이 두 원인을 실제로 어떻게 구분할지는 이번 문제 정의의 핵심 동기이며, 아직 검증된 방법은 아님

## 5. 범위 (Scope)

**포함:**
- 학습 망 자체의 수치적 이상 감지
  - NaN/Inf loss
  - Gradient explosion
  - Gradient vanishing
  - Entropy collapse
  - Loss–reward 불일치 (개선/악화 방향이 어긋나는 경우 — 구체적 판정 기준은 §9.3)

**제외 (이번 요구사항 범위 밖):**
- "reward가 결국 오르는지"와 같은 **성능/수렴 판단** — 이건 기존처럼 최대 50epoch까지 기다려서 판단해도 무방함

## 6. 결정된 사항 (Decisions)

| 항목 | 결정 |
|---|---|
| 대상 환경 | 단일 env 고정 |
| 목표 감지 시간 | 문제 발생 시 늦어도 **50 epoch 또는 2시간 이내** 인지 |
| 로깅 지표 | entropy, reward, policy loss, gradient norm(전체망) — **epoch 단위**로 기록 |
| 감지 방식 | 하이브리드: 규칙 기반 + AI(Codex CLI) 판단 |
| 규칙 기반 대상 | NaN/Inf loss, gradient explosion → 로컬에서 즉시 판단 |
| AI 판단 대상 | gradient vanishing, entropy collapse, loss-reward 불일치 → Codex CLI가 판단, 수 초~수십 초 지연은 허용 |
| Gradient explosion 임계치 결정 방법 | 정상 학습 **5회를 baseline으로 관찰**한 뒤 고정 임계치 설정. 통계량은 **평균 + k×표준편차**(baseline 5회의 epoch별 gradient_norm 값을 풀링해 산출, **처음 5epoch(warmup)은 제외** — §9.1의 warmup 처리와 동일), **k=5**를 초기값으로 사용하고 baseline 관찰 후 오탐/누락 여부를 보고 조정 가능. *(§9 작성 시 추가된 가정 — 미확정: baseline 5회 수집 시 gradient_norm뿐 아니라 entropy/reward/policy_loss도 함께 보관한다는 전제가 필요함. §6 로깅 지표를 그대로 5회 동안 기록하면 되므로 새 계측은 아니지만, T2-1 결정 당시 이 범위까지 명시적으로 정하지는 않았다 — 확인 필요)* |
| "정상 run" 5회 판별 기준 | **최소 자동 필터 + 사람 최종 승인**. 자동 필터: (1) NaN/Inf loss·gradient 없이 완주, (2) 중단 없이 설정된 epoch까지 정상 종료, (3) reward가 batch 전체에서 0인 epoch 없음(과거 사례 A 배제). 필터를 통과한 후보 run 중에서 최종적으로 5회를 사람이 골라 확정 |
| 체크 주기 | 기본값은 매 epoch이며, **조절 가능**해야 함. 조절 방식은 **설정 파일(`config.yaml`, 저장소 루트)** — 실행 인자가 아님. 이 파일은 향후 gradient explosion 임계치·알림 파일 경로/포맷 등 다른 T2 결정값도 같이 담는 공용 설정 파일로 쓴다(각 항목의 정확한 키 이름은 해당 결정이 날 때 함께 정함) |
| Codex 판단 시 입력 범위 | 고정된 N epoch이 아니라, **Codex가 로그 파일에 접근해 스스로 필요한 만큼 과거 이력을 읽음** |
| 알림 채널 | **텍스트 파일 생성만 사용(이메일 발송은 취소됨 — T2-4 결정)**. 텍스트 파일은 `logs/alerts/` 디렉터리(저장소 루트 기준)에 저장하고, 파일명은 `YYYYMMDD-HHMMSS_epochNNN.txt` 형식(생성 시각 타임스탬프 + epoch 번호)으로 한다 — 예: `20260915-143022_epoch042.txt` |
| 알림 내용 | 이상 여부 결과 + (Codex 판단의 경우) **판단 근거 설명 포함** |
| 알림 수신자 | 본인만 |
| 개입 수준 | **알림만 발송, 학습 자동 중단은 하지 않음** |

## 7. 입력 / 기대 결과 예시

> 아래 수치는 구조를 설명하기 위한 예시이며, 실제 임계치는 baseline 5회 관찰 전까지는 초기값입니다 (§6, §9 참고).

### 예시 1 — 규칙 기반: gradient explosion (즉시 알림)

**입력 (epoch 로그, 예시)**
```
epoch: 42
policy_loss: 128.7   (직전 epoch 대비 급격히 큼)
gradient_norm: 950.2 (baseline 대비 이상 수치)
reward: 812.4        (비정상적으로 큰 값)
entropy: 0.63
```

**기대 결과**
- 규칙 기반 체크가 즉시 "이상"으로 판정
- 텍스트 파일로 즉시 알림 발송
- 알림 내용: "epoch 42에서 gradient explosion 감지 (gradient_norm=950.2, 임계치 초과)"
- 학습은 계속 진행됨 (자동 중단 없음)

### 예시 2 — AI(Codex) 판단: entropy collapse (지연 허용)

**입력 (Codex CLI에게 로그 파일 경로 전달, Codex가 스스로 필요한 만큼 과거 이력 조회)**
```
최근 몇 epoch간 entropy 추이 (Codex가 직접 로그에서 조회):
epoch 30: entropy 0.58
epoch 35: entropy 0.31
epoch 40: entropy 0.09
epoch 42: entropy 0.02
```

**기대 결과**
- Codex CLI가 로그를 조회해 "entropy가 지속적으로 급격히 감소하여 탐색이 거의 멈춘 상태로 판단됨"이라고 응답 (수 초~수십 초 소요 가능)
- 텍스트 파일로 알림 발송
- 알림 내용: 이상 여부 + Codex의 판단 근거 문장 포함
- 학습은 계속 진행됨

### 예시 3 — 정상 케이스 (알림 없음)

**입력**
```
epoch: 50
policy_loss: 4.2   (baseline 범위 내)
gradient_norm: 12.1 (baseline 범위 내)
reward: 18.5
entropy: 0.71 (완만하게 감소 중, collapse 아님)
```

**기대 결과**
- 규칙 기반 체크: 이상 없음
- Codex 판단: 이상 없음
- 알림 없음, 학습 계속 진행

## 8. 미결 질문 (Open Questions — 사용자가 결정해야 함)

- ~~기존 entropy/reward 텍스트 로그의 정확한 포맷~~ — **해결됨**: 실제 로그 파일이 아직 없어서(이 저장소는 설계 단계, 실제 REINFORCE 학습 코드는 별도 환경) 기존 포맷을 확인하는 대신 새 포맷을 직접 설계하고 가상 샘플로 파싱 가능성을 검증했다. 아래 §8-1 참고.

### 8-1. 로그 포맷 설계 (T2-7 — 가상 샘플로 검증, critical-reviewer 2라운드 반영)

- **포맷**: CSV, 헤더 `run_id,epoch,timestamp,entropy,reward,reward_all_zero,policy_loss,gradient_norm`, 한 epoch당 한 줄.
  - `run_id`: baseline 5회를 구분하기 위한 식별자(문자열). **파일 규칙**: run 1개 = 파일 1개, 경로 `logs/runs/<run_id>.csv`. `logs/samples/`는 합성(가상) 데이터 전용이며 **baseline 풀링 대상에서 제외**한다(디렉터리로 구분 — 파서가 별도 마커를 파싱할 필요 없음).
  - `epoch`: 1부터 시작하는 연속 정수. 중복·역행 없음. 학습을 resume해도 1로 리셋하지 않고 누적 번호를 유지한다.
  - `timestamp`: ISO8601(UTC). 해당 epoch가 끝난 시각 — §6 "50 epoch 또는 2시간 이내" 감지 목표를 실제 경과 시간으로 검증하려면 epoch 번호만으로는 부족하기 때문에 추가함.
  - `entropy`/`reward`/`policy_loss`/`gradient_norm`: 실수. **NaN/Inf는 소문자 `nan`/`inf`/`-inf` 문자열로 기록**하고, 파서는 이 세 토큰을 "값이 NaN/Inf임"으로 인식하되 "파싱 실패"와는 구분한다(NaN 자체가 규칙 기반 1순위 감지 대상이므로, 파싱 실패로 취급해 그 행을 건너뛰면 정작 잡아야 할 이상을 놓친다).
  - `reward_all_zero`: `true`/`false`. 해당 epoch의 배치 내 reward가 전부 0이었는지를 로깅 시점에 계산해 기록(§3 과거 사례 A 배제용 — epoch 단위 평균 reward 하나만으로는 "배치 전체가 0"과 "양/음이 상쇄돼 평균만 0"을 구분할 수 없어서 별도 플래그로 뺐다). `reward` 컬럼 자체는 **해당 epoch batch의 평균**으로 정의한다.
  - §6 "로깅 지표" 결정(entropy/reward/policy loss/gradient norm을 epoch 단위로 기록)에 `run_id`/`timestamp`/`reward_all_zero`를 추가했다 — 모두 이미 로깅 시점에 계산 가능한 메타데이터이지 새 계측 지표는 아니다.
- **baseline 풀링 시 warmup 제외**: §9.1이 처음 5epoch(`warmup_epochs`)을 제외하는 것과 동일하게, §6의 gradient explosion 임계치(평균+k×표준편차) 산출용 baseline 풀링에도 처음 5epoch을 제외한다 — 그렇지 않으면 초기화 직후 흔들리는 구간이 평균·표준편차를 왜곡해 규칙 기반과 AI 판단의 warmup 처리가 서로 어긋난다.
- **샘플 파일 1 — 정상 run**: `logs/samples/epoch_log_sample.csv`(`run_id=run01`, 20epoch, timestamp는 6분 간격으로 총 1시간54분 소요 — GPU 제약으로 학습이 느린 상황을 반영). entropy 1.10→0.67 완만히 감소, reward -2.3→20.4 상승, policy_loss 6.8→3.1 완만히 하강, gradient_norm은 8.9~16.8 사이에서 자연스럽게 변동(평균 12.51, 표준편차 2.39 — 이전 버전은 표준편차가 0.74로 비현실적으로 작아 explosion 임계치가 15.97까지 눌렸었는데, 이번엔 24.48로 완화함. 다만 이 분산도 여전히 추정치일 뿐 실제 baseline 5회를 관찰하기 전까지는 검증되지 않은 값이다 — T2-1 재검토 시 실측치로 교체 필요).
- **샘플 파일 2 — 이상 사례 모음**: `logs/samples/epoch_log_anomaly_sample.csv`(`run_id=anomaly_demo`, 13epoch)로 규칙 기반/AI 판단 대상을 전부 한 번씩 재현: epoch5 gradient explosion(gradient_norm=912.4, §7 예시1과 같은 스케일), epoch7 NaN/Inf(policy_loss=nan, gradient_norm=inf), epoch8 reward_all_zero=true(§3 사례 A), epoch9~13 entropy collapse(0.58→0.02, §7 예시2와 같은 패턴). 이 run은 T2-2의 자동 필터(NaN/Inf 없음, reward 전부 0인 epoch 없음)를 명백히 위반하므로 애초에 baseline 후보가 될 수 없다 — 그래서 아래 검증에서도 이 파일의 "baseline 통계"는 참고용이 아니라 파싱/판단 로직이 작동하는지 보여주는 용도로만 썼다.
- **파싱 검증(재현 가능)**: `tools/verify-log-format.mjs` 스크립트를 커밋했다. `node tools/verify-log-format.mjs --rules logs/samples/epoch_log_sample.csv logs/samples/epoch_log_anomaly_sample.csv`로 직접 실행해 확인:
  - 두 파일 모두 컬럼 수 일치, 전 필드 파싱 성공(정상 샘플 20행, 이상 샘플 13행, 에러 0건). 이상 샘플의 `nan`/`inf` 토큰은 "파싱 에러"가 아니라 "특수값 OK"로 별도 보고됨.
  - **정상 샘플 결과(epoch 11-20 창)**: 규칙 기반 explosion 임계치=24.480(정상, 최근값 11.9) / §9.1 vanishing 임계치=0.1251(정상) / §9.2 collapse: A=true, B=false, C=22.1%(정상) / §9.3 불일치: reward 기울기 +1.070, policy_loss 기울기 -0.124(부호 반대=정상).
  - **이상 샘플 결과(epoch 4-13 창)**: §9.2 collapse A=true, B=true, C=97.9% → **이상 판정**(entropy collapse 정상 작동 확인). §9.3도 부호 동일로 **이상 판정** — 여러 이상이 겹친 구간(explosion·NaN/Inf·reward_all_zero가 같은 window 안에 섞여 있음)에서는 추세 기반 §9.3도 함께 발동할 수 있음을 보여준다(공통 지침의 "다중 이상 동시 발생 처리" 조항이 다루는 바로 그 상황).
- **알려진 한계(재검토 필요 항목)**:
  1. 정상 샘플의 gradient_norm 분산(표준편차 2.39)은 여전히 추정치 — 실제 baseline 5회 관찰 후 T2-1 임계치를 재계산해야 한다.
  2. §9.1(`baseline policy_loss 평균의 2%`)·§9.3(`baseline reward 표준편차의 0.5배`)이 쓰는 "baseline 표준편차/평균"은, reward/policy_loss가 정상 run에서도 추세적으로 움직이면(이번 샘플처럼) 노이즈 척도가 아니라 추세 크기를 재게 된다 — T2-5 재검토 시 diff(epoch간 차분)의 표준편차 같은 추세 제거형 정의로 바꾸는 것을 검토해야 한다.
- **실제 로깅 코드 작성 시** 이 헤더·컬럼 순서·NaN/Inf 표기·`run_id` 파일 규칙을 그대로 채택하거나, 다른 포맷이 필요하면 이 설계를 갱신한다.

## 9. Codex 판단 기준 가이드라인 (T2-5)

> 아래는 Codex CLI가 gradient vanishing / entropy collapse / loss-reward 불일치 세 가지를 판단할 때 쓸 구체적 기준의 초안이다. Codex는 이 기준을 참고해 로그 파일에서 필요한 만큼 과거 이력을 스스로 조회해 판단한다(§6 "Codex 판단 시 입력 범위" 참고).
>
> N과 임계치는 모두 baseline 5회 관찰 후 조정 가능한 초기값이며 `config.yaml`에 키로 저장한다(키 이름은 각 항목 옆에 병기). **통계량 산출 방식은 항목마다 다르다** — gradient explosion(§6, 규칙 기반)은 baseline 분산이 의미 있을 만큼 충분히 퍼져 있다고 보고 평균+k×표준편차를 쓰지만, 아래 세 AI 판단 항목은 "거의 0에 수렴"(vanishing) 또는 "상대적 급락/역행"(collapse, 불일치) 여부가 핵심이라 baseline 평균 대비 비율/부호 비교를 쓴다 — baseline 재보정 시점(5회 관찰 후)은 gradient explosion과 같지만, 통계 계산 방식 자체는 다르다.
>
> **전제(§9 작성 중 추가된 가정 — T2-1/T2-2 재검토 시 확인 필요)**: §6의 baseline 5회 수집이 gradient_norm뿐 아니라 entropy/reward/policy_loss도 epoch별로 함께 보관한다고 가정한다. 이는 T2-1/T2-2가 결정할 당시 명시적으로 정한 범위는 아니었다.
>
> **Codex 호출 형식(초안)**: 입력 = 로그 파일 경로 + 아래 기준 요약(§9.1~9.3) + 현재 epoch 번호. 출력은 파싱 가능하도록 한 줄 JSON으로 고정한다 — `{"anomaly": true|false, "type": "vanishing|entropy_collapse|loss_reward_mismatch|null", "reason": "근거 수치를 포함한 판단 설명 문장"}`. 프롬프트 전문(각 절의 자연어 지시를 실제 Codex 프롬프트로 옮기는 작업)은 이 태스크 범위 밖이며, 별도 백로그 태스크로 아직 등록되지 않았다 — 등록 필요.

### 9.1 Gradient vanishing (gradient 소실)

- **정의**: 학습 신호(policy gradient)가 사실상 사라져 파라미터가 갱신되지 않는 상태.
- **판단 신호** (아래 두 조건을 **모두** 만족할 때 이상으로 본다):
  - 최근 N epoch(초기값 10, `codex.vanishing.window_epochs`) 동안 gradient_norm이 baseline 평균의 일정 비율(초기값 1%, `codex.vanishing.ratio`) 미만으로 지속됨.
  - 같은 구간 동안 policy_loss의 변동폭(구간 내 최댓값-최솟값)이 baseline policy_loss 평균의 일정 비율(초기값 2%, `codex.vanishing.loss_plateau_ratio`) 미만 — 사실상 정체.
- **관행과의 관계**: §3의 "reward 정체는 최대 50epoch까지 지켜본다"는 관행보다 더 이른 조기 경보 역할 — reward 정체의 원인이 gradient_norm 자체의 소실 때문인지를 이 신호로 구분한다(§4 가설 2번 항목 참고).
- **오탐 방지**: 학습 초반(초기값: 처음 5epoch, `codex.vanishing.warmup_epochs`)은 제외 — 초기화 직후의 낮은 gradient는 정상일 수 있음.

### 9.2 Entropy collapse (탐색 붕괴)

- **정의**: 정책의 확률 분포가 지나치게 빨리 결정론적으로 수렴해 탐색이 멈춘 상태.
- **판단 신호** — 아래 (A AND B) 또는 C 중 하나라도 성립하면 이상으로 본다:
  - A: entropy가 최근 N epoch(초기값 10, `codex.entropy_collapse.window_epochs`) 동안 지속적으로 감소하는 추세(단조 감소에 가까움).
  - B: 절대값이 `min(baseline 평균 × 0.1, 0.05)`(`codex.entropy_collapse.ratio`=0.1, `codex.entropy_collapse.abs_cap`=0.05 — 이 수식은 baseline 평균과 무관하게 임계치가 항상 0.05를 넘지 않는다) 미만으로 내려감.
  - C(급락 — 단독으로도 이상 신호): 최근 `drop_window_epochs`(초기값 12, `codex.entropy_collapse.drop_window_epochs`) 동안 구간 시작값 대비 `drop_ratio`(초기값 80%, `codex.entropy_collapse.drop_ratio`) 이상 감소. §7 예시2(12epoch·30→42에 약 96% 감소)가 이 조건에 해당하는 사례다.
- **정상 판단 기준**: (A AND B)도 C도 성립하지 않으면 정상. §7 예시3(entropy=0.71)은 B의 임계치가 baseline 값과 무관하게 항상 0.05 이하이므로, baseline 평균이 얼마든 정상으로 분류된다.

### 9.3 Loss-reward 불일치

- **정의**: reward와 policy_loss가 기대되는 역상관 관계(reward 상승 ↔ loss 하락, reward 하락 ↔ loss 상승)에서 벗어나, 두 지표가 같은 방향(부호)으로 함께 움직이는 상태 — 예: reward가 상승하는데 loss도 함께 상승, 또는 reward가 하락하는데 loss도 함께 하락(§5의 "서로 다른 방향으로 움직이는 경우"는 이 절의 "같은 부호=기대와 다른 방향"을 가리킨다).
- **계산 절차**: 최근 N epoch(초기값 10, `codex.loss_reward_mismatch.window_epochs`) 동안 reward와 policy_loss 각각에 대해 최소자승 선형회귀 기울기를 구하고, 기울기×window_epochs로 "구간 전체 변화량"을 계산한다(표준편차와 단위를 맞추기 위함).
- **판단 신호** (아래 두 조건을 **모두** 만족할 때 이상으로 본다):
  - reward의 구간 전체 변화량 절댓값이 baseline reward 표준편차의 0.5배(초기값, `codex.loss_reward_mismatch.reward_change_min`) 이상 — reward가 "명확한 추세"를 보여야 판단 대상이 된다.
  - reward 기울기와 policy_loss 기울기의 **부호가 같음**(둘 다 양수 = 함께 상승, 둘 다 음수 = 함께 하락).
- **추가 설명**: gradient_norm이 정상 범위(explosion도 vanishing도 아님)인데 이런 불일치가 나타나면, "망 설계/파라미터 문제"보다 "reward 신호 자체의 문제"(§4 가설의 원인 구분 1번 항목)일 가능성이 높다는 설명을 판단 근거 문장에 포함한다.

### 공통 지침

- Codex는 판단 결과의 `reason` 필드에 반드시 **어떤 수치를 근거로 이상/정상이라고 판단했는지**를 포함해야 한다(§6 "알림 내용" 결정과 일치).
- **다중 이상 동시 발생 처리**: 규칙 기반(NaN/Inf, gradient explosion)과 AI 판단(vanishing/entropy collapse/loss-reward 불일치)은 서로 다른 유형이라 자동으로 겹치지 않지만, 같은 epoch에 여러 유형이 동시에 이상으로 판정될 수는 있다 — 이 경우 알림을 유형별로 각각 보내지 않고 한 텍스트 파일에 모든 유형을 함께 기록한다(파일명 규칙은 §6 알림 채널 행 참고). AI 판단 세 가지는 규칙 기반 판정 결과와 무관하게 매 epoch 독립적으로 수행한다(한쪽이 다른 쪽을 가려 §6의 감지 시간 목표를 놓치지 않도록).
