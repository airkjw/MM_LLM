# Sidebar interaction checks

`npm run ui:check` renders the real React app shell (`Rail`, `Sidebar`/`ChatListColumn`, the screens) and the shared focus-layer hook in a headless DOM. It does not start Electron and does not claim to measure pixels or native-window painting. CSS token and selector checks remain in `npm run ui:audit`; rendered widths, header heights and horizontal overflow are probed by the dev-only `scripts/ui-smoke.mjs` (see [UI_AUDIT.md](UI_AUDIT.md)); the production build remains the renderer integration check.

## Structure

The shell has two navigation parts.

- The **rail** (`nav.rail`, 56px, `aria-label="주 탐색"`) is visible at every width, including 680–720px windows. Its tab order is the seven destinations (대화, 모델 비교, 논문·법령 리서치, 미디어, 음성, 프로젝트, 챗봇), **앱 설정** and the **설정·계정** avatar; the logo is not focusable. Every destination is a real screen, and exactly one rail item carries `aria-current="page"` (settings included). Category and list selections inside screens use `aria-current="true"` so the rail's value stays unique.
- The **list column** keeps the `.sidebar` contract (`data-compact`, modal focus layer, `사이드바 열기/닫기` labels). It is the conversation list and shows only on the conversation and model-compare screens. Every other screen owns its own second column (settings 240, research 320, media 340, voice 320, projects 260, chatbot 260). On desktop (≥721px) the list column is collapsible and is 260px wide (240px from 721 to 1100px); at ≤720px it is a modal overlay sheet beside the rail (`inset: 0 auto 0 56px`) and its opener sits in the rail under the logo.
- Cmd/Ctrl+B collapses only the list column and does nothing on a screen without one; the rail is never hidden. When focus was inside the list, the rail's expand/open control takes it.
- The avatar has no popover: it opens settings on **계정 · API 키**. Logout, API key replacement, model refresh, update check/install and credit refresh live on the settings screen. The update text badge and the single `data-testid="update-status-live"` live region stay on the rail.
- The conversation (`.chat-slot`) and media (`.media-keepalive`) screens stay mounted but `hidden` and `inert` while another screen is shown, so an answer in progress, a draft, attachments and a paid media job survive navigation. While hidden, their window shortcuts (Escape to stop, Cmd/Ctrl+↑, start-card digits, comparison digits) are off. The voice screen is deliberately not kept alive: leaving it ends the session.

## What the DOM checks cover

- The 720px compact boundary, desktop-to-compact and compact-to-desktop open state, modal overlay focus trapping, repeated forward/reverse Tab, thread-menu arrow keys, and focus return after commands, scroll, resize and modal launches.
- Compact navigation closes the open sheet before the content action runs; a launched dialog returns to the original desktop trigger, else the visible compact sidebar opener, else the rail's current item.
- Rail Tab order, a single `aria-current`, list filters as pressed toggle buttons (compare and media rows come from `listCompareRuns()` and `listMediaJobs()`), and the credit card showing `n / m` only with a real quota.
- Keep-alive: a hidden conversation does not stop a stream, does not react to digits or Cmd/Ctrl+↑, and focus never stays inside it: the focus rule moves it to the active rail item (the checks click without moving focus, so only the shell rule can do it) and leaves a focused composer alone once the conversation is visible again.
- Settings: radiogroups with a single tab stop (arrows, Home and End move and select), every update status in the footer and update row, a refused default-instruction save that waits and retries, and the settings categories stacking above the body at the compact width.

`npm test` includes `npm run ui:check`, so the interaction checks are part of the normal release verification path rather than an optional standalone command.

## Settings reach

Settings is one click from any width: **앱 설정** on the rail opens it directly, and the **설정·계정** avatar opens the same screen on 계정 · API 키. Because the avatar lives on the rail, neither route depends on an already open and visible desktop sidebar or on the compact list sheet; opening that sheet is a separate navigation step and is not part of either route.
