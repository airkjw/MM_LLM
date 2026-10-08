# ChatKHU Phase 4 구현 — 2026-10-08

## 현재 상태·범위·소유권

**구현·저장 보정·로컬 합성 gate 완료 / 별도 전체 Phase 4 독립 검토 대기 / 실계정·OS 하드웨어·CI 미검증.** 수락된 Phase 3 HEAD `2d98a502eea512124016e89333ec5acdc1920be6`의 깨끗한 feature worktree에서 시작했다. 최초 제품은 `2963ea9e903807076d950262a9b0d1df4fea2057`, 최신 저장 보정 제품은 `8513d186067876053a405e6e0349cf4ce0eecb90`이다. 단일 구현 소유자 `task_6f1a1328f5c8` / `ctx_e882a4b52487`가 shared/main/preload/renderer/storage 경로/CSS/packaging 및 테스트를 직렬 편집했다. 내부 순서는 OpenAI Realtime → Gemini Live → Soniox 받아쓰기이며 위임하지 않았다. Coordinator가 다음 별도 읽기 전용 전체 독립 검토·필요 보정 배정·수락·통합을 소유한다. 구현자의 검증을 독립 acceptance로 보고하지 않는다.

직접 runtime 의존성 `ws` 8.21.3과 dev `@types/ws` 8.18.1을 편집 전에 이유와 함께 선언했다. 모두 기존 전이 설치 버전과 같으며 기존 package 버전 상승은 0건이다. Node built-in WebSocket은 browser-compatible API이므로 ws 전용 maxPayload/handshakeTimeout/followRedirects 옵션을 제공한다고 가정하지 않았다. [공식 ws API](https://github.com/websockets/ws/blob/master/doc/ws.md)와 설치 소스에서 payload 제한, bufferedAmount, close/terminate, redirect 정책을 확인했고 직접 의존성·lock의 ws production 분류만 반영했다. 앱은 v0.5.1을 유지한다.

## 동작과 보안 경계

| 경로 | 구현한 결과 |
| --- | --- |
| `src/main/realtime-session.ts`, shared `realtime.ts` | main 소유의 세션·키·토큰·WS·provider protocol, 단일 pending/active 예약, profile epoch·창·세션 identity, typed 프레임/제어와 오류 정규화 |
| `src/main/index.ts`, `voice-permissions.ts`, preload/contracts | 기존 trustedInvoke와 같은 sender/mainFrame 검증, 정확한 IPC allowlist, 계정/키/backup restore/창 종료 중단, Electron44 check/request handler의 개별 media shape 검증 |
| `voice-audio.ts`, public `voice-capture.js` | self resource AudioWorklet, 실제 AudioContext sampleRate 기준의 상태 유지 resampler, signed16LE mono 0.1초 프레임, 유한 전송/재생 큐·실제 재생 길이·중단/track ended/늦은 permission 정리 |
| 실제 `VoicePanel.tsx`, `App.tsx`, `ChatPanel.tsx`, CSS | 별도 realtime selector와 Soniox 용도, 음성 전송/과금 동의, 시작/음소거/종료·마이크 표시·경과 시간, 초안 append와 암호화 텍스트 저장의 별도 명시적 동작 |
| package/mac entitlement | 마이크 usage description와 `com.apple.security.device.audio-input`만 추가; 기존 hardened runtime과 창 크기·sandbox·context isolation·CSP 유지 |

Realtime selector는 현재 계정 catalog의 realtime 종류와 검토한 OpenAI 2종·Gemini 2종을 교차한다. Soniox stt-rt-v5는 별도 받아쓰기이며 realtime 목록 부재를 영구 권한 거절로 저장하지 않는다. 렌더링·타이핑·모델/용도 변경·앱 시작에는 신규 음성 API 요청이나 권한 탐색 POST가 없다. 사용자가 전송·과금 동의 후 시작하면 main 준비 예약 → OS 마이크 준비 → 세션 POST 1회 순서다. 중복 click/start guard는 첫 await 전에 걸린다. permission 취소 뒤 늦게 반환된 track도 바로 stop하며 session POST는 0회다.

[Gateway realtime 계약](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/realtime/)과 markdown 예제를 다시 조회했다. session POST는 수정된 공통 Gateway transport의 강제 `redirect: error`를 사용한다. `gateway.live_session`, model echo, ISO expiry와 일회용 토큰을 검증하고 반환값은 정확한 상대 route만 허용한다. 고정 Gateway WSS origin에 token query를 한 번 붙이며 임의 host·자격 증명·추가 query·fragment·대체 route를 거절한다. 토큰은 main 메모리에서만 사용하고 renderer·저장·로그에 전달하지 않는다. 재발급·토큰 재사용·재연결·음성 재전송·유료 POST retry는 없다. 60초 token 유효 시간은 초기 handshake만 제한하며, 승인된 active session을 60초에 끊지 않는다.

WS는 incoming 256KiB, outgoing bufferedAmount 128KiB, handshake/초기 응답 10초, 입력 0.1초와 초당 유한 budget, 입력 메시지 수/bytes, renderer 미수신 delivery 32개, 미재생 출력 5초를 제한한다. `followRedirects:false`, 압축 비활성화는 고정 옵션이며 caller가 덮어쓸 옵션 merge를 제공하지 않는다. 명시적 close와 1초 후 terminate를 사용하고 connecting 종료의 비동기 error를 보호한 뒤 close에서 timer/listener를 없앤다. token URL이나 raw provider reason은 오류 메시지·fixture diagnostics에 나오지 않는다.

OpenAI는 [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), [client events](https://developers.openai.com/api/reference/resources/realtime/client-events), [server events](https://developers.openai.com/api/reference/resources/realtime/server-events)의 Realtime protocol을 사용한다. 첫 session.update에 type realtime·audio 출력·PCM24k 입출력·server_vad·빈 tools를 설정하고 session.updated 뒤에만 입력을 보낸다. 음성 delta·전사·done·error를 유한 처리한다. server_vad의 interrupt_response로 제공사가 취소하며 speech_started에서 renderer 재생 큐를 즉시 비운다. 실제로 재생한 길이로 item truncate를 보내고 기존 item의 늦은 음성을 버린다. 도구 요청은 명시적 오류로 닫으며 로컬 실행은 없다.

Gemini는 고정 v1beta BidiGenerateContent route의 setup → setupComplete 후 active, AUDIO·input/output transcription, input PCM16k·output PCM24k를 사용한다. [capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)의 realtimeInput.audio와 음소거 시 audioStreamEnd를 따른다. [thinking lifecycle](https://ai.google.dev/gemini-api/docs/live-api/thinking/)의 extended-thinking IN_PROGRESS/IDLE을 보존해 filler turnComplete를 idle로 오표시하지 않는다. 일반 live에 thinking parameter를 추측해 넣지 않으며 도구 event는 닫는다.

Soniox는 [WebSocket API](https://soniox.com/docs/api-reference/stt/websocket-api)의 JSON 설정 뒤 binary PCM24k mono를 보내며 api_key 필드를 넣지 않는다. 종료는 빈 **텍스트** 프레임이며 마이크를 바로 해제하고 최대 5초 동안 finished=true 최종 응답만 기다린다. timeout/조기 close는 미확정 응답을 정직하게 설명하며 수신한 final만 사용한다. final은 start/end 좌표가 있으면 그 좌표와 token으로 중복을 판정하고, 좌표가 없으면 소유한 메시지당 한 번 소비한다. 같은 단어가 반복돼도 보존하고 provisional 영역만 교체하며 `<end>`/`<fin>`을 제거한다. [문서화된 keepalive](https://soniox.com/docs/stt/rt/connection-keepalive)는 사용자 세션이 muted인 동안만 10초 간격으로 보낸다.

원음 파일·녹음·자동 저장은 없다. capture/playback chunk는 메모리에만 있고 종료/오류/계정 변경/화면 해제에서 버린다. 확정/임시 preview 합계는 12,000자로 제한한다. 받아쓰기는 종료 뒤 사용자가 확정문을 기존 composer 뒤에 append하고 직접 전송한다. 음성 대화 텍스트는 기본 저장하지 않으며 종료 후 별도 저장 동의와 버튼을 눌러야 기존 `updateThread` 암호화 저장·텍스트 백업에 들어간다. 원음·토큰은 백업에 없다. 계정/키/창/화면 teardown은 늦은 예전 전사와 저장 소유권도 폐기한다.

UI는 1분 예약·사용 중 추가 예약·종료 후 실제 정산, 음소거가 과금 종료가 아님, 조직 설정에 따른 OpenAI/Gemini 개인정보 필터와 Soniox 무필터를 표시한다. 첨부 동의를 음성 전송 동의로 재사용하지 않는다. 실제 [Electron session API](https://www.electronjs.org/docs/latest/api/session)와 설치된 44.4.1 types에 따라 nullable contents·top frame·trusted URL·singular mediaType 체크와 mediaTypes 요청을 분리한다. audio만 준비 상태에서 허용하고 camera/mixed/unknown/subframe/read 권한은 거절하며 trusted clipboard-sanitized-write와 기존 main 외부 링크 경로를 보존한다. Apple [media authorization](https://developer.apple.com/documentation/bundleresources/requesting-authorization-for-media-capture-on-macos)·[audio-input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input)에 따라 microphone만 선언했다.

## 최초 제품의 고정 소스 검증·receipt (역사)

Linux x86_64, Node v24.21.0, npm 11.19.0에서 synthetic temp vault·주입 mock WS·가상 마이크/AudioContext·fake timer·로컬 native WS/Fetch만 사용했다. 실제 학생 키·프로필·음성·유료 API는 사용하지 않았다.

새 등록 검증은 Node 29개·실제 DOM 6개다. provider manager 13개, native ws 3개, 실제 main IPC/permission/암호화 storage/backup 7개, resampler/worklet/AudioContext 6개가 3사 초기화·입출력·종료·동의·토큰 만료/재사용·잘못된 URL/model·오류 코드·Gemini timeout/thinking·Soniox 빈 TEXT/final drain/repeated words·초과 프레임/큐/backpressure·계정 전환·재생 중단·장치 끊김을 검증한다. 실제 VoicePanel/App DOM 6개는 double start·permission 거절/늦은 마이크·mute·cleanup·명시적 save/apply·기존 draft 보존·자동 전송 0회·logout·좁은 portrait/두 테마/native keyboard focus를 검증한다. 새 DOM 파일을 `ui:check`에 등록했다. native ws는 동일/다른 origin 301/302/303/307/308의 대상 요청·token 전달 0회, pending 취소/계정 변경/timeout의 미처리 error 없음·listener 0개, 실제 maxPayload 차단을 검증했다. native token POST도 redirect replay 0회다.

| 정확한 제품 commit의 최종 명령 | 결과 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0; **Node 327/327 + 실제 DOM 88/88 = 415/415**, fail/cancelled/skipped/todo 0 |
| `npm run ui:audit` | exit 0; 테마 tokens 각 39, hardcoded color 0, contrast 68, control mappings 32 |
| `npm run build` | exit 0; Linux production build와 script 내부 typecheck |
| baseline → product `git diff --check` | exit 0 |

제품 commit 고정 뒤 네 gate와 diff를 각각 한 번 실행했다. 169개 제품 입력 파일의 명령별 전후 SHA-256이 같고 tested product Git blob·현재 소스와 일치한다. build의 `out/renderer/voice-capture.js`는 self-hosted 원본과 bytes/hash가 같다. raw gate diagnostics에 token query URL이 없음을 확인했다.

Ignored 근거의 기준 폴더는 `.orca/phase4/gates/2963ea9e903807076d950262a9b0d1df4fea2057/`이다. 각 `typecheck`, `test`, `ui-audit`, `build`, `diff-check` 아래 `stdout.log`, `stderr.log`, `receipt.json`, `source-before.json`, `source-after.json`이 있다. receipt는 argv·cwd·시각·exit·HEAD·OS/Node/npm·비밀값을 redacted한 환경·log bytes/hash를 담는다. `.orca/phase4/receipt.json`과 `verification.json`이 최종 index/blob 검증이다. 초기 집중 실패와 원문도 같은 `.orca/phase4/`에 덮어쓰지 않고 보존했다. TypeScript fixture 호환/VoiceOwner narrowing, 실제 close listener 등록 순서, canonical CSS token을 보정했다. 나머지 초기 실패는 mock quit·동일 synthetic token 재발급·directory iteration·비현실적 즉시 audio frame timing·DOM EventTarget fixture 차이를 수정했으며 gate assertion을 낮추지 않았다. 성공 이후 제품 소스를 수정하지 않았다.

## 다음 소유권·제한

### 사전 검토 저장 보정 — 전체 독립 검토 대기

기준 docs `431404b7827ac47fbd78f1a4aa1114ceb074dfaa` / 제품 `2963ea9e903807076d950262a9b0d1df4fea2057`에서 단일 보정 소유자 `task_1a3c5c47a6fc` / `ctx_b4b994bae0aa`가 P2-A main 확정문 저장의 예약·commit·rollback과 P2-B VoicePanel 동시 저장·늦은 완료 소유권만 수정했다. 범위는 실제 main/session/storage/atomic-file의 짧은 로컬 트랜잭션, VoicePanel과 관련 등록 회귀 테스트이며 의존성·버전·이전 단계 리팩터는 제외했다.

main은 첫 await 전에 같은 completed object를 예약하고 명시적으로 캡처한 profile/epoch/창 owner로 읽기·변경·암호화·파일 교체 직전과 반환 시 소유권을 확인한다. 기존 vault mutation queue에서 캡처한 프로필 파일만 읽고 쓴다. 누락/삭제/chatbot/용량/교체 전 디스크 실패는 같은 completed object와 identity가 여전히 소유할 때만 예약을 반환해 사용자의 새 저장 동작을 허용한다. atomic rename 성공 시에만 claim을 소비하며, 그 뒤 directory sync가 실패해도 이미 기록된 문장을 중복 저장하지 않는다. 계정/키/복원/새 세션/창/화면 변경 뒤 예전 완료는 새 claim이나 반환 화면을 바꾸지 않는다. 현재 thread LLM 모델은 보존하고 메시지의 안전한 voice 모델 출처와 확정문만 암호화한다. 추가 endpoint·자동 재시도·원음/토큰 저장·vault lock 안의 네트워크는 없다.

VoicePanel은 동기 예약과 session/target/component epoch를 캡처한다. pending save 중 Start/모델/용도는 동기 handler guard와 disabled control로 막고, 종료 화면 collapse/target 변경/unmount에서 예약 소유권을 폐기한다. 성공·실패·finally는 해당 operation만 갱신하며 같은 세션 실패 후 명시적 재시도가 가능하고 새 세션은 저장됨 표시를 상속하지 않는다.

보호된 원본 main 1개·UI 2개는 bytes/hash 변경 없이 모두 통과했다. 누락/삭제/chatbot/10,000개 메시지/마지막 1개 슬롯/ENOSPC, 실제 암호화 저장의 동시 중복·queue 대기·암호화/임시 sync 중 lifecycle 변경·교체 이후 늦은 결과, 같은 UUID의 새 completed object를 등록 테스트로 검증했다. UI는 같은 batch Start/모델/용도·실패 재시도·collapse 후 새 pending save·target/unmount/logout·좁은 창/두 테마/키보드 포커스를 검사했다. 추가 등록 회귀는 Node 11개·DOM 7개이며 집중 결과는 Node 31/31·DOM 13/13이다. 초기 새 UI fixture의 동의 toggle/viewport 오염 실패와 실행 종료 receipt는 보존하고 fixture만 바로잡았으며 원본 assertions는 변경하지 않았다.

| 최신 제품 커밋 고정 뒤 각 1회 실행 | 결과 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0; **Node 338/338 + DOM 95/95 = 433/433**, fail/cancelled/skipped/todo 0 |
| `npm run ui:audit` | exit 0; 테마 tokens 각 39, hardcoded color 0, contrast 68, control mappings 32 |
| `npm run build` | exit 0; Linux production build와 script 내부 typecheck |
| 기준 docs → 최신 제품 `git diff --check` | exit 0 |

Ignored 근거는 `.orca/phase4-save-correction/gates/8513d186067876053a405e6e0349cf4ce0eecb90/`이다. 명령별 full stdout/stderr·exit·cwd/argv·UTC 시각·비밀값 redacted 환경·source-before/after·제품 Git blob manifest를 보존했다. 169개 제품 입력의 전후 SHA-256과 제품/current Git blob이 모두 같으며 built voice-capture bytes도 원본과 같다. 통합 gate index `manifest.json` SHA-256은 `4e32bd2110a2c18527ffadbbc180450952f0a0045ca31a2563fa36b3593268af`, 공통 source manifest는 `2318c572c5182f87ed6674f0ed5407432f7a07d924f3850be535e66b1c15c91f`, 제품 blob manifest는 `fd234a57138100ae2d05cc78421580dfee299a66c5c21b978c60385ee1d4049f`다. `.orca/phase4-save-correction/report.txt`, `receipt.json`, `verification.json`에 최종 제품/docs SHA와 명령별 hash를 인계한다. 기존 415개 gate·원본 재현 실패의 raw 로그와 receipt hash도 그대로 대조했다. Coordinator가 다음 별도 **전체 Phase 4** 독립 검토와 수락을 소유하며 저장 보정만의 검토로 대체하지 않는다.

Coordinator가 제품 commit·docs-only 기록·raw receipt를 별도 Sol reviewer에게 인계해 독립 검토와 필요한 후속 Dispatch를 소유한다. 실계정 권한·실제 provider 음성/차감·OS permission/hardware·시각적 수동 검증·CI·macOS 서명/공증·Windows 설치는 미실시다. Linux 빌드를 그 성공으로 승격하지 않는다. 기존 desktop-to-compact open-dialog focus-return 문제는 Phase 3 이전부터 있던 deferred 항목으로 보존했다. main merge/push/release/version 변경·추가 설계 감사는 하지 않았다.
