# MM_LLM Orca 운영 — Claude 전용 전환

## 요청과 결정

2026-10-09 사용자는 Codex 기반 Orca 운영(`gpt-6-astra` 계획, `gpt-6.1-sol` 구현·리뷰)을 중단하고
Opus 5.5를 오케스트레이터로 하는 Claude 전용 운영으로 전환하도록 결정했다.
Fable 5.1은 비용이 높으므로 질 대비 효과가 큰 지점에만 쓴다.
현행 규칙은 [Orca 실행 규칙](orca-execution-policy.md)이다.

## 근거

- 이전 Run `run_f2e2b7cfda96`은 Astra 계획 1개 외에 모두 새로 띄운 Sol xhigh worker로
  구현→리뷰→보정→수락을 반복해 worker 20개를 사용했다(전부 released, 미정리 0).
- 그 결과로 수락된 main(`9e29575`)에서 Claude 리뷰가 High 2건, Medium 8건을 추가로 찾았다
  ([리뷰 기록](chatkhu-expansion-claude-review-2026-10-09.md)). 같은 계열 모델 리뷰만으로는
  계약 단계 결함이 남을 수 있다.
- 단가(Anthropic API 기준, 2026-10-06 자료, 입력/출력 $/1M): Fable 5.1 $10/$50, Opus 5.5 $4/$20,
  Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50(100K 이하). Opus·Sonnet 캐시 읽기 $0.20.
  구독 요금제에서는 달러 대신 사용 한도로 나타나며 실제 요금제는 확인하지 않았다.
- 비용 차이는 모델 선택보다 terminal 재사용(캐시 유지)과 보정 횟수에서 크게 난다.
  Fable은 출력이 많은 구현보다 입력이 작고 판단 영향이 큰 계약 설계·고위험 리뷰에 둔다.

## 운영 요약

| 역할 | 모델 / effort |
| --- | --- |
| 오케스트레이터 | Opus 5.5 / high |
| 구현 기본 / 상향 | Sonnet 5.5 / high(단순 medium) · Opus 5.5 / high |
| 일반 리뷰 / 고위험 리뷰 | Opus 5.5 / high · Fable 5.1 / high(Opus 리뷰 대체) |
| 계약 설계 / 조건부 원인 분석 | Fable 5.1 / high (Run당 계획 2회 + 조건부 1회) |
| 보조 | Haiku 5.5 / low |

## 첫 적용 Run 계획 — 리뷰 지적 보정

수정 항목은 사용자 승인 후 시작한다. 기준은 main `9e2957543a4f2dccd01bcaff119cf8c38f87a2a9`.
지적 ID는 [리뷰 기록](chatkhu-expansion-claude-review-2026-10-09.md)을 따른다.

| 단계 | 담당 | 범위 | 소유 파일 |
| --- | --- | --- | --- |
| 0 | Fable 5.1 high | 지적별 불변식·실패해야 할 테스트·범위 경계, wave brief | 문서·`.orca/briefs/`만 |
| A | W1 Sonnet 5.5 high | H1, H2, M2, M8, L11, L12, L13 | `search-evidence.ts`, `gateway.ts`, `search-capability.ts`, `model-search-cache.ts` |
| A | W2 Opus 5.5 high | M3, M7, L1, L7 | `project-vault.ts`, `document-retrieval.ts`, `ProjectRetrievalSettings.tsx`, `index.ts` |
| A | R-A Opus 5.5 high | W1·W2 묶음 리뷰 | 읽기 전용 |
| B | W3 Opus 5.5 high | M4, M5, M6, L2, L3, L8, L9 | `realtime-session.ts`, `voice-audio.ts`, `voice-capture.js`, `voice-permissions.ts`, `index.ts` |
| B | W4 Sonnet 5.5 medium | M1, L4, L5, L6, L10 | `server-code.ts`, `thread-export.ts`, `gateway-transport.ts`, `research.ts`, `media-estimate.ts`, `MediaPanel.tsx` |
| B | R-B Fable 5.1 high | W3·W4 묶음 리뷰(IPC·음성·과금) | 읽기 전용 |
| 조건부 | Fable 5.1 high | 보정 2회 실패 지적의 원인 분석 | 읽기 전용 |
| 통합 | 오케스트레이터 | 통합 브랜치, 4종 gate, CI | — |

