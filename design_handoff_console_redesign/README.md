# Handoff: MM_LLM "Console" UI 리디자인 (라이트 기준 · OS 테마 연동)

## Overview
MM_LLM(경희대 Medical MBA용 ChatKHU 데스크톱 워크스페이스, Electron + React)의 UI/UX를 전면 재설계한 안입니다. 목표는 세 가지입니다.

1. 기능 진입점을 하나의 틀로 모으기. 지금은 사이드바·입력창·모달·계정 팝오버에 흩어져 있습니다.
2. 라이트를 기준으로 설계하고, OS 테마(macOS 자동 / Windows 야간 예약)가 바뀌면 앱도 즉시 따라가게 하기.
3. 모델 비교를 모달이 아니라 대화 안의 정식 흐름으로 바꾸기.

대상 사용자는 학부생, 대학원생, 교수, 교직원입니다.

## About the Design Files
이 폴더의 `.dc.html` 파일은 **HTML로 만든 디자인 레퍼런스**입니다. 의도한 모습과 동작을 보여주는 시안이고, 그대로 옮길 프로덕션 코드가 아닙니다. 작업은 `airkjw/MM_LLM`의 기존 환경(React 19, lucide-react, `styles.css` 토큰, `useFocusLayer`, ui:audit/ui:check 테스트)에서 **기존 패턴으로 다시 구현하는 것**입니다.

- 브라우저에서 `MM_LLM Design System.dc.html`을 열면 전체 캔버스가 나옵니다(TURN 4 → 1 순서). `support.js`가 같은 폴더에 있어야 합니다.
- 각 화면은 `Console *.dc.html` 단독 파일로도 열립니다. `scheme` prop으로 `light dark`(OS 추종) / `light` / `dark`를 바꿀 수 있습니다.
- 시안 안의 인라인 `light-dark()`는 미리보기용입니다. 실제 앱에서는 `tokens.css`의 `:root` / `:root[data-theme="dark"]` 구조를 쓰세요(아래 §테마 동작).

## Fidelity
**High-fidelity.** 색, 타이포, 간격, 반경, 상태는 최종값입니다. 픽셀 단위로 재현하되, 마크업과 접근성은 기존 컴포넌트(포커스 트랩, aria, 키보드 내비게이션)를 그대로 쓰세요. 레이아웃은 1280×820 기준입니다. 반응형 경계는 기존 720px compact 규칙을 유지합니다.

---

## 정보 구조(IA) 변경

| 기능 | 현재 위치 | 새 위치 |
|---|---|---|
| 대화 / 기록 | 사이드바 하단 목록 | 레일 ① 대화 → 목록 열(필터: 전체·고정·비교·미디어) |
| 모델 비교 | 모달(`AppDialogs` workspace-tools) | 레일 ② + **대화 안 인라인 3열**. 입력창 모델 토큰에서 `⇧↵`로 추가 |
| 논문·법령 검색 | 모달 내부 탭 | 레일 ③ 정식 화면 |
| 이미지·오디오·비디오 | 사이드바 미디어 섹션 3개 | 레일 ④ 미디어 하나 + 상단 세그먼트 탭 |
| 실시간 음성·받아쓰기 | 입력창 아래 `<details>` | 레일 ⑤ 정식 화면 |
| 프로젝트 | 모달 | 레일 ⑥ 정식 화면(문서·대화·미디어 탭) |
| Studio 챗봇 | 모달 | 레일 ⑦ 정식 화면 |
| 설정 / 계정 / 크레딧 | 계정 팝오버 → 앱 설정 모달 | 레일 하단 ⚙ → 설정 페이지(카테고리 열). 크레딧 요약은 대화 목록 열 하단에 항상 표시 |
| 대화 검색 | 검색 모달 | `⌘K` 명령 팔레트(대화 + 명령 통합) |
| 웹 검색·사고 강도 | 입력창 상단 select 2개 | 입력창 하단 인라인 토글(`auto` / `med`)과 모델 토큰 |

