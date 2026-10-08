# ChatKHU 1단계 구현·검증 기록 — 2026-10-08

수락된 [확장 계획 1단계](chatkhu-api-expansion-plan-2026-10-08.md)의 모델 분류와 실제 네이티브 웹 검색을 구현했다. 제품 commit은 `b10d7dfce738c3773025bc1019ee4ebb4767c9b2`, 기준은 `609c05e9aa4d7aeb154f480521bd5edac4a76f14`다. 구현·후속 보정 소유자는 단일 Sol이며 별도 Sol이 이 제품 commit 기준 읽기 전용 독립 검토를 시작했다. 결과에 따른 보정과 실행 책임자의 수락·통합이 남아 있으며 2~4단계에는 착수하지 않았다.

## 동작과 범위

- Catalog는 `llm, embedding, rerank, decisions, realtime, audio, image, video`를 보존한다. 대화·비교 선택지는 LLM으로 제한하고 알 수 없는 종류를 LLM으로 승격하지 않는다. 저장된 모델이 삭제되었으면 직접 모델을 선택하도록 안내하고 다른 모델로 자동 전송하지 않는다.
- 검색 기능 확인은 명시적 버튼 또는 검색을 요청한 전송에 연결했다. 선택한 계정 모델의 상세 ID·종류·`pricing.web_search_per_1k`와 구현된 공식 도구 경로가 일치해야 지원으로 판정한다. `null`은 미지원, 누락·오류·권한 거부·불일치는 미확인, `0`은 유효한 숫자다. 모델 접두어는 adapter 선택에만 사용한다.
- 상세 캐시는 main 메모리의 한 계정 epoch에 묶었다. 최대 64개, 지원/미지원 10분·미확인 30초 TTL, 동시 GET 최대 4개, 같은 모델 조회 합류를 적용했다. 키 변경·세션 교체·목록 갱신은 캐시를 폐기하고 진행 GET을 취소한다. 취소한 caller에는 늦은 결과를 전달하지 않으며 다른 caller의 공유 GET을 취소하지 않는다. 상세 JSON은 256 KiB로 제한한다.
- Claude Messages·OpenAI Responses·Gemini native 요청에 실제 검색 도구를 연결했다. Gemini의 검색 지침만 붙이던 분기는 제거했다. 짧은 문서 전체 텍스트, 이미지, Claude PDF/thinking, 기존 수동 도구 경로와 Responses continuation은 회귀 fixture로 확인했다.
- 끄기/자동/항상/딥리서치를 유지했다. 미확인/미지원 모델은 **첫 유료 호출 전에** Sonar bridge를 계획하고 경로·추가 요청을 표시한다. Sonar가 없으면 막는다. 네이티브 생성 실패 후 검색 bridge·모델·endpoint로 우회하거나 유료 POST를 재전송하지 않는다.
- 비교는 Sonar 공통 evidence 한 묶음만 준비해 모든 모델에 같은 내용을 전달하고 답변별 네이티브 검색을 끈다. 딥리서치는 기존 Sonar 계획·3~4개 질의 조사를 유지하며 UI도 해당 경로로 표시한다.
- 공개 검색 상태와 출처를 typed IPC·메시지 UI·암호화 기록·백업 복원·대화/비교 내보내기에 연결했다. 기존 저장 버전을 올리지 않았고 필드 없는 과거 기록은 검색 실행을 추정하지 않는다. 기존 창 비율/크기 복원·보안 정책·의존성·릴리즈 설정은 변경하지 않았다.

## 공식 계약과 fixture 근거

2026-10-08 공개 문서와 공개 Markdown/HTML 코드 예제를 확인했다. 아래는 문서 계약 검증이며 계정 권한이나 실제 제공사 실행 검증이 아니다. 합성 wire fixture는 `tests/fixtures/native-search.mjs`에 있다.

