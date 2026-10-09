# Console UI 리디자인 Run 기록 (2026-10-09)

Run `run_eb21068c609a`. 디자인 인계 자료는 `design_handoff_console_redesign/`이고, 계약은 Git에서 제외된
`.orca/briefs/ui-redesign-20261009/contract.md`(Fable 5.1 작성)다. 실행 규칙은
[Orca 실행 규칙](orca-execution-policy.md)을 따른다.

## 범위와 순서

단계 1 토큰·폰트·테마 IPC → 2 앱 틀(레일·목록 열·본문 헤더) → 3 대화(시작 화면·컴포저·인라인 비교·모델 선택·⌘K)
→ 4 나머지 화면 → 5 마감. 각 단계는 Orca worktree에서 구현하고 4종 gate와 독립 리뷰 PASS 뒤 통합 브랜치
`airkjw/ui-integration-20261009`에 병합한다. 단계마다 사용자 스크린샷 확인을 받는다.
main 병합·push·릴리즈는 별도 사용자 승인 범위다.

## 진행 현황

| 단계 | 구현 | 리뷰 | 결과 |
| --- | --- | --- | --- |
| 0 계약 | Fable 5.1 high | — | 불변식·결정 번호·수용 기준 |
| 1 | W1a Sonnet(토큰·폰트) / W1b Sonnet(테마 IPC) | R-1a Opus / R-1b Fable | 지적 3건·Low 5건 보정 1회 → PASS, 통합 `12e641c` |
| 2 | W2 Opus(앱 틀) + T-guard Sonnet(테스트 가드) | R-2 Opus | W2 Medium 2·Low 3, T-guard High 1·Medium 1·Low 2 → 보정(W2 1회, T-guard 2회) → PASS, 통합 `508930f` |
| 3 | W3a Opus / W3b Sonnet(⌘K 팔레트) | R-3 Opus | High 1·Medium 2·Low 4 → 보정 1회(F6 이월) → PASS, 통합 `cbbf270` |
| 4 | W4a Opus / W4b Sonnet | R-4 Fable 고위험 | Low 6건(비차단) → PASS, 통합 `9f91385` |
| 5 | W5 Sonnet | R-5 Opus(접근성) | Medium 1·Low 3 + 잔여 위험 1건 → 보정 1회 → PASS, 통합 `839c389` |

단계 2 통합 gate(Linux 로컬, mock): typecheck 통과, `npm test` 455 + UI 136 통과(최대 RSS 423 MB),
`ui:audit` 통과, build 통과. 스크린샷 12장(1280×900·640×820, 라이트·다크)을 사용자가 확인했다.

단계 3 통합 gate(Linux 로컬, mock): typecheck 통과, `npm test` 469 + UI 183 통과(최대 RSS 519 MB),
`ui:audit` 통과, build 통과. 감사 `CONTROL_BOUNDARIES`는 32 → 29로 치환하고 컴포저 버튼 상태 검사를 추가했다.

단계 4 통합 gate(Linux 로컬, mock): typecheck 통과, `npm test` 483 + UI 244 통과(최대 RSS 512 MB),
`ui:audit` 통과, build 통과.

단계 4 코디네이터 결정:
- 두 번째 열은 README 표대로 화면마다 다르다. 대화 목록은 대화·비교 화면에만 있고, 다른 화면은 자기 열을 쓴다.
- 레일 아바타는 설정 화면의 "계정 · API 키"를 연다. 설정 "일반"은 버전·업데이트·모델 새로고침이다.
- 기존 결함 2건을 고쳤다. 다른 화면으로 이동하면 진행 중 응답·초안·첨부가 사라지고, 미디어 화면을 떠나면 과금된
  결과와 크레딧 갱신이 누락됐다. ChatPanel 하나와 MediaPanel을 hidden+inert로 유지해 해결했다.
- 음성 화면은 유지하지 않는다. 화면을 떠나면 기존 종료 경로로 세션을 끝내 숨은 마이크가 켜져 있지 않게 한다.
- `phase4-ui-dom` 간헐 실패 원인은 고정 10 ms 대기와 forked main 자식의 IPC 경합이었다. 상태 관찰 대기로 바꿨다.

단계 5 통합 gate(Linux 로컬, mock): typecheck 통과, `npm test` 492 + UI 255 통과(최대 RSS 518 MB),
`ui:audit` 통과, build 통과. `scripts/ui-smoke.mjs` 전체 매트릭스(1280×900·980×1180·640×820 × 라이트·다크 ×
작게·기본·크게, 화면·상태 캡처 219장)에서 프로브 실패 0, 가로 스크롤 0.
실제 API, macOS 서명·공증, Windows 실행은 이 Run에서 검증하지 않았다.

## 이월 항목(처리 결과 포함)

