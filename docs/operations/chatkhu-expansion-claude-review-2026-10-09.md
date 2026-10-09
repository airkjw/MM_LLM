# ChatKHU 확장 — Claude 코드 리뷰 기록

- 대상: base `418cb41e5651cc6bfb2ac17737d6c651732913fa` → main `9e2957543a4f2dccd01bcaff119cf8c38f87a2a9`
- 방식: Opus 5.5 오케스트레이터 + 단계별 읽기 전용 리뷰 4개, 주요 지적은 코드 재확인·합성 재현
- 재실행 gate(로컬 Linux, mock/합성, Node v24.21.0): `typecheck`, `test`(Node 350 + DOM 109 = 459),
  `ui:audit`, `build` 모두 exit 0. 실제 API·실계정·macOS/Windows 실기기 검증은 하지 않았다.
- Critical(인증·tenant·승인 우회, 키·토큰 노출, 원음·평문 저장)은 발견하지 않았다.
- 상태: 23건 전부 보정, 독립 리뷰 PASS(Run `run_5ed744afac3e`, 통합 브랜치 `airkjw/rf-integration-20261009`).
  결과와 잔여 위험은 [전환 기록](orca-claude-transition-2026-10-09.md)의 "첫 Run 결과"와 아래 "보정 결과"에 있다.
  main 병합 전이다.

## High

| ID | 위치 | 문제 | 제안 |
| --- | --- | --- | --- |
| H1 | `src/shared/search-evidence.ts:101,127,179`, `src/main/gateway.ts:657` | 검색 호출 하나가 실패하면(예: Claude `max_uses` 초과) 정상 완료된 유료 답변이 오류·미완료로 저장된다. 재현함 | 완료·실패 수를 분리하고 완료 0일 때만 `failed`; 정상 종료 후 throw 금지 |
| H2 | `search-evidence.ts:10,14,75`, `gateway.ts:423` | 출처 65개 이상 또는 2000자 초과 URL이면 유료 호출 뒤 요청 전체 실패. 재현함 | 초과 출처·긴 URL은 버리고 `truncated` 표시 |

## Medium

| ID | 위치 | 문제 | 제안 |
| --- | --- | --- | --- |
| M1 | `src/shared/server-code.ts:64,72` | 서버 코드 실행 결과 9번째에서 throw해 과금 중 응답 중단. 재현함 | 8개 보관 + 나머지 생략 집계 |
| M2 | `gateway.ts:660` | 취소·후속 오류 시 실행된 검색을 `failed`로 저장. 재현함 | catch에서 `snapshot(true)` 사용, 취소 표시 분리 |
| M3 | `src/main/project-vault.ts:230`, `src/main/document-retrieval.ts:87`, `src/main/index.ts:1618` | 문서 1개 삭제 시 의미 색인 전체 삭제, 설정은 semantic 유지 → 전송 실패·전체 재과금 | 삭제 문서 벡터만 제거해 재암호화, 또는 로컬 대체·`rebuildRequired` |
| M4 | `src/main/realtime-session.ts:149-153,221-226`, `src/renderer/src/voice-audio.ts:83-87` | 두 번째 끼어들기가 이미 들은 AI 답을 `audio_end_ms:0`으로 truncate. 재현함 | 미재생 오디오가 있을 때만 truncate, 처리 후 `itemId` 정리 |
| M5 | `src/renderer/public/voice-capture.js:14`, `voice-audio.ts:43-45,60` | 100ms 프레임 확인 하나만 늦어도 세션 종료 | 양쪽 5~10프레임 상한 큐 |
| M6 | `realtime-session.ts:18` | 토큰 만료 상한 `now+61s`로 시계가 1초 늦어도 시작 거절. 재현함 | 상한 완화, 하한 skew 허용 |
| M7 | `document-retrieval.ts:67,72` → `project-vault.ts:420-438` | 청크마다 프로젝트 전체 복호화·재암호화 2회, main 스레드 차단. 복원 문서는 `sourceHash` 미저장 | `sourceHash` 영속화, 검증 경량화, 완료 저장 묶음 처리 (확신 중간) |
| M8 | `gateway.ts:633-635`, `search-evidence.ts:91-131` | serverCode + JSON 응답에서 검색 근거 소실 | 두 형식 처리 또는 조합 거절 (확신 중간) |

## Low