- 보정은 구현 terminal, 보정 확인은 리뷰 terminal을 재사용한다.
- 각 wave는 Orca 관리 worktree·branch에서 진행한다. main merge·push·릴리즈는 별도 사용자 승인 범위다.

## 시작 전 확인 항목

- [x] 오케스트레이터가 Orca terminal 안에서 실행 중임을 확인(`ORCA_TERMINAL_HANDLE`, `ORCA_WORKTREE_ID`).
  이 handle은 이전 Run `run_f2e2b7cfda96`의 coordinator handle과 같다. `status --json`에 caller 필드가
  없다는 것만으로 Orca 밖이라고 판단하지 않는다.
- [x] 새 Run 생성: `run_5ed744afac3e`
- [x] 모든 신규 worker에서 `launch.requested` = `launch.effective` 확인(Fable 5.1·Opus 5.5·Sonnet 5.5)
- [x] 수정 지적 항목 사용자 승인: 전체 23건

## 진행 기록

- 2026-10-09: 실행 규칙·agent 안내·이 기록 작성. 제품 코드·Run·worker 변경 없음.
- 2026-10-09: 첫 Run `run_5ed744afac3e` 완료. 23건 전부 보정·독립 리뷰 PASS, 통합 브랜치
  `airkjw/rf-integration-20261009`(main `41a6a4c` 기준). main 병합·push는 별도 승인 대상이다.

## 첫 Run 결과

| 단계 | 모델 | 결과 |
| --- | --- | --- |
| 계약 설계 | Fable 5.1 high | 23건 계약·실패 테스트 시나리오, 무효 0건 |
| W1 검색 | Sonnet 5.5 high | 구현 → R-A 지적 3건(Medium 1) → 보정 1회 → PASS |
| W2 의미 검색 | Opus 5.5 high | 구현 → R-A 지적 0건 |
| W3 음성·IPC | Opus 5.5 high | 구현 → R-B 지적 3건(Medium 1) → 보정 1회 → PASS |
| W4 기타 | Sonnet 5.5 medium | 구현 → R-B 지적 0건(소유 범위 밖 수정 3곳 수용) |
| R-A / R-B | Opus 5.5 high / Fable 5.1 high | 각 1회 리뷰 + 같은 terminal 재확인 1회 |

- 새 worker 7개, 기존 terminal 재사용 후속 Dispatch 4개(보정 2·재확인 2). 이전 Run은 worker 20개였다.
- Fable 사용: 계획 2회(계약·고위험 리뷰)와 같은 terminal 재확인 1회. 조건부 원인 분석 0회.
- 묶음별 보정은 모두 1회로 끝났다. 토큰·비용 수치는 제공되지 않아 기록하지 않는다.

## 운영에서 얻은 교훈

- 메시지 대기(`check --wait`)는 `worker_done`·질문·escalation만 깨운다. W3가 API 서버 오류로 turn이 끊긴 채
  약 25분 정지한 것을 사용자 지적 전까지 감지하지 못했다. 이후 2분 주기로 실행 중 worker 화면의
  API 오류·10분 무변화를 알리는 감시를 함께 돌렸다.
- 끊긴 worker는 같은 terminal에 `terminal send`로 재개 지시를 보내 맥락을 보존했다. 이 방식은 Orca가 해당
  terminal을 user-owned로 표시해 정식 release가 거절되므로, 정리 시 수동 종료가 필요하다.
- worker가 소유 범위 밖 파일을 묻지 않고 수정한 사례가 1건 있었다(W4, 필수 변경이라 리뷰에서 수용).
