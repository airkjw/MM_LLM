# ChatKHU 3단계 구현·검증 기록 — 2026-10-08

승인된 [4단계 계획의 3단계](chatkhu-api-expansion-plan-2026-10-08.md)를 단일 구현 worker가 직렬 구현한다. 기준은 Phase 2 독립 acceptance와 실행 책임자 수락을 포함하는 `06140d7a72c0a2ff8340413ffe03a132215d6046`이며 시작 작업 트리는 깨끗하다. Dispatch `ctx_2a45f44422f0`, Task `task_a6948ed6fec5`의 구현 소유자는 shared/main/preload/renderer/관련 테스트·이 문서를 소유하고 실행 책임자가 통합·별도 독립 검토를 배정한다.

범위는 기본 꺼짐 Claude Messages·OpenAI Responses 서버 코드 도구, bounded typed 결과의 암호화 저장·복원·내보내기와 image/video/music 명시적 공식 견적이다. Gemini 코드 도구, Phase 4, 실계정·유료 호출·개인 데이터, 의존성·버전 변경, main merge·push·배포는 범위 밖이다. 완료 조건은 실제 요청·헤더·스트림·IPC·DOM 합성 회귀와 typecheck/test/ui:audit/build 통과, 정확한 제품 commit에 묶인 `.orca/phase3/` durable gate receipt, 로컬 scoped commit과 깨끗한 트리 및 독립 검토 인계다.

## 계약 조사

2026-10-08 공개 1차 문서를 직접 열고 검증했다. 로컬 원문은 ignored `.orca/phase3/gateway-server-tools.txt`, `gateway-estimate.txt`, `gateway-responses.txt`, `openai-code.txt`, `openai-events.txt`, `openai-create.txt`, `claude-code-web.txt`에 보존한다. Gateway는 Claude `code_execution_20250825`와 `anthropic-beta: code-execution-2025-08-25` 헤더, Responses `code_interpreter`·`container: {type:auto}`를 문서화한다. 공급자의 새 버전·무료 시간 정책으로 Gateway 계약·최소 과금을 대체하지 않는다.