| ID | 위치 | 요약 |
| --- | --- | --- |
| L1 | `src/renderer/src/ProjectRetrievalSettings.tsx:47` | 재개 동의를 항상 `true`로 보내 main의 별도 재개 동의 검사가 UI 경로에서 무의미 |
| L2 | `src/main/index.ts` 약 1814 | `render-process-gone` 처리 없음, 렌더러 크래시 시 음성 소켓 유지 가능 |
| L3 | `src/main/voice-permissions.ts:4-15` | `fullscreen` 권한 거부로 비디오 전체화면 회귀 가능성 |
| L4 | `src/main/gateway-transport.ts:53-57` | 유료 POST redirect 거부를 "연결 실패"로 안내해 재전송 유도 |
| L5 | `src/shared/research.ts:192-194` | MCP 읽기 전용 판정이 서버 힌트와 `search` 이름 패턴에 의존 |
| L6 | `src/shared/thread-export.ts:36-44` | 코드 stdout/stderr를 fence 없이 Markdown에 기록 |
| L7 | `src/main/project-vault.ts:21` | 의미 색인 22MB 한도가 실제 18MB 암호화 한도와 불일치 |
| L8 | `realtime-session.ts:243-245` | OpenAI 입력 전사 순서 역전 가능, 끼어들기 후 미리보기 잔존 |
| L9 | `src/main/index.ts:345-371` | 계정 전환 중 저장 성공을 실패로 보고 |
| L10 | `src/shared/media-estimate.ts:25` | 참고 이미지 제외 견적을 확정으로 표시 가능 |
| L11 | `search-evidence.ts:140-155` | Gemini grounding 인덱스를 누적 기준으로 해석 |
| L12 | `src/shared/search-capability.ts:9,49` | Sonar 판정이 두 ID만 허용 |
| L13 | `src/main/model-search-cache.ts:12,25` | 모델 새로고침이 진행 중 preflight를 계정 변경으로 중단 |

## 빠진 테스트

일부 검색 실패(H1), 65개 이상 출처(H2), 검색 실행 후 취소(M2), 9개 이상 코드 결과(M1),
문서 삭제 후 의미 검색 전송(M3), 두 번 끼어들기(M4), 시계 skew(M6), 렌더러 크래시(L2), 전체화면(L3).

## 보정 결과 (run_5ed744afac3e)

- 설계 변경: M4는 응답 종료가 아니라 truncate·interrupt 직후 항목을 잊는다(R-B 수용). M5는 main 입력 한도를
  1초 bounded credit으로 바꿔 renderer 8프레임(800ms) 지연 burst를 허용하고 지속 과다 입력은 거절한다.
  M6 초기 설정 타이머는 고정 10초다. L5는 가드 변경 없이 표시만 보정했다.
- 리뷰 중 추가 보정: 응답 헤더 전 취소는 `missing`, 검색 호출 dedupe 1024, 검색 전부 실패 + 답변 0자는 기존 오류로
  처리, commit 뒤 fsync 오류는 저장 결과 반환.
- 잔여 위험(미수정·수용): 모든 검색이 실패하고 응답이 도구 호출만으로 끝나면 오류로 처리된다(기존과 동일).
  배치 임베딩, serverCode JSON 응답 형식, Gemini grounding은 합성 fixture로만 검증했고 실계정 확인이 필요하다.

## 실계정 검증 (2026-10-09, run_e0ed240195b2)

- ChatKHU Gateway 실제 키(사용자 제공, Git·보고서 미기록)로 main `f87efde` 제품 코드를 직접 호출했다. 상한 500크레딧 중
  **19.2크레딧 사용**(P1 0.58, P2 14.12, P3 4.5; 이후 확인 호출 포함 총 33.32). 각 프로브는 유료 POST 1회, 재시도·모델 대체 없음을 확인했다.
- P1 배치 임베딩(M7) PASS: `text-embedding-3-small`, 10청크 → 8+2 묶음, 1536차원, 재색인 시 전송 0회, 검색 POST 1회.
  참고: 한국어 질의로 영어 사실을 찾는 교차 언어 검색은 상위 5개에 들지 않았다(판정 조건 아님, 검색 품질 관찰).
- P2 Gemini 근거(L11) PASS: `gemini-3.5-flash-lite` 자체 검색 executed, 인용 1, 원본·정규화 인용 수 일치.
  실제 응답은 grounding을 마지막 이벤트 하나에만 담아 여러 이벤트 분산 경우는 합성 테스트로만 검증된다.
  인용 URL은 Google `vertexaisearch` 리다이렉트 주소로 표시된다.
- P3 serverCode(M8) PASS: `claude-haiku-5-5` 코드 실행은 JSON이 아니라 SSE로 반환됐고 결과(`echo $((2+2))` → `4`)가
  정상 정규화됐다. JSON 경로는 방어 코드로 남는다. OpenAI 경로는 15분 최소 과금 때문에 실행하지 않았다.
- Gemini 출력 토큰 의심 건은 **제품 결함이 아님**으로 종결했다. 추가 실호출 1회(14.12크레딧)로 원본 `usageMetadata`를 확인한 결과
  Gateway는 누적값(`candidatesTokenCount` 2→20→20→43)을 보내고, 제품(`src/main/index.ts` 1572·1669행)은 마지막 usage로 덮어써
  올바르게 43을 쓴다. 2로 보인 것은 검증 스크립트가 첫 usage 이벤트를 집계한 탓이었다. 총 사용 33.32크레딧.
- 실기기 마이크·macOS/Windows는 미검증이다. 검증용 스크립트와 결과는 Git 제외 `.orca/live-verify/`에 있다.
