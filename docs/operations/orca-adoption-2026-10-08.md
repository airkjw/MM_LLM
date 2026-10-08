# MM_LLM Orca 오케스트레이션 도입

## 요청과 기준

2026-10-08 사용자는 `sbv_emr_crm`과 `sbv_homepage`에서 사용하는 Orca 코딩 방식을
MM_LLM의 현재 대화와 이후 작업에도 적용하도록 요청했다.
기준 소스는 v0.5.1, commit `fc2d34c52094cc43e452037bb19ae3b548b9556a`다.

참조한 실행 규칙:

- OcuOS 작업트리의 `docs/ocuos_orca_execution_policy.md`
- 홈페이지의 `docs/operations/orca-execution-policy.md`
- 설치된 Orca의 `orchestration`, `orca-cli` 및 `references/coordinator-loop.md`

## 계획과 소유권

1. [실행 규칙](orca-execution-policy.md)에 Astra medium 자문, Sol xhigh 구현과 별도
   독립 검토, Run/Task/Dispatch, worktree·파일 소유권, 결과 수락·ACK·release를 정한다.
2. 루트 `AGENTS.md`와 `CLAUDE.md`가 같은 실행 규칙을 가리키도록 한다.
   의료경영 앱의 개인정보·Electron·자동 업데이트 검증 기준을 유지한다.
3. `.orca/`의 업로드·로컬 실행 기록을 Git에서 제외한다.
   사용자용 README에 운영 세부사항을 추가하지 않는다.
4. 실행 책임자가 문서를 작성하고, Orca의 별도 Sol xhigh worker가 읽기 전용으로
   실제 변경을 검토한다. 구현 후 보정과 통합 소유권은 실행 책임자에게 있다.
5. 실제 launch의 requested/effective 모델·effort, 작업 시작, 완료 보고와 정식
   정리를 확인한다. 링크·diff·기존 변경 보존을 확인하고 결과를 이 문서에 기록한다.

이번 범위는 개발 운영 방식의 도입이다. 직전 API 조사 결과는 구현 요청이 아니며,
제품 기능 변경·버전 증가·릴리즈는 이번 작업에 포함하지 않는다.
기존 `package.json` 수정, 디자인 자료, 대화 기록, 업로드와 다른 프로젝트의 설정은 보존한다.

## 진행과 검증

- [x] 두 프로젝트의 실행 규칙과 설치된 Orca 스킬 확인
- [x] Orca runtime 연결, 현재 MM_LLM worktree와 기준 SHA 확인
- [x] 현재 대화에 연결된 Run이 없음을 확인
- [x] 프로젝트 실행 규칙·agent 안내·로컬 기록 제외 적용
- [x] 실제 Orca 독립 검토와 launch 증거 확인
- [x] 검토 결과 수락, worker 정리와 Delivery ACK
- [x] 문서 링크·diff·기존 변경 보존 확인

## 완료 근거

- 루트 agent 안내 2개, 실행 규칙과 도입 기록, `.gitignore`를 반영했다.
  제품 소스·README·버전·의존성·릴리즈 설정은 변경하지 않았다.
- 실제 Orca Run에서 읽기 전용 reviewer 1명이 도입 변경을 검토했다.
  requested/effective 모두 `codex` / `gpt-6.1-sol` / `xhigh`로 일치했다.
  시작 receipt의 `ready`, `input_accepted`, `turnStart: observed`와
  `prompt.stages`의 `turn_started`를 확인했다. Astra 자문 호출은 필요하지 않았다.
- 독립 검토 결과는 **PASS, 수정이 필요한 지적 0건**이다.
  두 프로젝트의 정책과 설치 스킬, 역할·소유권·개인정보·권한 경계 및 문서 링크를 대조했다.
  reviewer는 파일을 수정하지 않았으며 비공개 업로드·대화 기록을 읽지 않았다.
- 실행 책임자가 해당 Task·Dispatch의 `succeeded/settled`, Dispatch `completed`와
  완료 근거를 확인해 수락했다. 정식 release 결과는 `released`,
  `closed_agent_terminal`, archive `transcript/captured`였다.
  Delivery ACK 후 해당 Run의 reclaimable worker는 0이다.
- archive 조회에서 `archived: true`, `sourceExact: true`, terminal/liveness `exited`를 확인했다.
  background terminal 표시 경고는 있었지만 실제 실행·검토·정리가 완료됐으며 중복 시작하지 않았다.
- 안내 문서 4개의 로컬 링크 12개와 whitespace·`git diff --check`가 통과했다.
  `.orca/`의 합성 업로드·receipt 경로가 Git에서 제외됨을 확인했다.
  기존 `package.json`은 작업 시작 전후 SHA-256이 같고 기타 미추적 자료도 보존했다.
- 상세 lifecycle 식별자와 비밀값 없는 요약은 로컬 `.orca/orchestration/`에 기록했다.
  도입 검증 단계에서는 제품 테스트·과금 API 호출·서명/빌드·commit·push·릴리즈를 수행하지 않았다.

현재 상태: 프로젝트에 개발 절차가 적용됐으며 다음 코딩 작업부터 이 규칙을 사용한다.
2026-10-08 후속 사용자 요청으로 이 안내 파일 묶음의 commit과 GitHub `main` push가
작업 범위에 추가됐다. 기존 `package.json` 수정과 개인 자료는 포함하지 않는다.
전달된 commit은 Git 이력과 원격 `main`으로 확인한다.

## 다음 작업 재개

이 문서와 [실행 규칙](orca-execution-policy.md)을 읽고 실제 `run-current` 및
작업트리 상태를 다시 확인한다. 과거 Task·Dispatch ID를 새 작업 권한으로 재사용하지 않는다.
다음 제품 작업은 사용자가 지정한 범위로 시작한다.
