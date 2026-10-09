# Claude Code 작업 프롬프트 — MM_LLM Console 리디자인

아래 내용을 이 폴더(`design_handoff_console_redesign/`)를 저장소 루트에 복사한 뒤 Claude Code에 그대로 붙여 넣으세요.

---

## 프롬프트 (복사해서 사용)

```
너는 airkjw/MM_LLM(Electron + React 19 + TypeScript) 저장소에서 UI 리디자인을 구현한다.
디자인 레퍼런스는 design_handoff_console_redesign/ 폴더에 있다.

먼저 이것부터 읽어라 (순서대로):
1. design_handoff_console_redesign/README.md — 화면별 치수·색·글꼴·동작 명세 (최우선 기준)
2. design_handoff_console_redesign/tokens.css — styles.css 토큰 블록 교체 초안
3. design_handoff_console_redesign/screenshots/*.png — 라이트 기준 최종 모습 (02, 14, 15는 다크)
4. 기존 코드: AGENTS.md, CLAUDE.md, docs/UI_AUDIT.md, docs/THEME_STARTUP.md,
   src/renderer/src/styles.css, src/renderer/src/components/Sidebar.tsx, App.tsx, ChatPanel.tsx, AppDialogs.tsx

중요한 전제:
- .dc.html 파일은 디자인 레퍼런스다. 코드를 복사하지 말고, 기존 React 컴포넌트·useFocusLayer·aria 패턴으로 재구현해라.
- 시안의 인라인 light-dark()는 미리보기용이다. 실제로는 :root / :root[data-theme="dark"] 토큰 구조를 유지한다.
- CSS에 prefers-color-scheme media query를 넣지 마라 (ui:audit가 거부한다). OS 추종은 JS 경로로 한다.
- 기존 보안·개인정보 흐름(첨부 전 확인, 음성 과금 동의, 의미 색인 동의, CSP, sandbox)은 동작과 문구를 바꾸지 마라. 위치와 시각만 바꾼다.
- 최소 글자 12px, WCAG 대비, focus-visible, reduced-motion, forced-colors 규칙을 지켜라.

단계별로 진행하고, 각 단계가 끝날 때마다 `npm run typecheck && npm test && npm run ui:audit`를 통과시킨 뒤 다음으로 가라.
실패하면 테스트를 지우거나 약하게 만들지 말고, 의도된 변경이면 테스트와 audit 기대값을 함께 갱신하고 그 이유를 커밋 메시지에 적어라.

단계 1 — 토큰과 테마
- styles.css 상단 토큰을 tokens.css 값으로 교체한다 (변수 이름 유지, 라이트/다크 대칭).
- 신규 토큰(--color-success, --color-success-bg, --color-text-body, --radius-*, --font-*)을 추가하고 scripts/audit-ui-css.mjs 허용 목록·대비 쌍에 등록한다.
- --color-on-accent가 #FFFFFF → #1A1306으로 바뀐다. 앰버 면 위 글자 대비 쌍을 audit에 반영한다.
- 라이트에서 앰버 #E5B04A는 면 전용. 2px 인디케이터·포커스·진행 막대는 --color-accent-graphic(#B57F12), 글자는 --color-accent-text(#8A5A00).
- 테마: ThemePreference 기본값 "system". main에서 nativeTheme.themeSource를 설정하고 nativeTheme "updated" 이벤트로 resolved 값을 렌더러에 푸시,
  렌더러는 document.documentElement.dataset.theme만 바꾼다. BrowserWindow.backgroundColor는 #F6F7F8 / #0D0E10.
  기존 appearance.json·theme-bootstrap 순서는 유지. 전환 시 DOM 재마운트 금지, 250ms 색 페이드(동작 줄이기 시 0).
- Pretendard Variable, JetBrains Mono를 로컬 번들(OFL)로 추가하고 CSP를 깨지 마라.

단계 2 — 앱 틀 (레일 + 목록 열 + 본문)
- Sidebar.tsx를 Rail(56px)과 화면별 목록 열로 분리한다. SidebarScreen을
  "chat" | "compare" | "research" | "media" | "voice" | "projects" | "chatbot" | "settings"로 확장한다.
- 크레딧 카드는 대화 목록 열 하단에 상시 표시. 기존 720px compact 동작(오버레이 시트, 포커스 복귀) 테스트를 유지·갱신한다.

단계 3 — 대화
- 시작 화면(screenshots/03), 입력창 모델 토큰, 웹 검색/사고 강도 인라인 토글.
- 모델 비교를 모달에서 대화 안 인라인 3열로 옮긴다(screenshots/01). 기존 compare-limits, compare-synthesis 로직 재사용.
- ModelPicker를 팝오버로 바꾸고 ⇧↵(비교에 추가), F(즐겨찾기) 단축키를 추가한다(screenshots/04).
- 대화 검색 모달을 ⌘K 명령 팔레트로 교체한다(screenshots/05).

단계 4 — 나머지 화면
- 미디어(06), 리서치(07), 음성(08), 프로젝트(09), 챗봇(10), 설정·화면(11), 로그인(12).
- AppDialogs의 workspace-tools / projects 모달 내용을 각 화면으로 옮긴다. 확인 대화상자(ConfirmDialog)는 유지한다.

단계 5 — 마감
- 컴포넌트 상태(screenshots/13, 14)와 대조: hover, focus-visible, disabled, error, loading, empty.
- 1280×900, 980×1180, 640×820에서 가로 넘침이 없는지, 라이트·다크·작게·크게 조합을 확인한다.
- docs/UI_REDESIGN_2026_10.md에 변경 요약과 검증 결과를 남긴다.

애매한 부분은 README를 우선하고, README에도 없으면 기존 코드의 패턴을 따르고, 결정한 내용을 PR 설명에 적어라.
```

---

## 사용 팁
- 한 번에 모든 단계를 시키기보다 "단계 1만 진행해줘"처럼 단계별로 요청하면 리뷰가 쉽습니다.
- 각 단계 PR에 해당 스크린샷 번호를 붙여 비교하세요.