화면 공통 틀: **레일 56px · 목록/설정 열 · 본문**.

| 화면 | 두 번째 열 너비 |
|---|---|
| 대화·프로젝트·챗봇 | 260 |
| 설정 | 240 |
| 리서치·음성 | 320 |
| 미디어 | 340 |

---

## Screens / Views
모든 수치는 px이고, 색은 `tokens.css` 변수 이름입니다(라이트 / 다크 값은 §Design Tokens).

### 공통 — 레일 (`nav`, 56 × 100%)
- 오른쪽 경계: 1px `--color-border`. 위아래 padding 14, 항목 사이 gap 6, 가운데 정렬.
- 로고: 30×30, radius 8, bg `--color-accent`, "M" JetBrains Mono 600 12 `--color-on-accent`, 아래 margin 12.
- 항목 버튼: 38×38, radius 8, 아이콘 18(lucide, stroke 1.75).
  - 기본: `--color-text-secondary`
  - hover: bg `--color-bg-hover`
  - 현재 화면: bg `--color-bg-subtle`, 아이콘 `--color-accent-text`, `aria-current="page"`
- 순서: message-square(대화) · columns-3(비교) · book-open-text(리서치) · image(미디어) · audio-lines(음성) · folder(프로젝트) · bot(챗봇) · spacer · settings · 아바타(30, 원형, `--color-bg-subtle`, 이름 첫 글자 600 12).

### 공통 — 목록 열 / 헤더
- 열: bg `--color-bg-sidebar`, 오른쪽 1px `--color-border`. 헤더 52(제목 600 14 + 오른쪽 + 버튼 28×28 radius 6 bg `--color-bg-subtle`).
- 필터 칩: 높이 26, padding 0 10, radius 6, 500 12. 선택은 bg `--color-bg-subtle`, 나머지는 글자 `--color-text-secondary`.
- 목록 행: padding 10, radius 8. 제목 400 14/1.3 `--color-text`(선택 시 500), 메타 JetBrains Mono 400 12 `--color-text-tertiary`(예: `3 models · 2m`).
  - 선택: bg `--color-bg-selected` + `box-shadow: inset 2px 0 0 var(--color-accent-graphic)`
- 크레딧 카드(목록 열 하단): margin 12, padding 12, radius 8, bg `--color-bg-subtle`.
  - 라벨 "크레딧" 500 12 secondary, 값 "880 / 1000" Mono 500 14(분모 12 tertiary).
  - 막대 4px 두 조각(사용분 `--color-progress-fill`, 남은 공간 `--color-progress-track`, gap 2).
  - 10% 이하면 값과 막대를 `--color-danger`로 바꿉니다.
- 본문 헤더: 높이 52, 아래 1px `--color-border`, padding 0 20. 제목 500 14. 가운데에 ⌘K 필드(320×32, radius 8, bg `--color-bg-sidebar`, inset 1px `--color-border-strong`, placeholder 400 13 tertiary, kbd "⌘K" Mono 12, bg subtle, radius 4).