- [Gateway 서버 도구](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/): Claude 최소 5분, OpenAI 최소 15분 및 별도 토큰 비용.
- [Gateway Responses](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/responses-api/): OpenAI Responses 형식·체이닝·스트림.
- [Claude 코드 실행](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool): server_tool_use·bash/text_editor 결과·오류, supported model 표, 스트림 입력 JSON·완전 결과 블록. 기존 beta opt-in은 유효하다.
- [OpenAI Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter), [Responses events](https://developers.openai.com/api/reference/resources/responses/streaming-events), [Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create): item_id 기반 상태와 `response.code_interpreter_call_code.delta/done`, logs/images/null 출력.
- [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra): Responses 코드 도구 지원. 검토한 정확한 ID만 현재 계정 catalog와 대조하며 제공사 지원이 계정 권한을 보장하지 않는다.
- [Gateway 견적](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/estimate/): 무료·예약 없음, kind별 옵션, bound/lines/note, 편집 모델 제한, 실제 generation credits에서 content_filter 제외.

## 구현·검증 결과

제품 구현 commit은 `1e5471cd31e14483b982e7be046ca7adfb9e0f3a`, 산출물 literal type 보정 commit은 최종 gate 기준인 `81636b55b3a081dbbfab690491648470067fef1b`다. 독립 검토와 실행 책임자 수락은 아직 미실시이며, 아래는 단일 구현자의 합성 검증이다.

- `serverCode`는 고급 설정의 선택적 boolean이며 과거 기록과 새 대화의 기본은 꺼짐이다. 지원 표는 `src/shared/server-code.ts`의 검토한 정확한 ID로 고정하고 main의 현재 계정 LLM catalog 존재를 함께 요구한다. 미래 접두어·웹 검색 가격으로 코드 지원을 추론하지 않는다. 목록 존재와 공급자 지원은 계정별 도구 권한·Gateway 가격을 보장하지 않으며 실행 전 안내한다.
- Claude는 검증된 도구 버전·beta 헤더를 사용하고 beta를 body에 넣지 않는다. OpenAI는 Responses endpoint·자동 기본 container를 사용한다. 기존 native web search·수동 도구·Responses chain·thinking 경로를 유지한다. Claude 코드+수동 함수+서명된 사고의 전체 서버 도구 replay는 미구현이므로 사고를 끄도록 **첫 유료 POST 전에** 차단한다. Claude 코드 단독의 사고와 사고를 끈 수동 함수 혼합은 허용한다. `pause_turn`은 기존 명시적 unsupported continuation을 유지하며 자동 도구 반복/continuation은 없다.
- OpenAI 공식 create schema의 `include: [code_interpreter_call.outputs]`는 확인했다. 현재 공개 Gateway Responses 문서는 OpenAI 형식을 안내하지만 해당 필드의 passthrough 지원을 명시하지 않으므로 이번 구현은 `include`를 보내지 않는다. 반환된 logs/images/null·최종 item을 병합하고 미반환 출력은 미확인으로 표시한다. OpenAI logs는 stdout으로 꾸미지 않고 표준 출력/오류 구분 미제공으로 표시한다. 문서에 명시된 Gateway passthrough 계약을 확인한 뒤 추가할 후속 항목이다.
- provider 코드 실행은 서버에서만 이뤄진다. 제품에 로컬 eval/shell/exec 실행 경로는 없다. `executing/completed/failed/cancelled`와 코드·Claude stdout/stderr·OpenAI logs·요약·산출물 metadata를 assistant text/수동 함수와 분리했다. 1턴 최대 8개, 코드/stdout/logs 각 8,192자·stderr 4,096자·요약 1,000자·산출물 8개로 제한한다. unknown/도구 오류/응답 중단을 성공으로 승격하지 않는다. provider container/URL/token/raw envelope는 public metadata에 남기지 않고 임의 링크·다운로드는 제공하지 않는다. 첨부·프로젝트 전송은 기존 동의 경계를 유지한다.
- 결과 metadata를 기존 encrypted thread/job store의 typed 필드에 연결했고 thread normalization·portable backup restore·Markdown export에 같은 projection을 적용했다. 저장/백업 버전은 유지하며 옛 기록에 실행을 추정하지 않는다. 취소된 provider 작업의 완료/과금은 앱이 확인할 수 없음을 알린다.
- `/estimate/`는 명시적 `비용 확인`에서만 한 번 POST한다. image/video/music만 허용하고 prompt/lyrics/개인 reference/bytes/임의 endpoint/key는 IPC allowlist에서 제외한다. 같은 이미지·비디오·음악 generation payload helper와 기존 옵션 validation을 재사용한다. 타이핑/렌더/모델·옵션 선택은 견적이나 upload를 호출하지 않는다. edit-only 모델에 필요한 reference 계약이 없는 경우 서버의 quote unavailable을 표시하고 가짜 URL을 만들지 않는다.
- main의 동기 요청 예약·session identity·취소와 기존 scheduler를 사용하며 network 동안 vault lock을 잡지 않는다. renderer는 account/workspace epoch·정규화 모델/옵션 fingerprint·시각에 견적을 묶고 text/reference/옵션 edit·profile change·cancel·늦은 응답에 무효화한다. 견적과 generation 양쪽 동기 클릭을 각각 1회로 제한한다. 유료 POST retry·모델/route fallback은 없다.
- finite nonnegative 가격, 일치하는 model/kind, 네 bound와 exact flag, 최대 16개 lines·각 note 2,000자 및 합계를 검증한다. 확정/최소/최대/대략·항목·설명을 표시하며 실패/unknown을 0으로 표시하지 않는다. `견적 없이 생성`은 별도 명시 동작이다. 견적은 무료·예약 없음·입력 및 생성 보장 없음으로 안내한다.
- obsolete hardcoded 이미지/영상/음악 단가와 비용 helper를 제거했고 옵션 제한을 보존했다. 이미지·영상 body `credits_charged`, 음악 `X-Credits-Charged`를 실제 생성 차감으로 표시하며 `content_filter` 별도 차감을 임의 합산하지 않는다. pending media job에도 실제 credits를 보존하고 기존 credit refresh를 사용한다. STT/TTS 견적 기능은 추가하지 않았다.

## 합성 검증 범위

임시 synthetic userData·mocked fetch만 사용한다. 집중 회귀는 `107/107`, 새 실제 DOM은 `8/8`을 통과했다. 초기 집중 실행의 Node strip-only constructor 문법과 synthetic 오디오 fixture 헤더 문제를 수정했다. 첫 final gate typecheck는 artifact kind literal 추론 오류로 exit 2였으며 별도 보정 commit과 receipt에 기록했다. 성공한 검사 후 제품 소스는 변경하지 않는다.

- actual main/transport의 Claude beta·도구 payload, Responses container·chain, stream/nonstream code 상태·logs·오류·정상 assistant text 구분, `pause_turn`, abort cancelled 결과, 첨부 동의 전 paid POST 0회, account key 전환 경계와 unknown 모델의 검색 전 paid POST 0회.
- encrypted store 경로의 실제 저장·로드, portable backup normalization/restore·버전 유지, bounded 코드·산출물 projection과 raw token/URL 제거, 공개 Markdown serialization. 실제 OS keychain 검증과 구분한다.
- actual advanced settings/ChatPanel DOM에서 기본 OFF·비용 안내·opt-in save·unknown disabled, 늦은 실행 상태·결과 패널·수동 카드 분리와 텍스트로만 렌더되는 untrusted code/artifacts.
- actual estimate IPC/fetch의 request body·헤더·옵션·reference/prompt 제외, 이미지/영상/음악 payload 매핑, 네 bound·lines·note·합계·bad/absent/nonfinite 가격·model-kind mismatch·no-price/edit-only/403·64 KiB 제한. 실패 후 retry 0회.
- actual MediaPanel DOM에서 render/typing/options 호출 0회, 견적·generation back-to-back click 각각 1회, generation 옵션과 quoted normalized 옵션 일치, 취소/옵션·account epoch 변경/늦은 응답 폐기, 견적 불가 후 별도 unquoted generation.
- 실제 생성 transport에서 이미지/영상 body 및 음악 header credits 분리, network pending 중 vault read 완료. 기존 Phase 1 preflight/native search/PDF/thinking과 Phase 2 semantic preflight/project/backup, legacy media-jobs/security/transport를 집중 및 전체 suite에 포함한다.
- 설정 dialog keyboard focus/Escape 복원, 390px DOM·테마 CSS token 경로와 전체 UI audit를 확인한다. 기존 desktop→compact focus 진단은 별도 사전 범위로 보존한다.

## 최종 제품 gate receipt

정확한 검증 제품 hash: `81636b55b3a081dbbfab690491648470067fef1b`. Linux x86_64, Node `v24.21.0`, npm `11.19.0`, 합성 temp userData·mocked fetch 환경이다. 최종 제품 소스에서 아래 gate는 각각 성공했다. `npm run build`는 저장된 script 자체에 typecheck를 포함한다.

| 명령 | 결과 | 상세 |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | TypeScript 오류 0 |
| `npm test` | exit 0 | **Node 277/277 + 실제 DOM 80/80**, fail/cancelled/skipped/todo 모두 0 |
| `npm run ui:audit` | exit 0 | light/dark tokens 각 39, hardcoded color 0, contrast pairs 68, control mappings 31 |
| `npm run build` | exit 0 | main/preload/renderer Linux production build 성공; 서명·공증·배포 미실시 |

수락된 Phase 2 baseline `256 Node + 72 DOM`에서 이번 Phase 3 fixture는 Node 21개·DOM 8개를 더했다. 성공 이후 제품·테스트·package 설정 변경은 없고 보고 MD만 추가했다.

검토자가 같은 성공 gate를 반복하지 않도록 다음 **ignored 로컬 파일**에 전체 stdout/stderr·exit code·명령·시각·환경·제품 hash를 보존했다:

- 최신 receipt: `/home/airkjw/orca/workspaces/MM_LLM/chatkhu-api-expansion-20261008/.orca/phase3/receipt.json`
- 최종 hash 고정 receipt: `/home/airkjw/orca/workspaces/MM_LLM/chatkhu-api-expansion-20261008/.orca/phase3/gates/81636b55b3a081dbbfab690491648470067fef1b/receipt.json`
- 위 최종 폴더의 `typecheck.stdout.log`, `typecheck.stderr.log`, `test.stdout.log`, `test.stderr.log`, `ui-audit.stdout.log`, `ui-audit.stderr.log`, `build.stdout.log`, `build.stderr.log`.
- 최초 typecheck exit 2 receipt와 원문: `/home/airkjw/orca/workspaces/MM_LLM/chatkhu-api-expansion-20261008/.orca/phase3/gates/1e5471cd31e14483b982e7be046ca7adfb9e0f3a/receipt.json` 및 `typecheck.stdout.log`/`typecheck.stderr.log`. literal type 보정 이후 네 gate 모두 성공했으며 이전 실패를 덮어쓰지 않았다.
- 집중 Node 107/107: `/home/airkjw/orca/workspaces/MM_LLM/chatkhu-api-expansion-20261008/.orca/phase3/focused-final.log`; 새 DOM 8/8: `/home/airkjw/orca/workspaces/MM_LLM/chatkhu-api-expansion-20261008/.orca/phase3/phase3-dom-focused.log`. 최종 전체 suite receipt가 제품 hash에 묶인 authoritative 검증이다.
- 공개 문서 snapshots: `/home/airkjw/orca/workspaces/MM_LLM/chatkhu-api-expansion-20261008/.orca/phase3/`의 `gateway-server-tools.txt`, `gateway-estimate.txt`, `gateway-responses.txt`, `claude-code-web.txt`, `openai-code.txt`, `openai-events.txt`, `openai-create.txt`.

모든 receipt/log는 synthetic data만 포함하며 Git staging에서 제외했다. 실계정 결과·CI 결과·macOS/Windows 결과로 이 로컬 성공을 승격하지 않는다.

## 잔여 제한·독립 검토 인계

실계정 catalog·도구별 permission·실제 provider 실행·실제 차감은 검증하지 않았다. 최소 시간 이외 계정별 정확한 요금은 미확인이다. Gateway `include` passthrough와 artifact download 경로는 명시적 지원 계약 확인 후 별도 후속 작업이며 현재 출력/산출물 미확인을 정직하게 표시한다. Gemini 코드·Phase 4·macOS 서명/공증·Windows 설치·CI·main merge/push/release/version 변경은 수행하지 않았다.

구현자는 이 소스·문서·로컬 receipt를 실행 책임자에게 인계하고 별도 Sol independent review를 요청한다. 독립 검토 acceptance를 스스로 선언하지 않는다. 수락된 보정이 있으면 실행 책임자가 새 Dispatch의 소유권을 지정하며, 현재 Task 완료 후 worker는 idle을 유지한다.