| 경로 | 구현 계약 | 1차 출처 |
| --- | --- | --- |
| 모델 상세 | `/models/{encoded-id}/`, 정확한 모델 ID·종류와 필요한 pricing 필드 검증 | [Gateway 모델](https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/models/), [Gateway 서버 도구](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/) |
| Claude | `/claude/v1/messages/`, `web_search_20250305`, `name: web_search`, `max_uses: 2`; 기존 인증/version·PDF beta 경로 유지 | [Gateway 서버 도구](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/), [Claude web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| OpenAI | `/responses/`, `tools: [{type: web_search}]`; `web_search_call` 상태·완료 output annotations·스트리밍 annotation 수집 | [Gateway 서버 도구](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/), [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search) |
| Gemini | `/gemini/v1beta/models/{encoded-id}:streamGenerateContent?alt=sse`, `tools: [{google_search: {}}]`, contents/systemInstruction·inlineData·generationConfig·usage/finishReason 변환 | [Gateway Gemini native](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/gemini-native/), [Google GenerateContent](https://ai.google.dev/api/generate-content), [Google thinking](https://ai.google.dev/gemini-api/docs/thinking) |
| Sonar bridge | 기존 `/chat/completions/` 경로, 구조화 citations/search_results로 확인된 출처와 실행 상태 수집 | [Gateway chat completions](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/chat-completions/) |

Claude의 서버 도구 결과·텍스트 인용·search usage, Responses의 완료된 검색 호출, Gemini의 grounding 질의/청크/근거 연결을 각각 정규화한다. 답변 텍스트 속 URL만으로 네이티브 실행 성공을 선언하지 않는다. 검색 미실행/미확인, 도구 실패, 빈 결과, 이전 근거 재사용을 구별하며 제공사 검색이 실행되지 않으면 `missing`으로 표시한다. Sonar 구조화 실행 근거가 없는 응답도 미확인으로 남긴다.

공개 인용은 최대 64개, 질의 16개·각 512자, 네이티브 완료 호출 32개로 제한했다. URL은 HTTP(S)·자격증명 없음·최대 2,000자이며 Gateway 첨부 다운로드 주소는 공개 출처에서 제외한다. 출처 제목 500자·인용문 1,000자로 제한하고 Gemini 근거 index 범위를 검증한다. 공개 메타데이터에 Claude opaque/encrypted 필드, Gemini thought/signature와 HTML 검색 entry point를 넣지 않는다. 외부 열기는 기존 HTTPS 정책을 유지하며 HTTP 링크에는 차단 이유, 열기 실패에는 오류를 표시한다.

## 지원하지 않는 조합과 사전 차단

Coordinator와 확인한 1단계 제한이다. 모두 첫 유료 호출 전에 검사하며 사용자가 직접 모델·설정을 고르게 한다.

- Sonar는 Gateway에 검증된 검색 비활성화 계약이 없어서 검색 끄기, 공통 근거만 사용하는 비교 답변, 딥리서치 최종 답변 모델로 쓰지 않는다. 일반 대화 자동/항상 모드와 bridge 역할은 유지한다. 자동 모드 일반 질문에서도 검색 가능성을 표시한다. Sonar 자체 검색 상세가 미확인/미지원이면 다른 Sonar 검색을 먼저 수행한 후 Sonar로 답변하는 중복 경로를 만들지 않고 막는다.
- 자체 검색과 고정 수동 도구 선택, Claude 자체 검색과 수동 도구, Responses 자체 검색과 Temperature/Top P/중단 문자열, Gemini 자체 검색과 수동 도구 이력·JSON Schema·타 제공사 옵션은 막는다. Gemini 사고 강도는 자동 또는 제공사 사고 수준/예산의 명시 설정을 사용한다. 기존 검색 꺼짐/bridge의 수동 도구 경로는 유지한다.
- 백그라운드 Responses는 실제 검색이 필요한 모드와 함께 시작하지 않는다. 검색 꺼짐과 새 검색이 필요 없는 자동 모드의 기존 배경 응답 경로는 유지한다.

## 검증 결과

모든 결과는 Linux 로컬, 합성 자료, fetch/provider/Electron fixture 또는 DOM 환경이다. 실제 API 키·학생 자료·유료 API는 사용하지 않았다.

| 검사 | 결과·근거 |
| --- | --- |
| `npm run typecheck` | 통과. 최종 UI 문구 변경 뒤 `npm run build`에 포함된 동일 검사도 통과 |
| `npm test` | Node 223개 + 실제 컴포넌트 DOM 45개 통과, 실패/skip 0 |
| `npm run ui:audit` | 통과: 테마 각 39 token, contrast pair 68, boundary mapping 31, disabled mapping 5, token 밖 고정 색상 0 |
| `npm run build` | 통과: main/preload/renderer Linux production build |
| 변경 범위·문서 | 명시적 파일 stage, `git diff --check`, 로컬 문서 링크/fixture 참조 확인 |

핵심 회귀는 8종 catalog·null/누락/0/권한 거부·account epoch/캐시 상한·정확한 3사 URL/header/body·UTF-8 분할 SSE/최종 이벤트·최종/중복/위험 인용·도구 오류·취소·usage·Claude PDF/thinking/수동 도구·Responses continuation이다. 실제 main Gateway 모듈에 fetch fixture를 주입해 네이티브 실패 뒤 유료 POST 총 1회, 사전 차단 유료 POST 0회, 비교 Sonar 검색 1회 + 동일 근거 답변을 단언했다. 실제 백업 암호화/복원 코드와 격리한 임시 profile에서 새 메타데이터 보존·불필요한 필드 제거·다른 profile 기록 비노출도 확인했다.

실제 ChatPanel/ModelPicker DOM으로 보조 모델 제외·확인된 badge·명시적 기능 조회·미지원 bridge 계획·검색 상태/출처·HTTP 차단/열기 실패·Sonar 제한·삭제 모델 전송 차단을 확인했다. 기존 키보드·focus 복귀·동의 회귀와 360px wrapper·light/dark DOM 상태를 포함한다. 실제 OS 창의 시각적 layout 검사나 외부 브라우저 실행 성공 검증은 아니다. 초기 DOM harness의 animation-frame/부모 snapshot 동기화 실패는 harness를 보정하고 통과했으며 기대값을 낮추지 않았다.

민감정보 없는 상세 로컬 로그는 Git 제외 `.orca/phase1/`에 보관했다. 최종 제품 근거는 `npm-test-label-final.log`, `typecheck-gate.log`, `ui-audit-final.log`, `build-label-final.log`이며 앞선 실패/targeted 결과도 남겼다. Node의 기존 typeless-package 경고는 의존성/모듈 설정 변경 없이 유지했다.

## 남은 확인과 다음 소유권

별도 Sol은 기준 SHA부터 제품 commit의 diff·공식 도구 계약·계정/IPC·암호화/백업·개인정보·유료 호출 수·테스트 근거를 독립 검토한다. 구현자가 필요한 보정을 맡고 실행 책임자가 수락·통합한다. 이 기록의 본인 검증을 독립 검토로 보고하지 않는다.

실제 계정의 모델 상세·각 3사 검색/인용·Gateway 권한/스트림 형태는 미검증이다. CI, macOS/Windows 수동 UI, 서명/공증·설치·배포도 미실시다. 계정 접근과 비용 범위가 허용된 후 합성 입력으로 별도 확인해야 하며 mock 성공을 실서비스 성공으로 해석하지 않는다. 1단계 수락 전에 2단계 작업을 시작하지 않는다.