### 1. 대화 + 인라인 비교 — `Console Workspace.dc.html`
- 본문 padding 24 24 0, 세로 gap 18.
- 사용자 메시지: 오른쪽 정렬, 최대 560, bg `--color-bg-subtle`, radius 10, padding 12 14, 400 14/1.6. 첨부 표시는 Mono 12 secondary + paperclip 12.
- 비교 구분선: columns-3 아이콘 14 accent-text + "3개 모델 비교 · 웹 근거 1회 수집 후 공유" 500 12 secondary + 1px 선.
- 비교 열: `grid-template-columns: repeat(3, minmax(0,1fr))`, gap 12. 카드 bg `--color-bg-sidebar`, radius 10, inset 1px `--color-border-strong`(선택된 열은 inset 1px `--color-accent-graphic`), `--shadow-sm`.
  - 카드 헤더: padding 12 14, 아래 1px border. 모델명 600 13, 오른쪽 `4.2s · 6cr` Mono 12 tertiary.
  - 본문: padding 14. 소제목 600 15/1.4, 본문 400 14/1.65 secondary 계열(`--color-text` 쪽 #2E333A / #C9CDD2 사용 — 아래 body 색 참고).
  - 푸터: padding 10 14, 위 1px border. 선택 시 "✓ 선택됨" accent-text, 아니면 "이 답변으로 계속" secondary. 오른쪽에 키 번호 1/2/3(Mono, 숫자키로 선택).
- 종합 분석 바: padding 12 14, radius 10, bg `--color-bg-sidebar`, inset border-strong. sparkles 16 + 설명 400 13 + "≈ 5cr" Mono + 주요 버튼 "종합 분석"(높이 30).
- 입력창: radius 10, bg `--color-bg-sidebar`, inset 1px border-strong + shadow-sm, padding 12 12 10 14.
  - 1행: 모델 토큰(높이 24, radius 5, Mono 500 12). 첫 모델은 bg accent-subtle에 글자 accent-text, 나머지는 bg subtle에 글자 body. 그 뒤에 + 버튼.
  - 2행: placeholder 400 14 tertiary.
  - 오른쪽: `globe auto`, `brain med`(Mono 12 secondary, 클릭하면 순환), 전송 30×30 radius 7 accent.

### 2. 새 대화 · 시작 — `Console Start.dc.html` (`overlay="none"`)
- 가운데 블록 최대 720, 세로 가운데 정렬, gap 28.
  - 캡션 "KYUNG HEE UNIVERSITY · MEDICAL MBA" Mono 500 12, letter-spacing .08em, accent-text
  - 제목 "의료의 미래를 읽고,<br>경영의 답을 설계하다" 600 36/1.25, letter-spacing -.03em(기존 승인 카피)
  - 설명 "질문을 적거나, 아래 주제로 시작하세요." 400 15 secondary
- 시작 카드 2×2(gap 10): 카드 padding 16, 아이콘 박스 32 radius 8 bg subtle에 아이콘 accent-text, 제목 600 14, 설명 400 13 secondary, 오른쪽 kbd 1–4.
  - 카드 목록: 병원 경영 / 운영 지표와 개선 과제, 의료 정책 / 제도 변화와 영향, 논문 읽기 / 핵심 주장과 한계, 연구 설계 / 질문에서 방법까지.
- 입력창 최대 820. 전송 버튼은 내용이 없을 때 비활성(bg subtle, 글자 tertiary). 힌트 "↵ 전송 · ⇧↵ 줄바꿈".
- 하단 안내 400 12 tertiary: "환자 식별정보는 전송 전에 직접 제거해 주세요 · 대화 기록은 이 기기에 암호화 저장됩니다"

### 3. 모델 선택 — `Console Start.dc.html` (`overlay="model"`)
- 팝오버 400 폭, 입력창 모델 토큰 위에 고정. padding 8, radius 10, bg `--color-bg-sidebar`, inset border-strong + `--shadow-lg`.
- 검색 입력이 자동 포커스됩니다(포커스 스타일 아래 참고).
- 그룹 라벨 500 12 tertiary: 즐겨찾기 / 최근 사용 / 제공사명. 오른쪽에 `24 models`.
- 행: padding 9 10, radius 7. 이름 600 13 + ID Mono 12 tertiary. 배지(직접 웹 검색, 사고 조절, 신규, 빠름). 오른쪽에 ✓(선택)와 ★(즐겨찾기, 켜짐이면 accent-text fill). 키보드 활성 행은 bg subtle.
- 푸터 Mono 12 tertiary: "↑↓ 이동 · ↵ 선택" / "⇧↵ 비교에 추가 · F 즐겨찾기"
- 기존 `ModelPicker.tsx` 로직(그룹, combobox aria)을 유지하고 `⇧↵`, `F` 단축키를 추가합니다.

### 4. ⌘K 명령 팔레트 — `Console Start.dc.html` (`overlay="command"`)
- 오버레이 `--color-overlay`. 팔레트는 620 폭, 위에서 110, radius 12, `--shadow-lg`.
- 입력 행 52: search 16 + 입력 400 15 + kbd "esc".
- 섹션 "대화" / "명령"(500 12 tertiary). 행 높이 40, radius 7. 일치 부분은 bg accent-subtle에 글자 accent-text, radius 3으로 강조. 활성 행은 bg subtle에 ↵ 아이콘.
- 명령 예: 새 대화 ⌘N, 모델 비교 시작 ⌘⇧C, 화면 모드 · 시스템 ›(하위 목록), 크레딧 새로고침.
- 푸터 Mono 12: ↑↓ 이동 · ↵ 열기 · ⌘↵ 새 창 · "/ 로 명령만 보기"
- 기존 대화 검색 모달(`search-title`)을 대체합니다.

### 5. 미디어 스튜디오 — `Console Media.dc.html`
- 설정 열 340: 헤더에 세그먼트 [이미지 | 오디오 | 비디오].
  - 필드(gap 18): 모델 select(이름 + ID Mono), 프롬프트 textarea 높이 112, 품질 세그먼트(낮음/보통/높음), 비율 세그먼트(1:1/16:9/3:4, Mono).
  - 참고 이미지 드롭존: 높이 56, 1px dashed border-strong, radius 8.
  - 개인정보 체크: "환자 식별정보를 제거한 자료만 전송합니다".
  - 하단 고정 바: "≈ 53cr"(Mono 500 13) + "잔액 880 · 1장" + 주요 버튼 "생성하기 ⌘↵".
- 결과 영역: 2열 그리드, gap 16, padding 20. 카드 radius 10, 이미지 16:9.
  - 생성 중: bg accent-subtle, "생성 중 · 62%" accent-text, 4px 진행 막대, "약 20초 남음", 중지 버튼.
  - 완료: 이미지, 프롬프트 한 줄 말줄임, 비용 Mono, 다운로드, "대화에 첨부"(message-square-plus).
- 결과는 현재 프로젝트에 자동 보관합니다(헤더 오른쪽 프로젝트 칩).

### 6. 논문·법령 리서치 — `Console Research.dc.html`
- 설정 열 320: 검색 묶음 select → 도구 목록(선택 행 스타일. "실행 미검토"는 배지와 함께 흐리게 표시하고 선택 불가) → 검색어(필수) → 스키마에서 생성한 선택 필드(예: 발행연도, 정렬) → 안내 → 하단 "검색 실행"(⌘↵).
- 결과: 헤더 "검색 결과 6" + `searched 2026-10-09 13:40`(Mono). 신뢰 경계 안내 한 줄(shield 아이콘).
  - 결과 카드: 체크박스, 제목 600 15, 출처 Mono 12 accent-text, 날짜, 본문 400 14/1.6. 선택 카드는 inset accent-graphic 테두리.
- 하단 고정 바(bg sidebar, 위 1px): "2건 선택" + 설명 + 보조 "모두 해제" + 주요 "대화 초안에 근거 추가". 기존 `researchEvidence()`를 선택 항목만으로 호출합니다.

### 7. 음성 — `Console Voice.dc.html`
- 설정 열 320: 용도 세그먼트(음성 대화 / 받아쓰기), 실시간 모델(세션 중 잠금, lock 아이콘), 과금 안내(accent-subtle 박스), 개인정보 안내(subtle 박스), 동의 체크 2개(외부 전송·과금 / 확정 텍스트 암호화 저장).
- 본문 가운데 정렬:
  - 상태 알약: 높이 30, bg accent-subtle, "● 마이크 사용 중 · 응답 중 01:42". `VoiceState` 라벨을 그대로 쓰고 `aria-live`로 알립니다.
  - 레벨 미터: 6px 막대 24개, radius 3, 입력 레벨만큼 accent, 나머지 border-strong.
  - 원형 버튼 56: 음소거(bg sidebar, inset border), 종료(bg danger-bg, 글자 danger). 라벨 500 12.
  - 실시간 텍스트 카드: 최대 640. 확정문은 body 색, 진행 중 텍스트는 tertiary.
- 헤더 오른쪽에 분당 예상 비용 "≈ 2cr / min"을 둡니다.

### 8. 프로젝트 — `Console Projects.dc.html`
- 목록 열: 프로젝트 행(메타 `8 docs · 12 chats`). 하단에 "원본·청크·벡터는 기기 안에 암호화 보관".
- 본문 헤더: 제목 600 22 + 보조 "지침 편집" + 주요 "이 프로젝트에서 새 대화"(높이 32). 탭: 문서 8 / 대화 12 / 미디어 3. 선택 탭은 아래 2px accent-graphic.
- 문서 표(카드): 열 = 이름 · 형식 · 크기 · 검색 색인 · 메뉴(`minmax(0,1fr) 64 72 160 28`), 행 높이 48. 색인 상태 배지:
  - 완료 n/n: success
  - 색인 중 n/m: accent-text + 120폭 진행 막대
  - 텍스트 없음 · PDF 직접: neutral
  - 대기: neutral + clock
- 표 아래 드롭존. 오른쪽 280 열: "문서 검색 방식" 카드(세그먼트 로컬 / 의미 검색, 임베딩 모델·청크 수 Mono, 동의 상태, "색인 이어서 동의", "상태 확인"), "프로젝트 지침" 카드.
- 동의 흐름은 기존 `ProjectRetrievalSettings` 그대로(confirm 대화상자)입니다.

### 9. Studio 챗봇 — `Console Chatbot.dc.html`
- 목록 열: 연결된 챗봇(메타 `studio · 연결됨` / `권한 확인 필요`). 하단 안내 "챗봇은 텍스트만 주고받습니다…".
- 헤더: 봇 아이콘(26, accent-subtle) + 이름 + 배지 "ChatKHU Studio" + 보조 버튼 "일반 대화로 옮기기".
- 답변 아래 사용량 Mono 12 tertiary: `in 1,204 · out 382 · 3cr`(`chatbotUsageSummary`).

### 10. 설정 · 화면 — `Console Settings.dc.html`
- 카테고리 열 240: 일반 / **화면** / 응답 기본값 / 기본 지침 / — / 계정 · API 키 / 크레딧 / 백업 · 복원 / 진단. 행 높이 34, radius 7. 선택은 subtle + inset 2px accent-graphic, 아이콘 accent-text. 하단에 `MM_LLM v0.6.0 · 최신`.
- 본문 최대 680, padding 40 48. 제목 600 24 + 설명 400 14 secondary.
- 화면 모드: 카드 3개(시스템 / 라이트 / 다크). 미리보기 84 높이, 시스템 카드는 반반 분할. 선택 카드는 inset 2px accent(라이트에서는 accent-graphic), 라디오 16. 시스템 카드에 "권장" 표시. 설명 "시스템: macOS ‘자동’이나 Windows 야간 예약에 맞춰 낮에는 라이트, 밤에는 다크로 바뀝니다."
- 설정 목록 카드(행 padding 16 18, 구분 1px):
  - 글자 크기 세그먼트(작게/기본/크게 = 기존 font-size 설정)
  - 밀도(기본/촘촘)
  - 동작 줄이기 토글(기본값은 OS 설정)
  - 단축키 힌트 표시 토글

### 11. 로그인 — `Console Login.dc.html`
- 2열 그리드 `1.1fr 1fr`.
  - 왼쪽: padding 56 64, 오른쪽 1px border. 로고 + 캡션 + 제목 600 44/1.25 + 설명 400 16 secondary(최대 440). 하단 보안 안내 2개(lock, hard-drive / 400 12 tertiary).
  - 오른쪽 폼: 최대 400, gap 24. 제목 "API 키로 시작하기" 600 22. API 키 입력은 높이 42, Mono, 보기 토글 eye. "이 기기에서 자동 로그인" 체크. 주요 버튼 높이 42, "시작하기 →". 발급 방법 카드에 단계 01–03(Mono 번호)과 "ChatKHU 열기 ↗".
- 진단 버튼은 기존처럼 오류가 났을 때만 보여줍니다.

### 컴포넌트 시트 — `Console Components.dc.html` (라이트 / 다크)
- **버튼**:
  - 주요: 높이 32/36, radius 7, bg accent, 글자 on-accent 600 13–14
  - 보조: bg sidebar, inset 1px border-strong, 500 13
  - 텍스트: 글자 secondary
  - 위험: bg danger-bg, 글자 danger
  - 비활성: bg subtle, 글자 tertiary, `cursor: not-allowed`
  - 포커스(`:focus-visible`): `box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-focus-ring)`
  - 중지(스트리밍 중): 32 정사각, 채운 사각형 아이콘 danger
- **입력**: 높이 36, radius 7, inset 1px border-strong.
  - focus: `inset 0 0 0 1px var(--color-focus-ring), 0 0 0 3px var(--color-focus-halo)`
  - error: inset 1px danger + 아래 메시지 400 12 danger
- **세그먼트**: 트랙 padding 3, radius 8, bg subtle. 선택 조각은 bg sidebar, radius 6. 라이트는 `0 1px 2px #15171A1F`, 다크는 `inset 0 0 0 1px #2A2E33`.
- **토글**: 34×20, 켬은 accent, 끔은 border-strong, 손잡이 16.
- **체크박스**: 16, radius 4, 켬은 accent + check 12 on-accent, 끔은 inset 1px border-control.
- **배지**: 높이 22, padding 0 7, radius 5, 500 12. 종류: neutral(subtle / secondary), new(new-bg / new), success, danger.
- **상태 점**: 6px. done=success, streaming=accent, error=danger. 라벨은 Mono 12.
- **메뉴**: 200 폭, padding 4, radius 9, `--shadow-lg`. 행 높이 32, 400 13, 아이콘 14 secondary, 단축키 Mono 12. 위험 항목은 danger. 구분선 1px border.
- **안내 박스**: padding 12, radius 8. 경고 성격은 accent-subtle, 오류는 danger-bg.

---

## Interactions & Behavior

### 테마 동작(핵심 요구사항)
- 기본값은 `ThemePreference = "system"`입니다. 기존 `theme-state.ts`, `theme-persistence.ts`, `THEME_STARTUP.md` 구조를 그대로 씁니다.
- 메인 프로세스:
  - `nativeTheme.themeSource = preference`
  - `nativeTheme.on("updated")`가 오면 `shouldUseDarkColors`로 resolved 값을 계산해 렌더러에 IPC로 보냅니다.
  - `BrowserWindow.backgroundColor`: 라이트 `#F6F7F8`, 다크 `#0D0E10`(시작 깜빡임 방지).
- 렌더러: 받은 resolved 값으로 `document.documentElement.dataset.theme = "light" | "dark"`를 설정합니다. CSS에서는 `prefers-color-scheme` media query를 쓰지 않습니다(ui:audit 계약).
- 전환은 background-color / color / border-color 250ms ease로 합니다. `prefers-reduced-motion`이나 앱의 "동작 줄이기"가 켜져 있으면 0ms입니다.
- 전환 중에도 입력 내용, 스크롤, 열린 팝오버, 포커스를 유지합니다(DOM 재마운트 금지).
- 사용자가 라이트나 다크를 고르면 OS 변경을 무시하고, 선택을 `appearance.json`에 기록합니다.
- 앱이 스스로 시간을 계산하는 자동 전환은 만들지 않습니다. OS 설정과 충돌하기 때문입니다.

### 키보드
| 키 | 동작 |
|---|---|
| `⌘/Ctrl K` | 명령 팔레트 |
| `⌘N` | 새 대화 |
| `⌘⇧C` | 모델 비교 시작 |
| `⌘↵` | 현재 열의 실행(검색 실행, 생성하기) |
| `1–4` | 빈 대화의 시작 카드 |
| `1–3` | 비교 열 선택 |
| `↑↓ ↵ ⇧↵ F` | 모델 선택기: 이동, 선택, 비교에 추가, 즐겨찾기 |

### 그 밖의 동작
- **상태**:
  - 스트리밍: 상태 점 accent + 전송 버튼이 중지 버튼으로 바뀜
  - 오류: danger 안내 박스 + "다시 시도"
  - 로딩 목록: subtle 스켈레톤 막대
  - 빈 상태: 점선 드롭존 + 한 줄 안내
- **팝오버 / 메뉴**: 기존 `useFocusLayer`(Escape, 바깥 클릭, 포커스 복귀) 규칙을 그대로 씁니다.
- **반응형**:
  - 720px 이하: 레일 유지, 목록 열은 오버레이 시트(기존 compact 사이드바 로직)
  - 비교 3열은 960px 이하에서 세로로 쌓기

## State Management
- `screen: "chat" | "compare" | "research" | "media" | "voice" | "projects" | "chatbot" | "settings"`: 기존 `SidebarScreen`을 확장합니다.
- `mediaKind: "image" | "audio" | "video"`: 미디어 화면 안의 탭입니다.
- `composerModels: string[]`: 길이가 2 이상이면 인라인 비교로 보냅니다(기존 compare-limits 2~3 적용).
- `selectedCompareIndex`, `overlay: "none" | "model" | "command"`
- `themePreference`(기존) + `resolvedTheme`(메인 프로세스가 푸시)
- 리서치 `selectedResultIds: Set<string>`, 프로젝트 `activeTab`

## Design Tokens
`tokens.css`를 보세요. 기존 변수 이름을 유지했고, 라이트/다크가 대칭입니다.

- **Surface**: bg `#F6F7F8 / #0D0E10`, sidebar(panel) `#FFFFFF / #131518`, subtle(raised) `#EDEFF2 / #1D2024`, hover `#E4E7EB / #23272C`
- **Text**: `#15171A / #ECEEF0`, secondary `#4F5660 / #A3A9B1`, tertiary `#646B75 / #7D848D`. 답변 본문 body색 `#2E333A / #C9CDD2`(새 토큰 `--color-text-body`로 추가 권장)
- **Line**: border `#E7E9EC / #1F2227`, strong `#DCDFE3 / #2A2E33`, control `#8A919B / #646B75`
- **Accent**: `#E5B04A` 공통(면). 글자 `#8A5A00 / #E5B04A`, 그래픽 `#B57F12 / #E5B04A`, subtle `#FBF0D9 / #2A2316`, on-accent `#1A1306`
- **Status**: danger `#B3261E / #F08A7E`, success `#2E7D4F / #6FBF8E`(신규)
- **라이트의 대비 규칙**: 앰버 `#E5B04A`는 흰 바탕에서 약 2:1이라 면에만 씁니다. 글자는 accent-text(≥4.5:1), 2px 인디케이터·포커스·진행 막대는 accent-graphic(≥3:1). 시안 일부(선택 행 인디케이터, 비교 선택 테두리)는 `#E5B04A`로 그려져 있으니 구현할 때 라이트에서는 accent-graphic으로 바꾸세요.
- **Type**: Pretendard Variable(본문·UI) + JetBrains Mono(수치·ID·단축키·메타). 둘 다 OFL이므로 CSP 때문에 **앱에 직접 번들**하세요.

| 용도 | 값 |
|---|---|
| display | 36–44 / 600 / 1.25 / -.03em |
| title | 22–24 / 600 |
| 소제목 | 15 / 600 |
| 답변 본문 | 15 / 1.75 |
| 고밀도 본문 | 14 / 1.65 |
| UI | 13 / 500 |
| meta | 12(최소, 기존 12px 하한 유지) |

- **Spacing**: 4의 배수(4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56)
- **Radius**: 5 · 6 · 7 · 8 · 10 · 12
- **Shadow**: 라이트 sm `0 1px 2px #15171A0F`, lg `0 12px 32px -8px #15171A38`. 다크는 sm/md 없음(면 단계로 깊이), lg `0 12px 32px -8px #000000B3`

## Assets
- 아이콘: lucide(이미 `lucide-react` 의존성 있음). 시안에서 쓴 이름: message-square, columns-3, book-open-text, image, audio-lines, folder, bot, settings, search, plus, paperclip, globe, brain, arrow-up, check, sparkles, chevrons-up-down, chevron-down, star, sun-moon, monitor, sun, moon, square-pen, refresh-cw, file-spreadsheet, file-text, shield, shield-alert, shield-check, lock, mic, mic-off, square, receipt, quote, upload, clock, ellipsis, download, message-square-plus, image-plus, clapperboard, layout-grid, eye, arrow-right, arrow-up-right, hard-drive, scroll-text, key-round, gauge, archive, stethoscope, sliders-horizontal, message-square-text, pin, pencil, file-down, trash-2, circle-alert, heart-pulse, landmark, flask-conical, corner-down-left, chevron-right, arrow-right-left
- 이미지 결과는 사선 줄무늬 플레이스홀더입니다. 실제 생성 결과로 대체하세요.
- 폰트: Pretendard(github.com/orioncactus/pretendard), JetBrains Mono(jetbrains.com/lp/mono). 둘 다 OFL 1.1입니다.

## Files
| 파일 | 내용 |
|---|---|
| `MM_LLM Design System.dc.html` | 전체 캔버스(TURN 4: 나머지 화면, TURN 3: DS v1, TURN 2: 테마 연동, TURN 1: 초기 3안 비교). Tweaks의 "화면 모드"로 OS 추종 / 고정 전환 |
| `Console Workspace.dc.html` | 대화 + 인라인 비교 |
| `Console Start.dc.html` | 시작 화면, `overlay=model` / `command` |
| `Console Media.dc.html` · `Console Research.dc.html` · `Console Voice.dc.html` | 미디어 · 리서치 · 음성 |
| `Console Projects.dc.html` · `Console Chatbot.dc.html` | 프로젝트 · 챗봇 |
| `Console Settings.dc.html` · `Console Login.dc.html` | 설정 · 로그인 |
| `Console Components.dc.html` | 컴포넌트 시트 |
| `tokens.css` | `styles.css` 상단 토큰 블록 교체 초안 |
| `support.js` | 시안 실행용 런타임(구현에는 불필요) |
| `PROMPT.md` | Claude Code에 붙여 넣을 단계별 작업 프롬프트 |
| `screenshots/` | 01 대화·비교(라이트) · 02 대화·비교(다크) · 03 시작 · 04 모델 선택 · 05 ⌘K · 06 미디어 · 07 리서치 · 08 음성 · 09 프로젝트 · 10 챗봇 · 11 설정·화면 · 12 로그인 · 13/14 컴포넌트(라이트/다크) · 15 시작(다크) |

### 저장소 수정 대상
- `src/renderer/src/styles.css`(토큰 + 컴포넌트)
- `components/Sidebar.tsx`(→ 레일 + 목록 열로 분리)
- `App.tsx`(screen 라우팅)
- `ChatPanel.tsx`(입력창, 인라인 비교)
- `AppDialogs.tsx`(비교·리서치·프로젝트·챗봇 모달을 화면으로 이전, 검색 모달을 명령 팔레트로 교체)
- `ModelPicker.tsx`, `MediaPanel.tsx`, `ResearchPanel.tsx`, `VoicePanel.tsx`, `ProjectRetrievalSettings.tsx`, `Login.tsx`
- `src/main/index.ts`(nativeTheme 연동, backgroundColor)
- `scripts/audit-ui-css.mjs` 및 tests(새 토큰과 accent 대비 쌍 등록, `on-accent` 변경 반영)
