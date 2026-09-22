# v0.4.0 implementation and verification

Scope: all seven recommendations and the previously proposed v0.4.0 work, including the prerequisite v0.3.4 regressions. A checked item requires implementation and relevant verification; release publication is a separate operation.

- [x] Storage limits: prevent unreadable writes, permit cleanup of legacy over-limit stores, test boundaries.
- [x] Attachment consent follows authoritative thread updates; test real ChatPanel.
- [x] Stable media polling, separate background failure status, forced manual credit refresh.
- [x] Network deadlines, cancellation and user retry; no automatic replay of billed generation.
- [x] Portable password-encrypted backup/restore for threads, projects, attachments and settings; exclude API keys; validate and restore atomically.
- [x] Per-answer model and creation time, including exports and background/partial answers.
- [x] CI on PR/push and release artifact/update metadata validation.
- [x] Safe diagnostic copy containing version, OS, model and failure stage, excluding credentials and conversation content.
- [x] Extract ChatPanel, MediaPanel, ModelPicker, common notices/confirmation and application dialogs.
- [x] Typed error/info/success feedback and accessible announcements.
- [x] Replace all six native confirmations with accessible themed confirmations.
- [x] ModelPicker keyboard/ARIA/focus-layer behavior; favorites/recent models.
- [x] Always-visible account version; expired files and blocked links explained.
- [x] Preserve explicit desktop sidebar preference across compact transitions.
- [x] Stable speaker colors and global shortcuts; memoize history grouping.
- [x] OCR progress and document selection scope visible to users.
- [x] Comparison synthesis evidence/uncertainty presentation and copy/export.
- [x] Direct I/O tests for gateway retry/status/timeout and storage write failure/recovery.
- [x] Completion audit: typecheck, relevant tests, full tests, build, CSS audit, actual component behavior checks.

Existing unrelated package.json allowScripts and untracked design/transcript documents must be preserved.

## 검증 근거

| 항목 | 구현 및 검증 |
| --- | --- |
| 저장 한도 | storage-limits.ts와 storage-limits.test.mjs: 500번째 대화, 10,000개 메시지 경계, 기존 초과 기록 정리 허용 |
| 첨부 동의 | 실제 ChatPanel DOM 테스트에서 같은 대화의 동의 철회 후 전송 차단·재확인 경로 검증 |
| 폴링·크레딧 | MediaPanel의 최신 콜백 ref와 고정 타이머, 배경 오류 별도 표시. 실제 DOM 테스트 및 credit-refresh.test.mjs |
| 전송 | gateway-transport.test.mjs: GET 재시도, 과금 POST 재전송 금지, 타임아웃·취소·상태 매핑·Retry-After |
| 백업 | backup-crypto.test.mjs 및 backup-storage.test.mjs: 다른 키체인 환경에서 프로젝트 원본·설정·대화 복원, 대상 API 키 유지, 변조·잘못된 암호·저장 실패 |
| 답변 이력 | chat-history.test.mjs 및 thread-export: 답변별 modelId와 createdAt. 과거 모델 정보는 추정하지 않음 |
| CI·산출물 | quality.yml 모든 push/PR, dist 명령에서 verify-release 실행. release-artifacts.test.mjs로 크기·해시·버전 검증 |
| 진단 | diagnostics.test.mjs: 고정 필드만 포함. main에서 허용된 모델 ID만 전달 |
| UI 구조·접근성 | ChatPanel/MediaPanel/ModelPicker/Login/AppDialogs 분리. 실제 확인창·모델 선택창의 키보드·포커스·안내 역할 DOM 테스트 |
| 즐겨찾기 | 실제 저장 I/O 테스트: 일반 설정 저장과 모델 선호 변경이 겹쳐도 최신값 보존 |
| 사이드바 | sidebar-ui-dom.test.tsx: 명시적으로 접은 데스크톱 상태가 컴팩트 왕복 후에도 유지 |
| 기타 표시 | 계정 버전 상시 표시, 만료 파일 설명, 차단 링크 DOM 테스트. 화자 순서별 색상·단축키 ref·대화 그룹 useMemo 소스 확인 |
| OCR·종합분석 | OCR 페이지/진행률 및 문서 발췌 안내. 근거·불확실성 표시, compare-export.test.mjs로 복사·Markdown 내용 검증 |
| 원자적 저장 | atomic-file.test.mjs에서 이름 변경 실패 시 기존 파일 보존, backup-storage.test.mjs에서 복원 준비 실패 시 기존 프로필 보존 |

## 최종 로컬 실행 결과

- `npm run build`: 타입 검사와 main/preload/renderer 프로덕션 빌드 통과.
- `node --test tests/*.test.mjs`: 테스트 파일 23개 모두 통과. 23은 개별 테스트 수가 아닌 파일 단위 집계다.
- `npm run ui:check`: 실제 UI 컴포넌트 DOM 테스트 31개 통과.
- `npm run ui:audit`: 대비 조합 68개 포함 CSS 감사 통과.
- `git diff --check`: 통과.
- package.json 및 package-lock.json: 버전 0.4.0.

## 사용 범위 및 검증 한계

- 백업은 저장된 대화·첨부 내용, 프로젝트 원본 문서·검색 데이터, 앱 설정을 포함한다. API 키, 미디어 생성물 및 비교 실행 기록은 제외한다. 일반 대화 첨부는 기존 저장 표현으로 보존하며 모든 첨부의 원본 파일을 새로 수집하지 않는다.
- 백업은 최대 512MB, 암호는 12자 이상이다. 암호를 분실하면 복원할 수 없다. 복원 후 첨부 전송 동의는 다시 받으며 원격 생성 작업을 자동 재개하지 않는다.
- 화자 이름을 함께 표시하며 색상은 6색을 순환한다.
- 네트워크·저장 오류 테스트는 주입한 오류를 사용했다. 실계정 과금 호출, macOS 서명·공증, Windows 설치, 실제 자동 업데이트 배포는 이번 로컬 검증에 포함하지 않았다.
- 이 문서는 구현 검증 기록이다. 커밋·푸시·릴리즈 게시 완료를 의미하지 않는다.