- F4(단계 2 리뷰): 모델 목록이 없을 때 본문 헤더 검색 진입점이 사라진다 → 단계 3 W3a.
- N1(단계 2 재확인): 비활성 미디어 탭의 시각 표시, 진행 중 미디어 행 클릭 안내 → 단계 4 W4b.
- `tests/phase4-ui-dom.test.tsx:249`(음성 IPC)가 전체 실행 3회 중 1회 실패, 단독 4/4 통과 → 단계 4 W4b가 원인 확인.
- F6(단계 3 리뷰): 즐겨찾기 ★ 버튼이 `role=listbox` 안에 있다 → 단계 5 접근성 점검.
- N1(단계 3 재확인): 팔레트 이동 실패 뒤 컴포저 포커스 플래그가 남는다 → 단계 4 W4a.
- 비교 종합분석 안내가 답변 2개일 때도 "A·B·C"라고 쓴다(기존 문구) → 단계 5 후보.
- R-4 Low L1~L5(임시 첨부 폐기, 지침 저장 거부 안내, undefined 처리, 바쁨 안내 문구 통일, 포커스 테스트 강화) → 단계 5.
- L6: 미디어 작업에 대화·프로젝트 연결이 없어 프로젝트 "미디어" 탭은 목록 대신 설명을 보인다 → 범위 밖으로 기록.
- 단계 4 화면 확인 다듬기 7건(F6 listbox, "A·B·C" 문구, 미디어 체크박스 중복 표시, 음성 헤더 문구, 고정폭 한글 자간,
  프로젝트 헤더, 설정 업데이트 표시) → 단계 5.
- 위 이월 항목은 모두 해당 단계에서 처리했다. L6만 범위 밖으로 남는다(`docs/UI_REDESIGN_2026_10.md`).
- 남은 후속: 세션 초기화(로그아웃·키 교체) 중 보류된 기본 지침이 저장되지 않는 경로는 리뷰 재현으로만 확인했고
  저장소 회귀 테스트는 아직 없다.
- 단계 2 W2 terminal은 Orca가 `user_takeover`로 보유해 정식 release가 거절됐다. 사용자 수동 종료 대상이다.

## 장애: 테스트 OOM으로 worker 3개 소실

- 현상: 단계 2 W2 worker가 15:11, 15:23, 15:28에 연속으로 사라졌다. 커널 OOM killer가 Orca terminal
  호스트 scope 전체를 종료했고 테스트 프로세스는 15~17 GB까지 커졌다. 처음에는 daemon 재시작으로 오판해
  같은 방식으로 두 번 재시도했다.
- 원인: `tests/sidebar-ui-dom.test.tsx`의 포커스 단언(`assert.equal(document.activeElement, el)`)이 실패하면
  node:assert가 실패 메시지를 만들며 happy-dom 객체 그래프를 깊이 제한 없이 inspect한다.
  `--max-old-space-size`는 이 메모리를 제한하지 못한다. 단언이 실패한 이유는 데스크톱 접기 후 포커스를
  펼치기 버튼으로 넘기는 새 동작과, 클릭한 버튼에 포커스를 주지 않는 happy-dom `.click()`의 차이였다.
- 조치: 모든 테스트·빌드를 메모리 제한 scope에서 실행하도록 규칙화했다([실행 규칙](orca-execution-policy.md)).
  `tests/dom-assert.ts`는 DOM 피연산자를 식별자로 비교하고 한 줄 메시지로 실패시키는 가드다. 정적 규칙과
  RSS 감시 회귀 테스트가 이 가드를 강제한다. 리뷰에서 `URL.pathname` 경로 결함(공백·한글·Windows 경로에서
  `npm test` 실패)도 발견해 `fileURLToPath`로 고쳤다.
- 교훈: worker가 조용히 사라지면 `journalctl --user | grep oom-kill`부터 확인한다. 같은 실패를 근거 없이
  재시도하지 않는다.

## Fable 사용과 수치

- Fable 5.1: 계약 설계 1회, 고위험 리뷰 2회(R-1b, R-4). Run 목표에서 사용자가 승인한 3회 계획대로 썼고
  조건부 원인 분석은 0회다. R-4 지적 6건(Low)은 1건(L6) 범위 밖 기록을 빼고 모두 단계 5에서 반영했다.
- 리뷰 결과: 모든 단계가 보정 1회로 PASS했다. 단계 2 T-guard만 보정 2회였다(2회차는 리뷰가 찾은 단계 1
  `URL.pathname` 결함 포함).
- 리뷰가 찾은 과금·안내 정직성 결함: 비교 모드 Sonar 공통 검색 안내 누락(R-3 F1, High), 종합분석 글자 수와
  실제 검토 대상 불일치(R-5 M1). 기존 결함 2건(화면 이동 시 진행 중 응답·과금된 미디어 결과 유실)은 단계 4에서 발견해 고쳤다.
- 토큰·비용 수치는 제공되지 않아 기록하지 않는다.
